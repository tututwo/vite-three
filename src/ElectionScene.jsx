import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { MapControls } from '@react-three/drei/core/MapControls.js';
import { Html } from '@react-three/drei/web/Html.js';
import { Color, MathUtils, SRGBColorSpace, TextureLoader, Vector3 } from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { gsap } from 'gsap';
import {
  basemapBounds, countyMetrics, defaultSettings, groundColor, palettes, years,
} from './electionData.js';
import { civGlsl, createCountyMap } from './mapGeometry.js';
import HexBoard from './HexBoard.jsx';
import PostProcessing from './PostProcessing.jsx';

const ease = gsap.parseEase('sine.inOut');
const target = [0, -20, 0];
const nationalPosition = [-60, -660, 520];
const mapUrl = `${import.meta.env.BASE_URL}counties.svg`;
const basemapUrl = `${import.meta.env.BASE_URL}basemap.svg`;
const [basemapX, basemapY, basemapWidth, basemapHeight] = basemapBounds;
const floorSize = 8000;
// The basemap is painted into the floor's own material, fading to the floor colour through its
// transparent edges, so the floor is one opaque plane shaded once instead of two stacked ones.
// The Civ skin repaints it: the basemap's blue-grey sea becomes ocean, its warm land becomes
// parchment, labels and coasts become ink, and the board's hex grid is drawn over the water.
const floorUniforms = () => ({
  civ: { value: 0 },
  hexSize: { value: 8 }, hexWidth: { value: 0.02 }, gridOcean: { value: 0.16 },
  ...Object.fromEntries(['oceanColor', 'landColor', 'inkColor'].map((name) => [name, { value: new Color() }])),
});
const paintFloor = (uniforms) => (shader) => {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vFloorXY;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloorXY = position.xy;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', /* glsl */ `#include <common>
      varying vec2 vFloorXY;
      uniform float civ;
      uniform float hexSize;
      uniform float hexWidth;
      uniform float gridOcean;
      uniform vec3 oceanColor;
      uniform vec3 landColor;
      uniform vec3 inkColor;
      ${civGlsl}`)
    .replace('#include <map_fragment>', /* glsl */ `
      vec4 basemapColor = texture2D(map, vMapUv);
      vec3 editorial = mix(diffuseColor.rgb, basemapColor.rgb, basemapColor.a);
      // The basemap's sea (#edf1f2) is bluer than its land (#f2f0eb); labels and coastlines are dark.
      float sea = smoothstep(-0.012, 0.02, basemapColor.b - basemapColor.r);
      float ink = 1.0 - smoothstep(0.3, 0.75, dot(basemapColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
      vec3 painted = mix(mix(landColor, oceanColor, sea), inkColor, ink * 0.75);
      vec3 civColor = mix(oceanColor, painted, basemapColor.a);
      float water = mix(1.0, sea, basemapColor.a) * (1.0 - ink);
      civColor = mix(civColor, vec3(1.0), hexLine(vFloorXY, hexSize, hexWidth) * gridOcean * water);
      diffuseColor.rgb = mix(editorial, civColor, civ);`);
};
const floorProgramKey = () => 'floor-basemap-civ-v1';
const civTarget = (settings) => Number(settings.skin === 'civ');

function stopInertia(control, camera) {
  const position = camera.position.clone();
  const lookAt = control.target.clone();
  const damping = control.enableDamping;
  control.enableDamping = false;
  control.update();
  camera.position.copy(position);
  control.target.copy(lookAt);
  control.update();
  control.enableDamping = damping;
}
// Start all asset downloads together instead of letting suspending hooks serialize them.
useLoader.preload(SVGLoader, mapUrl);
useLoader.preload(TextureLoader, basemapUrl);

export default function ElectionScene({ settings, timeline, onYearChange, elections, selectedFips, focusRequest, onReady, captureRef }) {
  const svg = useLoader(SVGLoader, mapUrl);
  const basemap = useLoader(TextureLoader, basemapUrl);
  const series = elections.series;
  const [map, setMap] = useState(null);
  const [contextError, setContextError] = useState(null);
  const controls = useRef(null);
  const focus = useRef(null);
  const capture = useRef(null);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const floor = useMemo(floorUniforms, []);
  const paint = useMemo(() => paintFloor(floor), [floor]);
  const background = useRef(null);
  const backgrounds = useMemo(() => ({ ground: new Color(groundColor), ocean: new Color() }), []);
  const yearIndex = years.indexOf(settings.year);

  // On demand (paused, no breathing), a new setting or a seek still needs a frame to show it.
  useEffect(() => invalidate());

  useLayoutEffect(() => {
    floor.hexSize.value = settings.hexSize;
    floor.hexWidth.value = settings.hexWidth;
    floor.gridOcean.value = settings.gridOcean;
    for (const name of ['oceanColor', 'landColor', 'inkColor']) floor[name].value.set(settings[name]);
    backgrounds.ocean.set(settings.oceanColor);
  }, [floor, backgrounds, settings.hexSize, settings.hexWidth, settings.gridOcean, settings.oceanColor, settings.landColor, settings.inkColor]);

  useEffect(() => {
    const lost = () => {
      const error = new Error('The map graphics context was lost. Reload the map to continue.');
      capture.current?.finish(error);
      setContextError(error);
    };
    gl.domElement.addEventListener('webglcontextlost', lost);
    return () => gl.domElement.removeEventListener('webglcontextlost', lost);
  }, [gl]);

  useLayoutEffect(() => {
    basemap.colorSpace = SRGBColorSpace;
    basemap.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    basemap.needsUpdate = true;
  }, [basemap, gl]);

  // Places the texture's viewBox on the floor. The county group flips the SVG's downward Y, so the
  // viewBox's centre is flipped too; clamping keeps the transparent edge beyond it.
  useLayoutEffect(() => {
    if (!map) return;
    const centerX = map.position[0] + basemapX + basemapWidth / 2;
    const centerY = map.position[1] - basemapY - basemapHeight / 2;
    basemap.repeat.set(floorSize / basemapWidth, floorSize / basemapHeight);
    basemap.offset.set(0.5 - (floorSize / 2 + centerX) / basemapWidth, 0.5 - (floorSize / 2 + centerY) / basemapHeight);
  }, [basemap, map]);

  const mode = useRef(settings.mode);
  mode.current = settings.mode;
  useLayoutEffect(() => {
    const resource = createCountyMap(svg, defaultSettings, series);
    resource.uniforms.flatten.value = Number(mode.current === 'territory');
    setMap(resource);
    return () => resource.dispose();
  }, [svg, series]);

  useEffect(() => {
    if (!map) return;
    onReady(true);
    return () => onReady(false);
  }, [map, onReady]);

  useLayoutEffect(() => {
    if (!map) return;
    map.select(selectedFips);
    invalidate();
  }, [map, selectedFips, invalidate]);

  // The elector board replaces the counties; the counties come back as they were when it leaves.
  const electors = settings.mode === 'electors';
  useLayoutEffect(() => {
    if (!map) return;
    map.mesh.visible = !electors;
    invalidate();
  }, [map, electors, invalidate]);

  // Each state's centre (county centres weighted by their extent) seeds its cluster on the elector board,
  // and the mainland's width converts the layout's hand nudges from Albers pixels to world units.
  const states = elections.electoral?.states;
  const board = useMemo(() => {
    if (!map || !states) return null;
    const codeOf = Object.fromEntries(Object.entries(states).map(([code, { fips }]) => [fips, code]));
    const sums = {};
    let west = Infinity, east = -Infinity;
    for (const [fips, { center, bounds }] of map.counties) {
      const code = codeOf[fips.slice(0, 2)];
      if (!code) continue;
      const weight = Math.max((bounds.max.x - bounds.min.x) * (bounds.max.y - bounds.min.y), 1e-3);
      const sum = sums[code] ??= [0, 0, 0];
      sum[0] += center.x * weight; sum[1] += center.y * weight; sum[2] += weight;
      if (code !== 'AK' && code !== 'HI') { west = Math.min(west, bounds.min.x); east = Math.max(east, bounds.max.x); }
    }
    return { centers: Object.fromEntries(Object.entries(sums).map(([code, [x, y, weight]]) => [code, [x / weight, y / weight]])), scale: (east - west) / 905 };
  }, [map, states]);
  const election = elections.electoral?.elections[yearIndex];

  // Changing modes or pausing lands on a real election, never a mixture of metrics.
  useLayoutEffect(() => {
    if (!map) return;
    const state = timeline.current;
    const index = state.transition?.to ?? Math.max(0, years.indexOf(state.year));
    state.time = index;
    state.year = years[index];
    state.transition = null;
    map.setMode(settings.mode);
    map.show(index, index, 0);
    invalidate();
  }, [map, settings.mode, settings.playing, timeline, invalidate]);

  useLayoutEffect(() => {
    camera.fov = MathUtils.radToDeg(2 * Math.atan(
      Math.tan(MathUtils.degToRad(15)) * Math.max(1, (16 / 9) / (size.width / size.height)),
    ));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  useLayoutEffect(() => {
    if (!map || !focusRequest || !controls.current) return;
    const county = focusRequest.fips ? map.counties.get(focusRequest.fips) : null;
    if (focusRequest.fips && !county) return;
    const control = controls.current;
    stopInertia(control, camera);
    const toTarget = county ? county.center.clone() : new Vector3(...target);
    const toPosition = new Vector3(...nationalPosition);
    if (county) {
      const extent = county.bounds.getSize(new Vector3());
      const span = Math.max(extent.x / camera.aspect, extent.y, 45);
      const distance = MathUtils.clamp(span / (2 * Math.tan(MathUtils.degToRad(camera.fov / 2))) * 1.8, 160, 1800);
      toTarget.z = 12;
      toPosition.copy(camera.position).sub(control.target).normalize().multiplyScalar(distance).add(toTarget);
    }
    focus.current = {
      fromPosition: camera.position.clone(), fromTarget: control.target.clone(),
      toPosition, toTarget, elapsed: 0,
    };
    invalidate();
  }, [map, focusRequest, camera, invalidate]);

  useLayoutEffect(() => {
    if (!captureRef || !map) return;
    captureRef.current = () => new Promise((resolve, reject) => {
      if (capture.current) return reject(new Error('A map capture is already in progress.'));
      if (gl.getContext().isContextLost()) return reject(new Error('The map graphics context is unavailable.'));
      const control = controls.current;
      const enabled = control.enabled;
      const damping = control.enableDamping;
      const request = {
        ready: false,
        finish(error, canvas) {
          if (capture.current !== request) return;
          clearTimeout(request.timeout);
          capture.current = null;
          control.enabled = enabled;
          control.enableDamping = damping;
          invalidate();
          if (error) reject(error);
          else resolve(canvas);
        },
      };
      capture.current = request;
      control.enabled = false;
      request.timeout = setTimeout(() => request.finish(new Error('The map did not finish rendering. Please try again.')), 10000);
      invalidate();
    });
    return () => {
      captureRef.current = null;
      capture.current?.finish(new Error('The map closed before capture completed.'));
    };
  }, [captureRef, map, gl, invalidate]);

  useFrame((_, delta) => {
    if (!map) return;
    const state = timeline.current;
    const step = Math.min(delta, 0.1);
    const request = capture.current;
    const control = controls.current;
    const movement = focus.current;
    if (movement) {
      movement.elapsed += step;
      const progress = settings.reducedMotion || request ? 1 : Math.min(movement.elapsed / 0.8, 1);
      camera.position.lerpVectors(movement.fromPosition, movement.toPosition, ease(progress));
      control.target.lerpVectors(movement.fromTarget, movement.toTarget, ease(progress));
      control.update();
      if (progress === 1) focus.current = null;
      else invalidate();
    }
    if (request && !request.ready) {
      // Flush controls' inertia without changing the captured camera pose.
      stopInertia(control, camera);
      control.enableDamping = false;
      state.time = state.transition?.to ?? Math.max(0, years.indexOf(state.year));
      state.year = years[state.time];
      state.transition = null;
      request.ready = true;
    }
    if (!request && !settings.reducedMotion) state.seconds += step;
    const { transition } = state;
    if (transition) {
      if (!transition.held) {
        map.hold();
        transition.held = true;
        state.time = transition.to;
        state.year = years[transition.to];
      }
      transition.elapsed += step;
      const progress = settings.reducedMotion ? 1 : Math.min(transition.elapsed / 1.5, 1);
      map.show(-1, transition.to, ease(progress));
      if (progress === 1) state.transition = null;
      else invalidate();
    } else {
      if (settings.playing && !request) {
        state.time = (state.time + step / settings.secondsPerElection) % years.length;
        // Stay at the final election before restarting. Never interpolate 2020 into 1868.
        const index = Math.min(Math.round(state.time), years.length - 1);
        if (years[index] !== state.year) {
          state.year = years[index];
          onYearChange(state.year);
        }
      }
      const election = settings.reducedMotion ? Math.min(Math.round(state.time), years.length - 1) : Math.floor(state.time);
      const next = Math.min(election + 1, years.length - 1);
      map.show(election, next, settings.reducedMotion ? 0 : state.time - election);
    }
    map.update(state.seconds, request ? { ...settings, breath: 0 } : settings);
    // Territory is the flat strategic view: the columns settle onto the floor, and rise again when leaving it.
    const flatten = map.uniforms.flatten;
    const flat = Number(settings.mode === 'territory' || settings.mode === 'electors');
    if (flatten.value !== flat) {
      flatten.value = settings.reducedMotion || request ? flat : MathUtils.damp(flatten.value, flat, 4, step);
      if (Math.abs(flatten.value - flat) < 0.002) flatten.value = flat;
      else invalidate();
    }
    // The Civ skin fades in and out over the floor, the background and the counties together.
    const civ = floor.civ;
    const skin = civTarget(settings);
    if (civ.value !== skin) {
      civ.value = settings.reducedMotion || request ? skin : MathUtils.damp(civ.value, skin, 3, step);
      if (Math.abs(civ.value - skin) < 0.002) civ.value = skin;
      else invalidate();
    }
    map.uniforms.civ.value = civ.value;
    background.current?.copy(backgrounds.ground).lerp(backgrounds.ocean, civ.value);
  }, -0.5);

  function captureFrame(canvas) {
    const request = capture.current;
    if (!request?.ready) return;
    try {
      // The final render has just finished; copy now, before the browser clears its WebGL buffer.
      if (gl.getContext().isContextLost()) throw new Error('The map graphics context was lost.');
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d');
      if (!copy.width || !copy.height || !context) throw new Error('The map image could not be captured.');
      context.drawImage(canvas, 0, 0);
      request.finish(null, copy);
    } catch (error) {
      request.finish(error);
    }
  }

  if (contextError) throw contextError;

  return (
    <>
      <color ref={background} attach="background" args={[groundColor]} />
      {map ? <group position={map.position} scale={[1, -1, 1]}>
        <primitive object={map.mesh} />
        <primitive object={map.borders} />
      </group> : null}
      {electors && board && election && <HexBoard election={election} centers={board.centers} scale={board.scale} settings={settings} palette={palettes[settings.palette]} />}
      {map && settings.skin === 'civ' && settings.mode === 'territory' && settings.bannerCount > 0
        && <CountyBanners elections={elections} counties={map.counties} yearIndex={yearIndex} count={settings.bannerCount} spacing={settings.bannerSpacing} />}
      {/* Drawn after the counties, so depth testing skips the floor under them on GPUs without hidden-surface removal. */}
      <mesh receiveShadow renderOrder={1}>
        <planeGeometry args={[floorSize, floorSize]} />
        <meshStandardMaterial color={groundColor} map={basemap} roughness={1}
          onBeforeCompile={paint} customProgramCacheKey={floorProgramKey} />
      </mesh>
      <hemisphereLight color="#dfe6ff" groundColor="#3a3440" intensity={settings.fill} position={[0, 0, 1]} />
      <directionalLight color="#e6ecff" intensity={settings.front} position={[-200, -600, 300]} />
      <directionalLight color="#fff4e6" intensity={settings.key}
        position={[settings.keyX, settings.keyY, settings.keyZ]} castShadow
        shadow-mapSize={[2048, 2048]} shadow-radius={settings.shadowSoftness / 2}
        shadow-bias={-0.0003} shadow-normalBias={0.6}
        shadow-camera-left={-520} shadow-camera-right={520}
        shadow-camera-top={420} shadow-camera-bottom={-420}
        shadow-camera-near={100} shadow-camera-far={1600} />
      <MapControls ref={controls} makeDefault target={target} enableDamping={!settings.reducedMotion} dampingFactor={0.05}
        onStart={() => { focus.current = null; }}
        minDistance={150} maxDistance={2000} maxPolarAngle={Math.PI / 2 - 0.15} />
      <PostProcessing settings={settings} counties={map?.mesh} onRendered={captureFrame}
        onRenderError={(error) => { if (!capture.current) throw error; capture.current.finish(error); }} />
    </>
  );
}

const compact = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
const flag = <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 15V1.5h1.5V2h9l-2 3.5 2 3.5h-9v6z" fill="currentColor" /></svg>;

// Civ city banners over the counties that cast the most votes this election: votes, name, and a flag
// where the county changed hands. Screen-aligned like Civ's, so they stay legible at any angle.
// Neighbours closer than `spacing` world units give way to the bigger county, so banners never stack.
function CountyBanners({ elections, counties, yearIndex, count, spacing }) {
  const banners = useMemo(() => Object.entries(elections.counties)
    .map(([fips, county]) => ({ fips, ...countyMetrics(county, yearIndex) }))
    .filter(({ fips, total, leader }) => total && leader && counties.has(fips))
    .sort((a, b) => b.total - a.total)
    .reduce((kept, county) => kept.length < count && kept.every(({ fips }) => counties.get(fips).center.distanceTo(counties.get(county.fips).center) >= spacing)
      ? [...kept, county] : kept, [])
    .map((county) => {
      const before = yearIndex ? countyMetrics(elections.counties[county.fips], yearIndex - 1).leader : null;
      return { ...county, name: elections.countyNames?.[county.fips]?.name ?? county.fips, center: counties.get(county.fips).center,
        captured: Boolean(before && before !== 'tie' && county.leader !== 'tie' && before !== county.leader) };
    }), [elections, counties, yearIndex, count, spacing]);
  return banners.map(({ fips, name, total, leader, captured, center }) => <Html key={fips} position={[center.x, center.y, 1.5]} zIndexRange={[30, 0]} pointerEvents="none">
    <div className={`civ-banner civ-banner-${leader}${captured ? ' is-captured' : ''}`}>
      <span className="civ-banner-votes">{compact(total)}</span>
      <span className="civ-banner-name">{name}{captured && flag}</span>
    </div>
  </Html>);
}
