import { Component, lazy, Suspense, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { defaultSettings, heightModes, paletteNames, palettes, years } from './electionData.js';

const ElectionScene = lazy(() => import('./ElectionScene.jsx'));
const camera = { position: [-60, -660, 520], up: [0, 0, 1], fov: 30, near: 10, far: 6000 };
const renderer = { antialias: false }; // The postprocessing composer owns MSAA.
const initialSettings = {
  ...defaultSettings,
  fill: 1.2, front: 1, key: 2.4,
  keyX: -380, keyY: 260, keyZ: 620, shadowSoftness: 10,
  ambientOcclusion: 1, depthOfField: false, vignette: true,
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

// The header's stat: the share of counties that flipped, big; the count and the split, small. It
// changes every couple of seconds, so it has to read at a glance: numbers and a bar, no sentences.
export function FlipCount({ flips, accents, fills, previousYear }) {
  if (!flips) return <div className="flip-stat" aria-hidden="true" />;
  if (previousYear === undefined) {
    return <div className="flip-stat"><p className="flip-title">The first election in this series</p></div>;
  }
  const total = flips.toDemocratic + flips.toRepublican;
  const share = flips.compared ? total / flips.compared : 0;
  return (
    <div className="flip-stat">
      <p className="flip-title">
        <strong>{share.toLocaleString(undefined, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong>
        of counties flipped since {previousYear}
        <small>{total.toLocaleString()} of {flips.compared.toLocaleString()} counties</small>
      </p>
      <div className="flip-chart">
        <p className="flip-side">
          <strong style={{ color: accents[0] }}>{flips.toDemocratic.toLocaleString()}</strong> to Democrats
        </p>
        {/* Each half grows with its count, so the seam shows the split; the tick marks an even one. */}
        <div className="flip-bar" aria-hidden="true">
          <span style={{ flexGrow: flips.toDemocratic, background: fills[0] }} />
          <span style={{ flexGrow: flips.toRepublican, background: fills[1] }} />
        </div>
        <p className="flip-side">
          <strong style={{ color: accents[1] }}>{flips.toRepublican.toLocaleString()}</strong> to Republicans
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return { ...initialSettings, playing: !reducedMotion, breath: reducedMotion ? 0 : initialSettings.breath };
  });
  const [year, setYear] = useState(years[0]);
  // Playback position, shared with the scene's frame loop. A ref, so ticking it never re-renders.
  const timeline = useRef({ time: 0, seconds: 0, year: years[0], transition: null });
  const [flips, setFlips] = useState(null); // per election, handed up by the scene once the map is ready
  const [controlsOpen, setControlsOpen] = useState(() => window.matchMedia('(min-width: 761px)').matches);
  const updateSetting = (name, value) => setSettings((current) => ({ ...current, [name]: value }));
  const sliderProps = { settings, onChange: updateSetting };
  const yearIndex = years.indexOf(year);
  const palette = palettes[settings.palette];
  const current = flips?.[yearIndex];
  const shares = flips?.map((election) => (election.compared
    ? (election.toDemocratic + election.toRepublican) / election.compared : 0)) ?? [];
  const peak = Math.max(...shares, 0.01);
  // Pauses, then the scene's frame loop eases the map from wherever it is to the chosen election.
  // Playback shows 1868 just before it wraps, so a step on from there starts below zero, not at 2020.
  const seek = (index) => {
    const from = timeline.current.time;
    setYear(years[index]);
    updateSetting('playing', false);
    timeline.current.transition = { from: from > years.length - 0.5 ? from - years.length : from, to: index, elapsed: 0 };
  };

  return (
    <main>
      <SceneErrorBoundary>
        <Canvas flat shadows="percentage" camera={camera} gl={renderer} dpr={[1.5, 2]}
          fallback={<p>This interactive 3D map requires WebGL.</p>}
          aria-label="Animated three-dimensional county election map">
          <Suspense fallback={null}>
            <ElectionScene settings={settings} timeline={timeline} onYearChange={setYear} onReady={setFlips} />
          </Suspense>
        </Canvas>
        {!flips ? <div className="scene-status" role="status">Loading county map…</div> : null}
      </SceneErrorBoundary>
      <header className="map-header">
        <h1>Presidential margins</h1>
        <p className="map-subtitle">
          The taller the county, the wider the gap between the Democratic and Republican candidates.
        </p>
        <div className="map-flips">
          {/* Remounted each election, so the wash restarts its fade in the colour of the side that gained. */}
          {current && yearIndex ? <span key={year} className="flip-wash" aria-hidden="true"
            style={{ background: palette.fills[current.toRepublican > current.toDemocratic ? 1 : 0] }} /> : null}
          <FlipCount flips={current} accents={palette.accents} fills={palette.fills} previousYear={years[yearIndex - 1]} />
          {/* The year control is also a chart, one bar per election's flip share, so the big years show where to jump. */}
          <div className="flip-timeline">
            <button type="button" className="step-button" aria-label="Previous election" disabled={yearIndex === 0}
              onClick={() => seek(yearIndex - 1)}>‹</button>
            <div className="flip-history">
              {shares.map((share, index) => <span key={years[index]} style={{
                left: `${(index / (years.length - 1)) * 100}%`, height: `${(share / peak) * 100}%`,
                background: palette.fills[flips[index].toRepublican > flips[index].toDemocratic ? 1 : 0],
              }} />)}
              <input type="range" min={0} max={years.length - 1} value={yearIndex} aria-label="Election year"
                aria-valuetext={String(year)} onChange={(event) => seek(event.target.valueAsNumber)} />
            </div>
            <button type="button" className="step-button" aria-label="Next election" disabled={yearIndex === years.length - 1}
              onClick={() => seek(yearIndex + 1)}>›</button>
          </div>
          <p className="flip-axis" aria-hidden="true"><span>{years[0]}</span><span>{years.at(-1)}</span></p>
        </div>
      </header>
      {/* Method and credit sit where a newspaper graphic keeps them: small, at the foot, out of the headline. */}
      <p className="map-note">
        <span>Note: A flip is a change in which major party led a county. Third-party winners, as in 1912 and 1968, are not shown.</span>
        <span>Sources: Amlani and Algara, Harvard Dataverse; U.S. Census Bureau; Natural Earth</span>
      </p>
      <aside className="controls" aria-label="Map controls">
        <details className="controls-panel" open={controlsOpen}
          onToggle={(event) => setControlsOpen(event.currentTarget.open)}>
          <summary className="controls-heading">
            <span>Map controls<small>View & playback</small></span>
            <svg className="disclosure-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="controls-content">
            <button className="play-button" onClick={() => updateSetting('playing', !settings.playing)}>
              {settings.playing ? 'Pause animation' : 'Play animation'}
            </button>
            <label className="select-control">Height metric
              <select value={settings.height} onChange={(event) => updateSetting('height', event.target.value)}>
                {heightModes.map((mode) => <option key={mode}>{mode}</option>)}
              </select>
            </label>
            <label className="select-control palette-control">Color palette
              <select value={settings.palette} onChange={(event) => updateSetting('palette', event.target.value)}>
                {paletteNames.map((name) => <option key={name}>{name}</option>)}
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
          </div>
        </details>
      </aside>
    </main>
  );
}
