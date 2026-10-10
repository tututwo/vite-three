import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rgb } from 'd3';
import { groundColor, heightModes, palettes, years } from './electionData.js';

// Civ-skin settings that pass straight into uniforms of the same name (App.jsx has the defaults).
const civNumbers = ['fogHatch', 'fogLine', 'fogClouds', 'fogScale', 'fogSpeed', 'hexSize', 'hexWidth', 'hexOnLand',
  'borderWidth', 'borderCore', 'borderGlow', 'borderHighlight', 'flipFade'];
const civColors = ['fogColor', 'fogInk'];

// The animation runs on the GPU: each county's row in the `series` texture holds its values per
// election (then its wave delay and breathing phase), and the vertex shader eases between two states.
const heightPars = /* glsl */ `
  #define ELECTIONS ${years.length}
  attribute float county;
  attribute float neighbor;
  uniform highp sampler2D series;
  uniform highp sampler2D held;
  uniform float fromElection;
  uniform float toElection;
  uniform float progress;
  uniform float seconds;
  uniform float stagger;
  uniform float breath;
  uniform float maxHeight;
  uniform float minHeight;
  uniform float heightExponent;
  uniform float heightMode;
  uniform float selectedRow;
  uniform float flatten;
  uniform float markOther;
  varying float vHeight;
  varying float vColorHeight;
  varying float vFloor;
  varying float vParty;
  varying float vVoted;
  varying float vWall;
  varying float vNeutral;
  varying float vSelected;
  varying vec2 vWorldXY;
  // A county's values part way from one state to the next: from an election, or (fromElection < 0)
  // from the state held when a seek began. Each county waits delay * stagger of the transition,
  // so the change sweeps across the map. hold() mirrors this in JS; change the two together.
  vec4 valuesAt(int row) {
    float delay = texelFetch(series, ivec2(ELECTIONS, row), 0).x;
    vec4 before = fromElection < 0.0 ? texelFetch(held, ivec2(0, row), 0) : texelFetch(series, ivec2(int(fromElection + 0.5), row), 0);
    vec4 after = texelFetch(series, ivec2(int(toElection + 0.5), row), 0);
    return mix(before, after, smoothstep(0.0, 1.0, (progress - delay * stagger) / (1.0 - stagger)));
  }
  // Signed: + Democratic, - Republican, so a flip has to pass through zero.
  float signedOf(vec4 values) { return heightMode < 0.5 ? values.x : values.y; }
  float heightAt(int row, vec4 values) {
    float phase = texelFetch(series, ivec2(ELECTIONS, row), 0).y;
    float breathing = 1.0 + breath * sin(seconds * 1.6 + phase);
    return minHeight + maxHeight * pow(abs(signedOf(values)), heightExponent) * breathing;
  }
  // Territory lays the columns down (flatten 1) but keeps colouring each roof by the height it had.
  float shownHeight(float raised) { return mix(raised, minHeight, flatten); }`;
const heightMain = /* glsl */ `
  int row = int(county + 0.5);
  vec4 values = valuesAt(row);
  float raised = heightAt(row, values);
  vColorHeight = transformed.z * raised;
  transformed.z *= shownHeight(raised);`;
const varyingsMain = /* glsl */ `
  vHeight = transformed.z;
  vWorldXY = (modelMatrix * vec4(transformed, 1.0)).xy;
  vParty = float(signedOf(values) < 0.0);
  vVoted = values.z;
  // values.w: everyone else's votes together beat both parties. Grey where the view is about who led.
  vNeutral = float(signedOf(values) == 0.0 || markOther * values.w > 0.5);
  vSelected = float(abs(county - selectedRow) < 0.5);
  vWall = 1.0 - abs(objectNormal.z);
  int across = int(neighbor + 0.5);
  vFloor = neighbor < 0.0 ? 0.0 : shownHeight(heightAt(across, valuesAt(across)));`;
const raiseCounties = (vertexShader, main) => vertexShader
  .replace('#include <common>', `#include <common>\n${heightPars}`)
  .replace('#include <begin_vertex>', `#include <begin_vertex>\n${heightMain}\n${main}`);

