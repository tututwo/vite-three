import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { MapControls } from '@react-three/drei/core/MapControls.js';
import { CanvasTexture, FileLoader, MathUtils, SRGBColorSpace, TextureLoader } from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { gsap } from 'gsap';
import {
  basemapBounds, buildSeries, countFlips, defaultSettings, electionAt, groundColor, palettes, years,
} from './electionData.js';
import { createCountyMap } from './mapGeometry.js';
import PostProcessing from './PostProcessing.jsx';

const ease = gsap.parseEase('sine.inOut');
const target = [0, -20, 0];
const mapUrl = `${import.meta.env.BASE_URL}counties.svg`;
const electionsUrl = `${import.meta.env.BASE_URL}elections.json`;
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
const asJson = (loader) => loader.setResponseType('json');
// Start all asset downloads together instead of letting suspending hooks serialize them.
useLoader.preload(SVGLoader, mapUrl);
useLoader.preload(FileLoader, electionsUrl, asJson);
useLoader.preload(TextureLoader, basemapUrl);

function Caption({ timeline, nominees, palette }) {
  const material = useRef(null);
  const caption = useRef(null);
  const gl = useThree((state) => state.gl);
  useLayoutEffect(() => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1024, height: 400 });
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    material.current.map = texture;
    material.current.needsUpdate = true;
    caption.current = { canvas, texture, year: null, palette: null };
    return () => {
      caption.current = null;
      texture.dispose();
    };
  }, [gl]);

  useFrame(() => {
    const current = caption.current;
    if (!current) return;
    const election = electionAt(timeline.current.time);
    const year = years[election];
    if (current.year === year && current.palette === palette) return;
    current.year = year;
    current.palette = palette;
    const { ramps } = palettes[palette];
    const ctx = current.canvas.getContext('2d');
    ctx.clearRect(0, 0, 1024, 400);
    ctx.fillStyle = '#202e45';
    ctx.textAlign = 'center';
    ctx.font = '600 72px system-ui, sans-serif';
    ctx.fillText('Presidential margin', 512, 70);
    ctx.font = '700 170px system-ui, sans-serif';
    ctx.fillText(year, 512, 222);
    for (let x = 0; x < 640; x++) {
      ctx.fillStyle = ramps[x < 320 ? 0 : 1](Math.abs(x - 320) / 320);
      ctx.fillRect(192 + x, 246, 1, 28);
    }
    ctx.fillStyle = '#202e45';
    ctx.font = '500 40px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Democratic', 192, 318);
    ctx.textAlign = 'right';
    ctx.fillText('Republican', 832, 318);
    // Few people remember who ran in 1884; the names sit under their party's end of the ramp.
    ctx.fillStyle = '#747b8e';
    ctx.font = '400 32px system-ui, sans-serif';
    ctx.fillText(nominees[election][1], 832, 362);
    ctx.textAlign = 'left';
    ctx.fillText(nominees[election][0], 192, 362);
    current.texture.needsUpdate = true;
  });

  return (
    <mesh position={[150, -245, 0.2]}>
      <planeGeometry args={[240, 94]} />
      <meshBasicMaterial ref={material} transparent depthWrite={false} />
    </mesh>
  );
}

export default function ElectionScene({ settings, timeline, onYearChange, onReady }) {
  const svg = useLoader(SVGLoader, mapUrl);
  const elections = useLoader(FileLoader, electionsUrl, asJson);
  const basemap = useLoader(TextureLoader, basemapUrl);
  const series = useMemo(() => buildSeries(elections), [elections]);
  const flips = useMemo(() => countFlips(series), [series]);
  const [map, setMap] = useState(null);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  // On demand (paused, no breathing), a new setting or a seek still needs a frame to show it.
  useEffect(() => invalidate(), [invalidate, settings]);

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

  // Ready means the map exists; the flip counts ride along because only the scene has the returns.
  useEffect(() => {
    if (map) onReady(flips);
  }, [map, onReady, flips]);

  useLayoutEffect(() => {
    camera.fov = MathUtils.radToDeg(2 * Math.atan(
      Math.tan(MathUtils.degToRad(15)) * Math.max(1, (16 / 9) / (size.width / size.height)),
    ));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  useFrame((_, delta) => {
    if (!map) return;
    const state = timeline.current;
    const step = Math.min(delta, 0.1);
    state.seconds += step;
    const { transition } = state;
    if (transition) {
      // A seek goes straight from what is on screen to the chosen election, however many elections
      // lie between, and playback (if resumed meanwhile) carries on from there once it lands.
      if (!transition.held) {
        map.hold();
        transition.held = true;
        state.time = transition.to;
        state.year = years[transition.to];
      }
      transition.elapsed += step;
      const progress = Math.min(transition.elapsed / 1.5, 1);
      map.show(-1, transition.to, ease(progress));
      if (progress === 1) state.transition = null;
      else invalidate();
    } else {
      if (settings.playing) {
        state.time = (state.time + step / settings.secondsPerElection) % years.length;
        const year = years[electionAt(state.time)];
        if (year !== state.year) {
          state.year = year;
          onYearChange(year);
        }
      }
      const election = Math.floor(state.time);
      map.show(election, (election + 1) % years.length, state.time - election);
    }
    map.update(state.seconds, settings);
  }, -0.5);

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
      <Caption timeline={timeline} nominees={elections.nominees} palette={settings.palette} />
      <hemisphereLight color="#dfe6ff" groundColor="#3a3440" intensity={settings.fill} position={[0, 0, 1]} />
      <directionalLight color="#e6ecff" intensity={settings.front} position={[-200, -600, 300]} />
      <directionalLight color="#fff4e6" intensity={settings.key}
        position={[settings.keyX, settings.keyY, settings.keyZ]} castShadow
        shadow-mapSize={[2048, 2048]} shadow-radius={settings.shadowSoftness / 2}
        shadow-bias={-0.0003} shadow-normalBias={0.6}
        shadow-camera-left={-520} shadow-camera-right={520}
        shadow-camera-top={420} shadow-camera-bottom={-420}
        shadow-camera-near={100} shadow-camera-far={1600} />
      <MapControls makeDefault target={target} enableDamping dampingFactor={0.05}
        minDistance={150} maxDistance={2000} maxPolarAngle={Math.PI / 2 - 0.15} />
      <PostProcessing settings={settings} counties={map?.mesh} />
    </>
  );
}
