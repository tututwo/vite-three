import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { MapControls } from '@react-three/drei/core/MapControls.js';
import { MathUtils, SRGBColorSpace, TextureLoader, Vector3 } from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { gsap } from 'gsap';
import {
  basemapBounds, defaultSettings, groundColor, years,
} from './electionData.js';
import { createCountyMap } from './mapGeometry.js';
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
function paintBasemap(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', /* glsl */ `
    vec4 basemapColor = texture2D(map, vMapUv);
    diffuseColor.rgb = mix(diffuseColor.rgb, basemapColor.rgb, basemapColor.a);`);
}
const floorProgramKey = () => 'floor-basemap-v1';

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

  // On demand (paused, no breathing), a new setting or a seek still needs a frame to show it.
  useEffect(() => invalidate());

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

  useLayoutEffect(() => {
    const resource = createCountyMap(svg, defaultSettings, series);
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
      <color attach="background" args={[groundColor]} />
      {map ? <group position={map.position} scale={[1, -1, 1]}>
        <primitive object={map.mesh} />
      </group> : null}
      {/* Drawn after the counties, so depth testing skips the floor under them on GPUs without hidden-surface removal. */}
      <mesh receiveShadow renderOrder={1}>
        <planeGeometry args={[floorSize, floorSize]} />
        <meshStandardMaterial color={groundColor} map={basemap} roughness={1}
          onBeforeCompile={paintBasemap} customProgramCacheKey={floorProgramKey} />
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