// Civ skin, shared by the floor and the counties: a pointy-top hex grid in world units (the elector
// board snaps to the same lattice), and value noise for the clouds drifting over unvoted land.
export const civGlsl = /* glsl */ `
  float hexLine(vec2 world, float size, float width) {
    vec2 p = world / (1.7320508 * size);
    const vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h;
    vec2 b = mod(p - h, r) - h;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    vec2 q = abs(g);
    float edge = 0.5 - max(q.x, dot(q, vec2(0.5, 0.8660254)));
    float aa = fwidth(edge);
    return 1.0 - smoothstep(width, width + aa * 1.5, edge);
  }
  float civHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float civNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(civHash(i), civHash(i + vec2(1.0, 0.0)), u.x), mix(civHash(i + vec2(0.0, 1.0)), civHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float civClouds(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 4; octave++) {
      value += amplitude * civNoise(p);
      p = p * 2.03 + 17.0;
      amplitude *= 0.5;
    }
    return value;
  }`;

// Civ borders. Every county edge carries a ribbon that lies on the county's roof and reaches inward;
// the vertex shader opens it only where the county across has a different leader (or none), and
// narrows it as either side nears a tie, so a border slides away through a flip instead of popping.
const borderPars = /* glsl */ `
  attribute vec2 inward;
  attribute float across;
  uniform float borderWidth;
  uniform float borderLift;
  uniform float flipFade;
  varying float vAcross;
  varying float vBorderParty;
  varying float vStrength;
  // 0 no lead or no return, 1 Democratic, 2 Republican, 3 third parties (where the view marks them).
  float partyOf(vec4 values) {
    if (values.z < 0.5) return 0.0;
    if (markOther * values.w > 0.5) return 3.0;
    float lead = signedOf(values);
    return lead > 0.0 ? 1.0 : (lead < 0.0 ? 2.0 : 0.0);
  }`;
const borderMain = /* glsl */ `
  int row = int(county + 0.5);
  vec4 values = valuesAt(row);
  float party = partyOf(values);
  float strength = 0.0;
  if (party > 0.5) {
    if (neighbor < 0.0) strength = 1.0;
    else {
      vec4 across4 = valuesAt(int(neighbor + 0.5));
      float otherParty = partyOf(across4);
      if (otherParty != party) {
        float closest = otherParty > 0.5 ? min(abs(signedOf(values)), abs(signedOf(across4))) : abs(signedOf(values));
        strength = party > 2.5 || otherParty > 2.5 ? 1.0 : smoothstep(0.0, flipFade, closest);
      }
    }
  }
  vStrength = strength;
  vBorderParty = party;
  vAcross = across;
  transformed.xy += inward * across * borderWidth * strength;
  transformed.z = shownHeight(heightAt(row, values)) + borderLift;`;

