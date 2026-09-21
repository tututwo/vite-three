import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  const outlineMesh = useRef(null);
  const hovered = useRef(null);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);

  useLayoutEffect(() => {
    basemap.colorSpace = SRGBColorSpace;
    basemap.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    basemap.needsUpdate = true;
  }, [basemap, gl]);

  useLayoutEffect(() => {
    const resource = createCountyMap(svg, defaultSettings, series);
    setMap(resource);
    return () => {
      hovered.current = null;
      resource.dispose();
    };
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
    if (settings.playing) {
      const interruptedSeek = state.transition !== null;
      state.transition = null;
      state.time = (state.time + step / settings.secondsPerElection) % years.length;
      const year = years[electionAt(state.time)];
      if (interruptedSeek || year !== state.year) {
        state.year = year;
        onYearChange(year);
      }
    } else if (state.transition) {
      const transition = state.transition;
      transition.elapsed += step;
      const progress = Math.min(transition.elapsed / 1.5, 1);
      state.time = MathUtils.lerp(transition.from, transition.to, ease(progress));
      if (progress === 1) state.transition = null;
      state.year = years[electionAt(state.time)];
    }
    map.update(state.time, state.seconds, settings);
    if (hovered.current && outlineMesh.current) outlineMesh.current.scale.z = hovered.current.height;
  }, -0.5);

  const clearHover = useCallback(() => {
    hovered.current = null;
    if (outlineMesh.current) outlineMesh.current.visible = false;
  }, []);

  return (
    <>
      <color attach="background" args={[groundColor]} />
      {map ? <group position={map.position} scale={[1, -1, 1]}>
        <primitive object={map.mesh} onPointerMove={(event) => {
          if (event.isPrimary === false) return;
          event.stopPropagation();
          const county = map.counties[event.batchId];
          if (!county) return;
          hovered.current = county;
          outlineMesh.current.geometry = county.geometry;
          outlineMesh.current.scale.z = county.height;
          outlineMesh.current.visible = true;
        }} onPointerOut={clearHover} />
        <mesh ref={outlineMesh} visible={false}>
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      </group> : null}
      <mesh receiveShadow>
        <planeGeometry args={[8000, 8000]} />
        <meshStandardMaterial color={groundColor} roughness={1} />
      </mesh>
      {/* Centred on the texture's viewBox; the county group flips the SVG's downward Y, so this does too. */}
      {map ? <mesh receiveShadow position={[
        map.position[0] + basemapX + basemapWidth / 2, map.position[1] - basemapY - basemapHeight / 2, 0.05,
      ]}>
        <planeGeometry args={[basemapWidth, basemapHeight]} />
        <meshStandardMaterial map={basemap} transparent roughness={1} depthWrite={false} />
      </mesh> : null}
      <Caption timeline={timeline} nominees={elections.nominees} palette={settings.palette} />
      <hemisphereLight color="#dfe6ff" groundColor="#3a3440" intensity={settings.fill} position={[0, 0, 1]} />
      <directionalLight color="#e6ecff" intensity={settings.front} position={[-200, -600, 300]} />
      <directionalLight color="#fff4e6" intensity={settings.key}
        position={[settings.keyX, settings.keyY, settings.keyZ]} castShadow
        shadow-mapSize={[4096, 4096]} shadow-radius={settings.shadowSoftness}
        shadow-bias={-0.0003} shadow-normalBias={0.6}
        shadow-camera-left={-520} shadow-camera-right={520}
        shadow-camera-top={420} shadow-camera-bottom={-420}
        shadow-camera-near={100} shadow-camera-far={1600} />
      <MapControls makeDefault target={target} enableDamping dampingFactor={0.05}
        minDistance={150} maxDistance={2000} maxPolarAngle={Math.PI / 2 - 0.15}
        onStart={clearHover} />
      <PostProcessing settings={settings} outlineMesh={outlineMesh} />
    </>
  );
}
