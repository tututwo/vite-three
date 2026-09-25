import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rgb } from 'd3';
import { groundColor, heightModes, palettes, years } from './electionData.js';

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
  varying float vHeight;
  varying float vFloor;
  varying float vParty;
  varying float vVoted;
  varying float vWall;
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
  }`;
const heightMain = /* glsl */ `
  int row = int(county + 0.5);
  vec4 values = valuesAt(row);
  transformed.z *= heightAt(row, values);`;
const varyingsMain = /* glsl */ `
  vHeight = transformed.z;
  vParty = float(signedOf(values) < 0.0);
  vVoted = values.z;
  vWall = 1.0 - abs(objectNormal.z);
  int across = int(neighbor + 0.5);
  vFloor = neighbor < 0.0 ? 0.0 : heightAt(across, valuesAt(across));`;
const raiseCounties = (vertexShader, main) => vertexShader
  .replace('#include <common>', `#include <common>\n${heightPars}`)
  .replace('#include <begin_vertex>', `#include <begin_vertex>\n${heightMain}\n${main}`);

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

  // One row per county: [margin %, margin votes, voted] per election, then [delay, phase].
  const columns = years.length + 1;
  const seriesData = new Float32Array(columns * counties.length * 4);
  const centroid = new THREE.Vector3();
  counties.forEach((county, row) => {
    for (let election = 0; election < years.length; election++) {
      const values = [...heightModes, 'voted'].map((key) => county.series[key]?.[election] ?? 0);
      seriesData.set(values, (row * columns + election) * 4);
    }
    county.geometry.boundingBox.getCenter(centroid);
    const east = (centroid.x - bounds.min.x) / width;
    const jitter = ((Number(county.fips) * 2654435761) >>> 0) / 4294967296;
    seriesData.set([0.75 * (1 - east) + 0.25 * jitter, centroid.x * 0.03 + centroid.y * 0.02], (row * columns + years.length) * 4);
  });
  const seriesTexture = new THREE.DataTexture(seriesData, columns, counties.length, THREE.RGBAFormat, THREE.FloatType);
  seriesTexture.needsUpdate = true;
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
  for (const county of counties) county.geometry.dispose();

  const rampWidth = 256;
  const rampData = new Uint8Array(rampWidth * 2 * 4);
  const rampTexture = new THREE.DataTexture(rampData, rampWidth, 2);
  rampTexture.colorSpace = THREE.SRGBColorSpace;
  rampTexture.minFilter = rampTexture.magFilter = THREE.LinearFilter;

  const uniforms = {
    series: { value: seriesTexture },
    held: { value: heldTexture },
    ramp: { value: rampTexture },
    noDataColor: { value: new THREE.Color(groundColor) },
    occlusion: { value: 1 },
    ...Object.fromEntries(['fromElection', 'toElection', 'progress', 'seconds', 'stagger', 'breath', 'maxHeight', 'minHeight', 'heightExponent', 'heightMode', 'colorGamma']
      .map((name) => [name, { value: 0 }])),
  };
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
    appliedPalette = name;
  }

  const material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  material.customProgramCacheKey = () => 'county-altitude-ramp-v2';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = raiseCounties(shader.vertexShader, varyingsMain);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying float vHeight;
        varying float vFloor;
        varying float vParty;
        varying float vVoted;
        varying float vWall;
        uniform sampler2D ramp;
        uniform float maxHeight;
        uniform float colorGamma;
        uniform vec3 noDataColor;
        uniform float occlusion;`)
      .replace('#include <color_fragment>', /* glsl */ `
        // Colour is altitude: party picks the ramp, and a county fades in as it starts voting.
        float rampU = pow(clamp(vHeight / maxHeight, 0.0, 1.0), colorGamma);
        vec3 rampColor = texture2D(ramp, vec2(rampU, mix(0.25, 0.75, vParty))).rgb;
        diffuseColor.rgb = mix(noDataColor, rampColor, vVoted);`)
      .replace('#include <opaque_fragment>', /* glsl */ `#include <opaque_fragment>
        // Ambient occlusion without a screen pass: a wall darkens where it rises out of its
        // neighbour's roof, or out of the floor at a coast, which is where the columns meet.
        // Depth 0.3 over 4 units is the closest fit to the GTAO pass this replaced.
        gl_FragColor.rgb *= 1.0 - occlusion * 0.3 * vWall * (1.0 - smoothstep(0.0, 4.0, vHeight - vFloor));`);
  };
  // Shadows are rendered with this, so they follow the same heights.
  const depthMaterial = new THREE.MeshDepthMaterial();
  depthMaterial.customProgramCacheKey = () => 'county-height-depth-v1';
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
      const delay = seriesData[(row * columns + years.length) * 4];
      const t = Math.min(Math.max((progress - delay * stagger) / (1 - stagger), 0), 1);
      const eased = t * t * (3 - 2 * t);
      for (let channel = 0; channel < 3; channel++) {
        const before = from < 0 ? heldData[row * 4 + channel] : seriesData[(row * columns + from) * 4 + channel];
        const after = seriesData[(row * columns + to) * 4 + channel];
        heldData[row * 4 + channel] = before + (after - before) * eased;
      }
    }
    heldTexture.needsUpdate = true;
  }

  function update(seconds, currentSettings) {
    uniforms.seconds.value = seconds;
    for (const name of ['stagger', 'breath', 'maxHeight', 'minHeight', 'heightExponent', 'colorGamma']) {
      uniforms[name].value = currentSettings[name];
    }
    uniforms.heightMode.value = heightModes.indexOf(currentSettings.height);
    uniforms.occlusion.value = currentSettings.ambientOcclusion ?? 1;
    if (currentSettings.palette !== appliedPalette) applyPalette(currentSettings.palette);
  }
  show(0, 1, 0);
  update(0, settings);

  return {
    mesh,
    // The scene's enclosing group flips the SVG's downward Y axis.
    position: [-center.x, center.y, 0],
    uniforms,
    show,
    hold,
    update,
    dispose() {
      geometry.dispose();
      material.dispose();
      depthMaterial.dispose();
      rampTexture.dispose();
      seriesTexture.dispose();
      heldTexture.dispose();
    },
  };
}