// One ribbon per wall quad. ExtrudeGeometry builds a contour's walls in order, each quad's first two
// vertices are its edge's ends, and consecutive quads share an end, so the inner corners can be mitred.
function buildBorders(counties, walls, wallsByEdge) {
  const positions = [], inward = [], across = [], rows = [], neighbors = [], indices = [];
  counties.forEach(({ geometry }, row) => {
    const { position, normal } = geometry.attributes;
    const quads = walls[row];
    const emit = (contour) => {
      // Walls face outward, so inward is the flipped wall normal.
      const normals = contour.map(([start]) => {
        const x = -normal.getX(start), y = -normal.getY(start), length = Math.hypot(x, y) || 1;
        return [x / length, y / length];
      });
      const mitre = (a, b) => {
        const x = a[0] + b[0], y = a[1] + b[1], length = Math.hypot(x, y);
        if (length < 1e-6) return a;
        const scale = 1 / Math.max((x * a[0] + y * a[1]) / length, 0.4) / length;
        return [x * scale, y * scale];
      };
      contour.forEach(([start, edge], index) => {
        const previous = normals[(index + contour.length - 1) % contour.length];
        const next = normals[(index + 1) % contour.length];
        const ends = [mitre(previous, normals[index]), mitre(normals[index], next)];
        const neighbor = wallsByEdge.get(edge).find((other) => other !== row) ?? -1;
        const base = positions.length / 3;
        for (const inner of [0, 1]) {
          for (const end of [0, 1]) {
            positions.push(position.getX(start + end), position.getY(start + end), 0);
            inward.push(...(inner ? ends[end] : [0, 0]));
            across.push(inner);
            rows.push(row);
            neighbors.push(neighbor);
          }
        }
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      });
    };
    let first = 0;
    quads.forEach(([start], index) => {
      const next = quads[index + 1];
      const closes = !next || position.getX(next[0]) !== position.getX(start + 1) || position.getY(next[0]) !== position.getY(start + 1);
      if (closes) { emit(quads.slice(first, index + 1)); first = index + 1; }
    });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('inward', new THREE.Float32BufferAttribute(inward, 2));
  geometry.setAttribute('across', new THREE.Float32BufferAttribute(across, 1));
  geometry.setAttribute('county', new THREE.Float32BufferAttribute(rows, 1));
  geometry.setAttribute('neighbor', new THREE.Float32BufferAttribute(neighbors, 1));
  geometry.setIndex(indices);
  return geometry;
}

export function createCountyMap(svgData, settings, series) {
  const origin = svgData.xml?.getAttribute('data-origin')?.trim().split(/\s+/).map(Number);
  if (origin && (origin.length !== 2 || !origin.every(Number.isFinite))) throw new Error('Invalid county map origin');
  const counties = svgData.paths.flatMap((path) => {
    const shapes = path.toShapes();
    if (!shapes.length) return [];
    const fips = path.userData.node.id;
    return [{
      fips,
      series: series[fips] ?? {},
      geometry: new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false }),
    }];
  });

  const bounds = new THREE.Box3();
  for (const county of counties) {
    county.geometry.computeBoundingBox();
    bounds.union(county.geometry.boundingBox);
  }
  const center = bounds.getCenter(new THREE.Vector3());
  // The asset keeps the mainland's original framing when Alaska/Hawaii move to true positions.
  if (origin) center.set(...origin, 0);
  const width = bounds.max.x - bounds.min.x || 1;

  // One row per county: [margin %, margin votes, voted, third parties led] per election, then [delay, phase].
  // The shift and loyalty textures put their one value in both of the first two channels.
  const columns = years.length + 1;
  const seriesData = new Float32Array(columns * counties.length * 4);
  const shiftData = new Float32Array(seriesData.length);
  const loyaltyData = new Float32Array(seriesData.length);
  const countyMetadata = new Map();
  const centroid = new THREE.Vector3();
  counties.forEach((county, row) => {
    for (let election = 0; election < years.length; election++) {
      const at = (key) => county.series[key]?.[election] ?? 0;
      seriesData.set([...heightModes, 'voted', 'otherLed'].map(at), (row * columns + election) * 4);
      shiftData.set([at('shift'), at('shift'), at('compared'), 0], (row * columns + election) * 4);
      loyaltyData.set([at('loyalty'), at('loyalty'), at('voted'), at('otherLed')], (row * columns + election) * 4);
    }
    county.geometry.boundingBox.getCenter(centroid);
    const box = county.geometry.boundingBox;
    // World coordinates include the group translation and SVG Y flip, including Alaska/Hawaii.
    countyMetadata.set(county.fips, {
      row,
      center: new THREE.Vector3(centroid.x - center.x, center.y - centroid.y, 0),
      bounds: new THREE.Box3(
        new THREE.Vector3(box.min.x - center.x, center.y - box.max.y, 0),
        new THREE.Vector3(box.max.x - center.x, center.y - box.min.y, 1),
      ),
    });
    const east = (centroid.x - bounds.min.x) / width;
    const jitter = ((Number(county.fips) * 2654435761) >>> 0) / 4294967296;
    const animation = [0.75 * (1 - east) + 0.25 * jitter, centroid.x * 0.03 + centroid.y * 0.02];
    for (const data of [seriesData, shiftData, loyaltyData]) data.set(animation, (row * columns + years.length) * 4);
  });
  const textures = Object.fromEntries([['series', seriesData], ['shift', shiftData], ['loyalty', loyaltyData]].map(([name, data]) => {
    const texture = new THREE.DataTexture(data, columns, counties.length, THREE.RGBAFormat, THREE.FloatType);
    texture.needsUpdate = true;
    return [name, texture];
  }));
  let activeData = seriesData;
  // One texel per county: what was on screen when the current seek began.
  const heldData = new Float32Array(counties.length * 4);
  const heldTexture = new THREE.DataTexture(heldData, 1, counties.length, THREE.RGBAFormat, THREE.FloatType);
  heldTexture.needsUpdate = true;

  // Every wall quad (6 vertices of an extruded side) runs along one border. The county across it
  // is what the wall rises out of, so ambient occlusion can start at that neighbour's roof.
  const wallsByEdge = new Map();
  const walls = counties.map(({ geometry }, row) => {
    const { position } = geometry.attributes;
    const quads = [];
    for (const group of geometry.groups.filter((group) => group.materialIndex === 1)) {
      for (let start = group.start; start < group.start + group.count; start += 6) {
        const ends = new Set();
        for (let vertex = start; vertex < start + 6; vertex++) {
          ends.add(`${Math.round(position.getX(vertex) * 100)},${Math.round(position.getY(vertex) * 100)}`);
        }
        const edge = [...ends].sort().join(' ');
        quads.push([start, edge]);
        wallsByEdge.set(edge, [...(wallsByEdge.get(edge) ?? []), row]);
      }
    }
    return quads;
  });
  const geometry = mergeGeometries(counties.map((county, row) => {
    const { count } = county.geometry.attributes.position;
    const neighbor = new Float32Array(count).fill(-1);
    for (const [start, edge] of walls[row]) neighbor.fill(wallsByEdge.get(edge).find((other) => other !== row) ?? -1, start, start + 6);
    county.geometry.deleteAttribute('uv');
    county.geometry.setAttribute('county', new THREE.Float32BufferAttribute(new Float32Array(count).fill(row), 1));
    county.geometry.setAttribute('neighbor', new THREE.Float32BufferAttribute(neighbor, 1));
    return county.geometry;
  }));
  const borderGeometry = buildBorders(counties, walls, wallsByEdge);
  for (const county of counties) county.geometry.dispose();

  const rampWidth = 256;
  const rampData = new Uint8Array(rampWidth * 2 * 4);
  const rampTexture = new THREE.DataTexture(rampData, rampWidth, 2);
  rampTexture.colorSpace = THREE.SRGBColorSpace;
  rampTexture.minFilter = rampTexture.magFilter = THREE.LinearFilter;

  const uniforms = {
    series: { value: textures.series },
    held: { value: heldTexture },
    ramp: { value: rampTexture },
    noDataColor: { value: new THREE.Color(groundColor) },
    neutralColor: { value: new THREE.Color('#969eaa') },
    selectedRow: { value: -1 },
    flatten: { value: 0 },
    markOther: { value: 0 },
    occlusion: { value: 1 },
    ...Object.fromEntries(['fromElection', 'toElection', 'progress', 'seconds', 'stagger', 'breath', 'maxHeight', 'minHeight', 'heightExponent', 'heightMode', 'colorGamma']
      .map((name) => [name, { value: 0 }])),
    // Civ skin: civ fades the whole skin in and out (ElectionScene eases it), the rest are its knobs.
    civ: { value: 0 },
    ...Object.fromEntries([...civNumbers, 'borderOpacity', 'borderLift'].map((name) => [name, { value: 0 }])),
    ...Object.fromEntries([...civColors, 'borderD', 'borderR', 'borderO'].map((name) => [name, { value: new THREE.Color() }])),
  };
  uniforms.borderLift.value = 0.06;
  // A palette is only texels, so switching it never recompiles the shader.
  let appliedPalette = null;
  function applyPalette(name) {
    const palette = palettes[name] ?? Object.values(palettes)[0];
    palette.ramps.forEach((interpolator, row) => {
      for (let x = 0; x < rampWidth; x++) {
        const { r, g, b } = rgb(interpolator(x / (rampWidth - 1)));
        rampData.set([r, g, b, 255], (row * rampWidth + x) * 4);
      }
    });
    rampTexture.needsUpdate = true;
    uniforms.borderD.value.set(palette.accents[0]);
    uniforms.borderR.value.set(palette.accents[1]);
    uniforms.borderO.value.set('#5d6570');
    appliedPalette = name;
  }

  const material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  material.customProgramCacheKey = () => 'county-altitude-ramp-v5';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = raiseCounties(shader.vertexShader, varyingsMain);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying float vHeight;
        varying float vColorHeight;
        varying float vFloor;
        varying float vParty;
        varying float vVoted;
        varying float vWall;
        varying float vNeutral;
        varying float vSelected;
        varying vec2 vWorldXY;
        uniform sampler2D ramp;
        uniform float maxHeight;
        uniform float colorGamma;
        uniform vec3 noDataColor;
        uniform vec3 neutralColor;
        uniform float occlusion;
        uniform float seconds;
        uniform float civ;
        uniform vec3 fogColor;
        uniform vec3 fogInk;
        uniform float fogHatch;
        uniform float fogLine;
        uniform float fogClouds;
        uniform float fogScale;
        uniform float fogSpeed;
        uniform float hexSize;
        uniform float hexWidth;
        uniform float hexOnLand;
        ${civGlsl}`)
      .replace('#include <color_fragment>', /* glsl */ `
        // Colour is altitude: party picks the ramp, and a county fades in as it starts voting.
        float rampU = pow(clamp(vColorHeight / maxHeight, 0.0, 1.0), colorGamma);
        vec3 rampColor = texture2D(ramp, vec2(rampU, mix(0.25, 0.75, vParty))).rgb;
        // Civ: land without returns lies under the fog of war, hatched parchment with drifting cloud.
        // The hatch derivative is taken before the branch, where every pixel of the quad runs it.
        float hatch = (vWorldXY.x + vWorldXY.y) / fogHatch;
        float hatchEdge = fwidth(hatch);
        vec3 unvoted = noDataColor;
        if (civ > 0.001 && vVoted < 0.999) {
          float stripe = abs(fract(hatch) - 0.5);
          float line = smoothstep(0.5 - fogLine * 0.5 - hatchEdge, 0.5 - fogLine * 0.5, stripe);
          float drift = seconds * fogSpeed;
          float cloud = smoothstep(0.42, 0.78, civClouds(vWorldXY * fogScale + vec2(drift * 0.11, drift * 0.04)));
          vec3 fog = mix(mix(fogColor, fogInk, line), vec3(0.97, 0.95, 0.9), cloud * fogClouds);
          unvoted = mix(noDataColor, fog, civ);
        }
        diffuseColor.rgb = mix(unvoted, mix(rampColor, neutralColor, vNeutral), vVoted);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.67, 0.08), vSelected * 0.85);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vSelected * vec3(0.16, 0.09, 0.01);`)
      .replace('#include <opaque_fragment>', /* glsl */ `#include <opaque_fragment>
        // Ambient occlusion without a screen pass: a wall darkens where it rises out of its
        // neighbour's roof, or out of the floor at a coast, which is where the columns meet.
        // Depth 0.3 over 4 units is the closest fit to the GTAO pass this replaced.
        gl_FragColor.rgb *= 1.0 - occlusion * 0.3 * vWall * (1.0 - smoothstep(0.0, 4.0, vHeight - vFloor));
        // Civ: the board's hex grid, faint over the land, on roofs only.
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), hexLine(vWorldXY, hexSize, hexWidth) * hexOnLand * civ * (1.0 - vWall));`);
  };
  // Shadows are rendered with this, so they follow the same heights.
  const depthMaterial = new THREE.MeshDepthMaterial();
  depthMaterial.customProgramCacheKey = () => 'county-height-depth-v2';
  depthMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = raiseCounties(shader.vertexShader, '');
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'election-counties';
  mesh.customDepthMaterial = depthMaterial;
  mesh.castShadow = mesh.receiveShadow = true;
  // The heights live in the shader, so the geometry's own bounds would clip growing columns.
  mesh.frustumCulled = false;

  // Unlit, like a painted map border: a white seam at the edge, the party colour, then a fading wash.
  const borderMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  borderMaterial.customProgramCacheKey = () => 'county-civ-border-v1';
  borderMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${heightPars}\n${borderPars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${borderMain}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying float vAcross;
        varying float vBorderParty;
        varying float vStrength;
        uniform vec3 borderD;
        uniform vec3 borderR;
        uniform vec3 borderO;
        uniform float borderCore;
        uniform float borderGlow;
        uniform float borderHighlight;
        uniform float borderOpacity;`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        vec3 partyColor = vBorderParty < 1.5 ? borderD : (vBorderParty < 2.5 ? borderR : borderO);
        float core = 1.0 - smoothstep(borderCore - 0.08, borderCore, vAcross);
        float seam = 1.0 - smoothstep(0.0, 0.14, vAcross);
        diffuseColor.rgb = mix(partyColor, vec3(1.0), seam * borderHighlight);
        diffuseColor.a = max(core, borderGlow * (1.0 - vAcross)) * borderOpacity * step(0.001, vStrength);`);
  };
  const borders = new THREE.Mesh(borderGeometry, borderMaterial);
  borders.name = 'civ-borders';
  borders.frustumCulled = false;
  borders.renderOrder = 2;

  // Shows `progress` (0-1) of the way from election `from` (or, when negative, the held state) to `to`.
  function show(from, to, progress) {
    uniforms.fromElection.value = from;
    uniforms.toElection.value = to;
    uniforms.progress.value = progress;
  }

  // Freezes what is on screen, county by county, as the start of the next transition, so a seek
  // begun mid-playback or mid-seek carries on from there instead of jumping. Mirrors valuesAt().
  function hold() {
    const [from, to, progress, stagger] = ['fromElection', 'toElection', 'progress', 'stagger'].map((name) => uniforms[name].value);
    for (let row = 0; row < counties.length; row++) {
      const delay = activeData[(row * columns + years.length) * 4];
      const t = Math.min(Math.max((progress - delay * stagger) / (1 - stagger), 0), 1);
      const eased = t * t * (3 - 2 * t);
      for (let channel = 0; channel < 4; channel++) {
        const before = from < 0 ? heldData[row * 4 + channel] : activeData[(row * columns + from) * 4 + channel];
        const after = activeData[(row * columns + to) * 4 + channel];
        heldData[row * 4 + channel] = before + (after - before) * eased;
      }
    }
    heldTexture.needsUpdate = true;
  }

  // Territory and result share the series texture; territory is drawn flat (see ElectionScene).
  function setMode(mode) {
    const name = mode === 'shift' || mode === 'loyalty' ? mode : 'series';
    uniforms.series.value = textures[name];
    activeData = textures[name].image.data;
    uniforms.markOther.value = Number(mode === 'territory' || mode === 'loyalty');
  }

  function select(fips) {
    uniforms.selectedRow.value = countyMetadata.get(fips)?.row ?? -1;
  }

  function update(seconds, currentSettings) {
    setMode(currentSettings.mode);
    uniforms.seconds.value = seconds;
    for (const name of ['stagger', 'breath', 'maxHeight', 'minHeight', 'heightExponent', 'colorGamma']) {
      uniforms[name].value = currentSettings[name];
    }
    // Only Margin (result) offers the vote-count height; the other modes read the first channel.
    uniforms.heightMode.value = ['territory', 'shift', 'loyalty'].includes(currentSettings.mode) ? 0 : heightModes.indexOf(currentSettings.height);
    if (currentSettings.reducedMotion) uniforms.breath.value = 0;
    uniforms.occlusion.value = currentSettings.ambientOcclusion ?? 1;
    if (currentSettings.palette !== appliedPalette) applyPalette(currentSettings.palette);
    for (const name of civNumbers) if (Number.isFinite(currentSettings[name])) uniforms[name].value = currentSettings[name];
    for (const name of civColors) if (currentSettings[name] && currentSettings[name] !== appliedColors[name]) {
      uniforms[name].value.set(currentSettings[name]);
      appliedColors[name] = currentSettings[name];
    }
    // Borders belong to the flat map; in the column modes they show only as far as borderColumns asks.
    uniforms.borderOpacity.value = uniforms.civ.value * (currentSettings.borders ?? 0)
      * (uniforms.flatten.value + (1 - uniforms.flatten.value) * (currentSettings.borderColumns ?? 0));
    borders.visible = mesh.visible && uniforms.borderOpacity.value > 0.001;
  }
  const appliedColors = {};
  show(0, 1, 0);
  update(0, settings);

  return {
    mesh,
    borders,
    // The scene's enclosing group flips the SVG's downward Y axis.
    position: [-center.x, center.y, 0],
    uniforms,
    counties: countyMetadata,
    select,
    setMode,
    show,
    hold,
    update,
    dispose() {
      geometry.dispose();
      material.dispose();
      depthMaterial.dispose();
      borderGeometry.dispose();
      borderMaterial.dispose();
      rampTexture.dispose();
      for (const texture of Object.values(textures)) texture.dispose();
      heldTexture.dispose();
    },
  };
}
