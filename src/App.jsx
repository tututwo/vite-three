import { Component, lazy, Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { defaultSettings, heightModes, years } from './electionData.js';

const ElectionScene = lazy(() => import('./ElectionScene.jsx'));
const camera = { position: [-60, -660, 520], up: [0, 0, 1], fov: 30, near: 10, far: 6000 };
const renderer = { antialias: false }; // The final FXAA pass owns antialiasing.
const initialSettings = {
  ...defaultSettings,
  fill: 1.2, front: 1, key: 2.4,
  keyX: -380, keyY: 260, keyZ: 620, shadowSoftness: 10,
  ambientOcclusion: 1, depthOfField: true, vignette: true,
};

class SceneErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    return this.state.error ? (
      <div className="scene-status" role="alert">
        <p>The map could not load: {this.state.error.message}</p>
        <button onClick={() => window.location.reload()}>Reload map</button>
      </div>
    ) : this.props.children;
  }
}

function Slider({ name, label, min, max, step = 0.01, settings, onChange }) {
  return (
    <label className="slider-control">
      <span>{label}<output>{settings[name]}</output></span>
      <input type="range" aria-label={label} name={name} min={min} max={max} step={step}
        value={settings[name]} onChange={(event) => onChange(name, event.target.valueAsNumber)} />
    </label>
  );
}

export default function App() {
  const [settings, setSettings] = useState(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return { ...initialSettings, playing: !reducedMotion, breath: reducedMotion ? 0 : initialSettings.breath };
  });
  const [year, setYear] = useState(years[0]);
  const [seek, setSeek] = useState(null);
  const [ready, setReady] = useState(false);
  const updateSetting = (name, value) => setSettings((current) => ({ ...current, [name]: value }));
  const sliderProps = { settings, onChange: updateSetting };

  return (
    <main>
      <SceneErrorBoundary>
        <Canvas flat shadows="percentage" camera={camera} gl={renderer} dpr={[1, 2]}
          fallback={<p>This interactive 3D map requires WebGL.</p>}
          aria-label="Animated three-dimensional county election map">
          <Suspense fallback={null}>
            <ElectionScene settings={settings} seek={seek} onYearChange={setYear} onReady={setReady} />
          </Suspense>
        </Canvas>
        {!ready ? <div className="scene-status" role="status">Loading county map…</div> : null}
      </SceneErrorBoundary>
      <aside className="controls" aria-label="Map controls">
        <h1>3D Election Map</h1>
        <label className="select-control">Election year
          <select value={year} onChange={(event) => {
            const nextYear = Number(event.target.value);
            setYear(nextYear);
            updateSetting('playing', false);
            setSeek({ year: nextYear });
          }}>
            {years.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button className="play-button" onClick={() => updateSetting('playing', !settings.playing)}>
          {settings.playing ? 'Pause animation' : 'Play animation'}
        </button>
        <label className="select-control">Height metric
          <select value={settings.height} onChange={(event) => updateSetting('height', event.target.value)}>
            {heightModes.map((mode) => <option key={mode}>{mode}</option>)}
          </select>
        </label>
        <details>
          <summary>Animation & height</summary>
          <Slider {...sliderProps} name="secondsPerElection" label="Seconds per election" min={0.5} max={10} step={0.1} />
          <Slider {...sliderProps} name="stagger" label="Wave stagger" min={0} max={0.9} />
          <Slider {...sliderProps} name="breath" label="Breathing" min={0} max={0.15} />
          <Slider {...sliderProps} name="maxHeight" label="Maximum height" min={10} max={250} step={1} />
          <Slider {...sliderProps} name="heightExponent" label="Height exponent" min={0.5} max={4} step={0.1} />
          <Slider {...sliderProps} name="colorGamma" label="Color gamma" min={0.2} max={2} step={0.1} />
        </details>
        <details>
          <summary>Lights & effects</summary>
          <Slider {...sliderProps} name="fill" label="Fill light" min={0} max={5} step={0.1} />
          <Slider {...sliderProps} name="front" label="Front light" min={0} max={5} step={0.1} />
          <Slider {...sliderProps} name="key" label="Key light" min={0} max={8} step={0.1} />
          <Slider {...sliderProps} name="keyX" label="Key position X" min={-800} max={800} step={1} />
          <Slider {...sliderProps} name="keyY" label="Key position Y" min={-800} max={800} step={1} />
          <Slider {...sliderProps} name="keyZ" label="Key position Z" min={100} max={1200} step={1} />
          <Slider {...sliderProps} name="shadowSoftness" label="Shadow softness" min={0} max={12} step={0.1} />
          <Slider {...sliderProps} name="ambientOcclusion" label="Ambient occlusion" min={0} max={2} step={0.1} />
          <label className="checkbox-control"><input type="checkbox" checked={settings.depthOfField}
            onChange={(event) => updateSetting('depthOfField', event.target.checked)} />Depth of field</label>
          <label className="checkbox-control"><input type="checkbox" checked={settings.vignette}
            onChange={(event) => updateSetting('vignette', event.target.checked)} />Vignette</label>
        </details>
        <p className="hint">Drag to pan · Scroll to zoom · Right-drag to orbit</p>
      </aside>
    </main>
  );
}
