import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { buildSeries, countFlips, defaultSettings, heightModes, marginLabel, paletteNames, palettes, rankCounties, shiftLabel, years } from './electionData.js';

import CountySearch from './CountySearch.jsx';
import CountyDetails from './CountyDetails.jsx';
import { parseViewState, serializeViewState } from './viewState.js';
import { downloadCard } from './exportCard.js';

const ElectionScene = lazy(() => import('./ElectionScene.jsx'));
const camera = { position: [-60, -660, 520], up: [0, 0, 1], fov: 30, near: 10, far: 6000 };
// Multisampling below 2x pixel ratio only: at 2x the pixels are small enough, and the samples
// would add to every frame on exactly the laptops that run hot.
const renderer = { antialias: globalThis.devicePixelRatio < 2 };
const initialSettings = {
  ...defaultSettings,
  fill: 1.2, front: 1, key: 2.4,
  keyX: -380, keyY: 260, keyZ: 620, shadowSoftness: 10,
  ambientOcclusion: 1, depthOfField: false, vignette: true,
};

class SceneErrorBoundary extends Component {
  state = { error: null };
  componentDidCatch() { this.props.onError?.(); }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    return this.state.error ? (
      <div className="scene-status" role="alert">
        <p>The 3D map could not load (WebGL is required): {this.state.error.message}</p>
        <p>County search, rankings and history remain available below.</p><button onClick={() => window.location.reload()}>Reload map</button>
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

// The primary finding, using only counties with returns in both elections.
export function FlipCount({ flips, fills, previousYear }) {
  if (!flips) return null;
  if (previousYear === undefined) {
    return <p className="flip-stat">The first election in this series. Choose a later year to compare.</p>;
  }
  if (!flips.compared) return <p className="flip-stat">No comparable county returns for this election and {previousYear}.</p>;
  const total = flips.toDemocratic + flips.toRepublican;
  const share = total / flips.compared;
  return (
    <div className="flip-stat" role="group" aria-label="Nationwide changes in the Democratic–Republican lead">
      <dl className="flip-metrics">
        <div><dt>Counties flipped</dt><dd>{total.toLocaleString()}</dd></div>
        <div><dt>Share of counties</dt><dd>{share.toLocaleString(undefined, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })}</dd></div>
      </dl>
      <p>Of {flips.compared.toLocaleString()} counties with returns in both elections.</p>
      <p className="flip-directions">
        <span><i className="party-swatch" style={{ background: fills[0] }} aria-hidden="true" />{flips.toDemocratic.toLocaleString()} to Democrats</span>
        <span><i className="party-swatch" style={{ background: fills[1] }} aria-hidden="true" />{flips.toRepublican.toLocaleString()} to Republicans</span>
      </p>
    </div>
  );
}

export function CountyRanking({ elections, yearIndex, fills, mode = 'result', flippedOnly = false, onFilterChange = () => {}, onSelect = () => {}, selectedFips, onInteract = () => {} }) {
  const [showAll, setShowAll] = useState(false);
  const ranked = useMemo(() => elections ? rankCounties(elections.counties, yearIndex, mode, flippedOnly && yearIndex > 0) : [], [elections, yearIndex, mode, flippedOnly]);
  const shift = mode === 'shift';
  const ceiling = Math.max(10, Math.ceil((ranked[0]?.value ?? 0) / 10) * 10);
  return <section className="county-ranking" aria-labelledby="ranking-title">
    <div className="ranking-heading">
      <p className="section-kicker">County ranking · {years[yearIndex]}</p>
      <h2 id="ranking-title">{shift ? 'Largest shifts' : 'Largest leads'}</h2>
      <p className="ranking-description">{shift ? 'Change in D/R margin since the previous election.' : 'D/R vote margin as a share of all votes.'}</p>
    </div>
    <label className="checkbox-control ranking-filter"><input type="checkbox" checked={flippedOnly && yearIndex > 0} disabled={!yearIndex}
      onChange={(event) => onFilterChange(event.target.checked)} />Flipped counties only</label>
    {!yearIndex && <p className="ranking-note">Flip filtering starts in 1872. Result shows all available counties.</p>}
    {!elections ? <p className="ranking-empty" role="status">Loading county returns…</p>
      : shift && !yearIndex ? <p className="ranking-empty">No previous election comparison. Choose 1872 or later.</p>
        : !ranked.length ? <p className="ranking-empty">{flippedOnly ? 'No counties changed their D/R lead in this comparison.' : 'No valid county returns for this view.'}</p>
          : <>
            <ol key={`${yearIndex}-${mode}-${flippedOnly}`} id="county-rankings" className={`county-bars${showAll ? ' expanded' : ''}`} tabIndex={showAll ? 0 : undefined}>
              {(showAll ? ranked : ranked.slice(0, 5)).map((county, index) => {
                const location = elections.countyNames?.[county.fips] ?? { name: county.fips, state: '' };
                const value = shift ? county.shift : county.margin;
                return <li key={county.fips}>
                  <button className="county-choice" aria-pressed={selectedFips === county.fips} onClick={() => onSelect(county.fips)}>
                    <span className="county-rank" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    <span className="county-row-content">
                      <span className="county-label"><span className="county-name">{location.name}</span>
                        <strong>{shift ? <>{county.value.toFixed(1)}<small> pp</small></> : marginLabel(county.margin)}</strong></span>
                      <span className="county-comparison"><span>{location.state}</span><span>{shift ? shiftLabel(value).replace(/ [\d.]+ pp$/, '') : `${county.total.toLocaleString()} votes`}{county.flipped ? ' · Flipped' : ''}</span></span>
                      <span className="county-bar-track" aria-hidden="true"><span style={{ width: `${county.value / ceiling * 100}%`, background: value === 0 ? '#999' : fills[value > 0 ? 0 : 1] }} /></span>
                      {shift && <span className="county-previous">{marginLabel(county.previousMargin)} → {marginLabel(county.margin)} · {county.total.toLocaleString()} votes</span>}
                    </span>
                  </button>
                </li>;
              })}
            </ol>
            <button type="button" className="ranking-expand" aria-expanded={showAll} aria-controls="county-rankings" onClick={() => { setShowAll(!showAll); onInteract(); }}>
              {showAll ? 'Show top 5' : `View all ${ranked.length.toLocaleString()} ${flippedOnly && yearIndex > 0 ? 'flipped ' : ''}counties`}<span aria-hidden="true">{showAll ? '−' : '+'}</span>
            </button>
            <p className="ranking-note">{shift ? 'pp = percentage points. ' : ''}Ranked by absolute {shift ? 'shift' : 'margin'}. Filtering affects this list only.</p>
          </>}
  </section>;
}

export default function App() {
  const [view, setView] = useState(() => parseViewState(window.location.href));
  const viewRef = useRef(view);
  const [visual, setVisual] = useState(() => ({ ...initialSettings, playing: false,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches }));
  const settings = useMemo(() => ({ ...visual, ...view, breath: visual.reducedMotion ? 0 : visual.breath }), [visual, view]);
  const timeline = useRef({ time: years.indexOf(view.year), seconds: 0, year: view.year, transition: null });
  const [elections, setElections] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [controlsOpen, setControlsOpen] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [focusRequest, setFocusRequest] = useState({ fips: view.county, id: 0 });
  const [exporting, setExporting] = useState(false);
  const exportBusy = useRef(false);
  const captureRef = useRef(null);
  const [feedback, setFeedback] = useState('');
  const [manualLink, setManualLink] = useState('');
  const yearIndex = years.indexOf(view.year);
  const palette = palettes[view.palette];
  const nominees = elections?.nominees[yearIndex];
  const snap = (year) => Object.assign(timeline.current, { time: years.indexOf(year), year, transition: null });
  const pause = () => { snap(viewRef.current.year); setVisual((current) => ({ ...current, playing: false })); };
  const changeView = (patch) => {
    const next = { ...viewRef.current, ...patch };
    viewRef.current = next; setView(next);
    setVisual((current) => ({ ...current, playing: false }));
    snap(next.year);
    window.history.pushState(null, '', serializeViewState(next, window.location.href));
    setManualLink(''); setFeedback('');
  };
  const updateSetting = (name, value) => {
    if (name === 'palette' || name === 'height') changeView({ [name]: value });
    else setVisual((current) => ({ ...current, [name]: value }));
  };
  const sliderProps = { settings, onChange: updateSetting };
  const selectCounty = (fips) => { changeView({ county: fips }); setFocusRequest((current) => ({ fips, id: current.id + 1 })); };
  const focus = (fips) => { pause(); setFocusRequest((current) => ({ fips, id: current.id + 1 })); };
  const playbackYear = (year) => {
    const next = { ...viewRef.current, year };
    viewRef.current = next; setView(next);
    window.history.replaceState(null, '', serializeViewState(next, window.location.href));
  };

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(['elections.json', 'county-names.json'].map(async (name) => {
      const response = await fetch(`${import.meta.env.BASE_URL}${name}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Could not load ${name} (${response.status}).`);
      return response.json();
    })).then(([data, countyNames]) => {
      if (controller.signal.aborted) return;
      const series = buildSeries(data);
      setElections({ ...data, countyNames, series, flips: countFlips(series) });
      const restored = parseViewState(window.location.href, countyNames);
      viewRef.current = restored; setView(restored); snap(restored.year);
      setFocusRequest((current) => ({ fips: restored.county, id: current.id + 1 }));
    }).catch((error) => { if (error.name !== 'AbortError') setLoadError(error.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const restore = () => {
      const restored = parseViewState(window.location.href, elections?.countyNames);
      viewRef.current = restored; setView(restored); snap(restored.year);
      setVisual((current) => ({ ...current, playing: false }));
      setFocusRequest((current) => ({ fips: restored.county, id: current.id + 1 }));
      setManualLink(''); setFeedback('');
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [elections]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => { snap(viewRef.current.year); setVisual((current) => ({ ...current, reducedMotion: media.matches, playing: false })); };
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);

  const copyLink = async () => {
    pause();
    const url = serializeViewState(viewRef.current, window.location.href);
    try {
      await navigator.clipboard.writeText(url);
      setFeedback('Link copied.'); setManualLink('');
    } catch {
      setManualLink(url); setFeedback('Clipboard unavailable. Select and copy the link below.');
    }
  };
  const exportPng = async () => {
    if (exportBusy.current || !captureRef.current) return;
    exportBusy.current = true; setExporting(true); pause(); setFeedback('Preparing PNG…');
    const snapshot = { ...viewRef.current };
    try {
      await new Promise(requestAnimationFrame);
      const canvas = await captureRef.current();
      if (Object.keys(snapshot).some((key) => viewRef.current[key] !== snapshot[key])) {
        throw new Error('The view changed during capture. Please download again.');
      }
      await downloadCard(canvas, snapshot, elections);
      setFeedback('PNG downloaded. Playback remains paused.');
    } catch (error) { setFeedback(`PNG could not be created: ${error.message}`); }
    finally { exportBusy.current = false; setExporting(false); }
  };

  return <main aria-busy={exporting}>
    <fieldset className="application" disabled={exporting}>
      <header className="map-header">
        <div className="map-intro">
          <h1>The county vote</h1>
          <p className="map-kicker">U.S. presidential elections · 1868–2020</p>
        </div>
        <div className="share-actions"><button onClick={copyLink} disabled={!elections}>Copy link</button><button onClick={exportPng} disabled={!sceneReady || exporting}>{exporting ? 'Preparing…' : 'Download PNG'}</button></div>
      </header>
      <div className="share-feedback" role="status">{feedback}</div>
      {manualLink && <label className="manual-link">Share link<input readOnly value={manualLink} onFocus={(event) => event.target.select()} /></label>}
      {loadError && <p className="load-error" role="alert">{loadError} <button onClick={() => window.location.reload()}>Retry loading data</button></p>}
      <div className="explorer-toolbar">
        <section className="election-navigation" aria-label="Election timeline and map mode">
          <div className="timeline-controls">
            <label className="election-date"><span className="visually-hidden">Election year</span>
              <select value={yearIndex} disabled={!elections} onChange={(event) => changeView({ year: years[Number(event.target.value)] })}>
                {years.map((year, index) => <option key={year} value={index}>{year}</option>)}
              </select>
            </label>
            <div className="playback-controls">
              <button className="step-button" aria-label="Previous election" disabled={!elections || !yearIndex} onClick={() => changeView({ year: years[yearIndex - 1] })}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m10 4-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button className="play-button" disabled={!elections || !sceneReady} aria-label={settings.playing ? 'Pause animation' : 'Play animation'} onClick={() => {
                if (settings.playing) pause();
                else { snap(viewRef.current.year); updateSetting('playing', true); }
              }}>{settings.playing ? 'Pause' : 'Play'}</button>
              <button className="step-button" aria-label="Next election" disabled={!elections || yearIndex === years.length - 1} onClick={() => changeView({ year: years[yearIndex + 1] })}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          </div>
          <div className="mode-switch" role="group" aria-label="Map mode">
            {['result', 'shift'].map((mode) => <button key={mode} aria-pressed={view.mode === mode} onClick={() => changeView({ mode })}>{mode === 'result' ? 'Result' : 'Shift'}</button>)}
          </div>
        </section>
        <CountySearch countyNames={elections?.countyNames} onSelect={selectCounty} disabled={!elections} />
      </div>
      <div className="election-explorer">
        <section className="map-panel" aria-labelledby="map-title">
          <div className="map-panel-header">
            <div><h2 id="map-title">{view.year} election {view.mode === 'shift' ? 'shift' : 'results'}</h2>
              <p>{view.mode === 'shift' ? (yearIndex ? `Movement in the D/R margin since ${years[yearIndex - 1]}.` : 'The first election in this series.') : 'The Democratic–Republican lead, county by county.'}</p>
            </div>
          <aside className="controls" aria-label="Map controls" onKeyDown={(event) => { if (event.key === 'Escape') { setControlsOpen(false); event.currentTarget.querySelector('summary').focus(); } }}>
            <details className="controls-panel" open={controlsOpen}
              onToggle={(event) => setControlsOpen(event.currentTarget.open)}>
              <summary className="controls-heading">
                <span>Map settings</span>
                <svg className="disclosure-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              <div className="controls-content">
                {view.mode === 'result' && <label className="select-control">Height metric
                  <select value={settings.height} onChange={(event) => updateSetting('height', event.target.value)}>
                    {heightModes.map((mode) => <option key={mode}>{mode}</option>)}
                  </select>
                </label>}
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
              </div>
            </details>
          </aside>
          </div>
          <div className="map-stage" role="group" aria-label="County map">
          <SceneErrorBoundary onError={() => setSceneReady(false)}>
            <Canvas flat shadows="percentage" camera={camera} gl={renderer} dpr={[1.5, 2]}
              frameloop={settings.playing || settings.breath > 0 ? 'always' : 'demand'}
              fallback={<p className="scene-status">This 3D map requires WebGL. County search, rankings and history remain available.</p>}
              role="img" aria-label="Three-dimensional county election map; select a county using search or ranking">
              <Suspense fallback={null}>{elections && <ElectionScene settings={settings} timeline={timeline} onYearChange={playbackYear} elections={elections}
                selectedFips={view.county} focusRequest={focusRequest} onReady={setSceneReady} captureRef={captureRef} />}</Suspense>
            </Canvas>
            {!elections && !loadError && <div className="scene-status" role="status">Loading county map…</div>}
          </SceneErrorBoundary>
          {view.mode === 'shift' && !yearIndex && <p className="map-empty">1868 · No previous election comparison in this series.</p>}
          <div className="map-view-actions"><button onClick={() => focus(null)} disabled={!sceneReady}>National view</button>{view.county && <button onClick={() => focus(view.county)} disabled={!sceneReady}>Focus county</button>}</div>

          </div>
          <div className="map-caption">
            <div className="party-legend" role="group" aria-label={`${view.mode === 'shift' ? 'Shift direction' : 'Party lead'} in ${view.year}`}>
              {['Democratic', 'Republican'].map((party, index) => <div key={party}>
                <span className="party-name"><i className="party-swatch" style={{ background: palette.fills[index] }} aria-hidden="true" />{view.mode === 'shift' ? `Toward ${index ? 'Republicans' : 'Democrats'}` : `${party} lead`}</span>
                <span className="candidate-name">{nominees?.[index] ?? 'Loading candidate…'}</span>
              </div>)}
            </div>
            <div className="map-scale-note">
              <p className="height-key">{view.mode === 'shift' ? 'Height: absolute shift (pp)' : `Height: ${view.height === 'margin %' ? 'vote-share gap' : 'vote-count gap'}`} · nonlinear</p>
              <p className="neutral-legend"><span><i className="party-swatch neutral-swatch" aria-hidden="true" />{view.mode === 'shift' ? 'No change' : 'Tie'}</span><span><i className="party-swatch missing-swatch" aria-hidden="true" />No data</span>{view.county && <span><i className="party-swatch selected-swatch" aria-hidden="true" />Selected county</span>}</p>
            </div>
            <p className="map-interaction-hint">Drag to pan · Scroll to zoom · Right-drag to orbit</p>
          </div>
        </section>
        <aside className="county-sidebar" aria-label="County data">
          {view.county && elections && <CountyDetails elections={elections} fips={view.county} yearIndex={yearIndex} palette={palette}
            onFocus={() => focus(view.county)} onNational={() => focus(null)} onClose={() => {
              changeView({ county: null }); document.querySelector('[role="combobox"][aria-autocomplete]')?.focus();
            }} />}
          <section className="national-overview" aria-labelledby="national-title">
            <h2 id="national-title">Nationwide <span>{yearIndex ? `${years[yearIndex - 1]}–${view.year}` : view.year}</span></h2>
            <FlipCount flips={elections?.flips[yearIndex]} fills={palette.fills} previousYear={years[yearIndex - 1]} />
          </section>
          <CountyRanking elections={elections} yearIndex={yearIndex} fills={palette.fills} mode={view.mode} flippedOnly={view.flippedOnly}
            onFilterChange={(flippedOnly) => changeView({ flippedOnly })} onSelect={selectCounty} selectedFips={view.county} onInteract={pause} />
        </aside>
      </div>
      <footer className="map-note">
        <details className="method-note">
          <summary>Data & methods <span aria-hidden="true">+</span></summary>
          <p>Margin = 100 × (Democratic votes − Republican votes) / all votes. Shift = current margin − previous margin, in percentage points (pp). Positive shifts move toward Democrats; negative shifts toward Republicans. Map heights are nonlinear; rankings and county details use unscaled values.</p>
          <p>A flip is a strict change in the D/R lead between two valid adjacent elections; ties are not flips. Nationwide statistics use all comparable counties and do not change when a county or list filter is selected. County counts do not represent voter counts or individual voters changing parties.</p>
          <p>Modern county names and U.S. Census 2017 boundaries are used. Historical returns for renamed or merged counties are combined into their successors. Missing records stay missing; Alaska district returns are unavailable, and Hawaii has no returns before 1960.</p>
          <p>Only the Democratic–Republican lead is shown. Actual third-party winners are not shown. Coverage ends in 2020; 2024 is not included.</p>
          <p>Returns: Amlani & Algara, Harvard Dataverse. Geography: U.S. Census Bureau / us-atlas. Basemap: Natural Earth. The existing source data and aggregation are retained.</p>
          <p>Use search or ranking buttons to select a county; direct selection of 3D county geometry is not available. Links restore the data view and a county focus, not arbitrary camera angles or lighting. PNG cards fit the captured map pixels proportionally into a 1600 × 1000 layout.</p>
        </details>
        <span>D/R lead only · Third-party winners not shown</span>
        <span>Sources: Amlani & Algara · U.S. Census Bureau · Natural Earth</span>
      </footer>
    </fieldset>
  </main>;
}
