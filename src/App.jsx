import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { buildSeries, countFlips, defaultSettings, heightModes, lastCountyYear, marginLabel, modes, paletteNames, palettes, rankCounties, shiftLabel, years } from './electionData.js';
import { otherFill, RoadToMajority, StreakEndings, TurnTimeline, useElectoral, VictoryPanel } from './Electoral.jsx';
import DebugPanel from './DebugPanel.jsx';
import './civ.css';

import CountySearch from './CountySearch.jsx';
import CountyDetails from './CountyDetails.jsx';
import { parseViewState, serializeViewState } from './viewState.js';
import { downloadCard } from './exportCard.js';

const ElectionScene = lazy(() => import('./ElectionScene.jsx'));
const modeLabels = { territory: 'Territory', result: 'Margin', shift: 'Shift', loyalty: 'Loyalty', electors: 'Electors' };
const mapTitles = { territory: 'territory', result: 'election results', shift: 'election shift', loyalty: 'loyalty', electors: 'Electoral College' };
const mapDescriptions = {
  territory: 'Who led each county, laid flat: the land each party held. Deeper colour is a wider lead.',
  result: 'The Democratic–Republican lead, county by county.',
  loyalty: 'Height is how many elections in a row a county had the same leader. A county that changes sides drops to one level.',
  electors: 'One hex per elector, in the state that cast it. Height is the state’s winning lead; gold rings the tipping-point state.',
};
const heightKeys = { electors: '1 hex = 1 elector · Height: state lead · nonlinear', territory: 'Flat · colour depth: vote-share gap', shift: 'Height: absolute shift (pp) · nonlinear', loyalty: 'Height: elections in a row with the same leader, up to 39' };
const camera = { position: [-60, -660, 520], up: [0, 0, 1], fov: 30, near: 10, far: 6000 };
// Multisampling below 2x pixel ratio only: at 2x the pixels are small enough, and the samples
// would add to every frame on exactly the laptops that run hot.
const renderer = { antialias: globalThis.devicePixelRatio < 2 };
const initialSettings = {
  ...defaultSettings,
  fill: 1.2, front: 1, key: 2.4,
  keyX: -380, keyY: 260, keyZ: 620, shadowSoftness: 10,
  ambientOcclusion: 1, depthOfField: false, vignette: true,
  // Civ skin (tune live with ?debug, then paste the copied values here).
  skin: 'civ', oceanColor: '#5f8f9c', landColor: '#cbbf9a', inkColor: '#2f4a55',
  hexSize: 8.7, hexWidth: 0.018, gridOcean: 0.16, hexOnLand: 0.1,
  borders: 1, borderWidth: 1.4, borderCore: 0.42, borderGlow: 0.4, borderHighlight: 0.35, borderColumns: 0, flipFade: 0.0002,
  fogColor: '#e6dcc3', fogInk: '#b9aa86', fogHatch: 3.5, fogLine: 0.2, fogClouds: 0.35, fogScale: 0.02, fogSpeed: 0.5,
  boardCompact: 0.55, boardGap: 0.03, boardHeight: 24, boardBase: 1.5, hexBorder: 0.16, boardLabels: true, boardLabelMin: 5,
  bannerCount: 8, bannerSpacing: 70,
};
const debugging = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

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
  if (!flips.compared) return <p className="flip-stat">{previousYear >= lastCountyYear ? `County returns end in ${lastCountyYear}; this election has state results only.` : `No comparable county returns for this election and ${previousYear}.`}</p>;
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
  const loyalty = mode === 'loyalty';
  const party = { D: 'Democratic', R: 'Republican', O: 'Third parties' };
  const ceiling = Math.max(10, Math.ceil((ranked[0]?.value ?? 0) / 10) * 10);
  return <section className="county-ranking" aria-labelledby="ranking-title">
    <div className="ranking-heading">
      <p className="section-kicker">County ranking · {years[yearIndex]}</p>
      <h2 id="ranking-title">{loyalty ? (flippedOnly && yearIndex ? 'Streaks that ended' : 'Longest streaks') : shift ? 'Largest shifts' : 'Largest leads'}</h2>
      <p className="ranking-description">{loyalty ? 'Elections in a row with the same leader, third parties included.' : shift ? 'Change in D/R margin since the previous election.' : 'D/R vote margin as a share of all votes.'}</p>
    </div>
    <label className="checkbox-control ranking-filter"><input type="checkbox" checked={flippedOnly && yearIndex > 0} disabled={!yearIndex}
      onChange={(event) => onFilterChange(event.target.checked)} />{loyalty ? 'Streaks that ended only' : 'Flipped counties only'}</label>
    {!yearIndex && <p className="ranking-note">Flip filtering starts in 1872. Result shows all available counties.</p>}
    {years[yearIndex] > lastCountyYear && <p className="ranking-note">County returns end in {lastCountyYear}.</p>}
    {!elections ? <p className="ranking-empty" role="status">Loading county returns…</p>
      : shift && !yearIndex ? <p className="ranking-empty">No previous election comparison. Choose 1872 or later.</p>
        : !ranked.length ? <p className="ranking-empty">{flippedOnly ? 'No counties changed their D/R lead in this comparison.' : 'No valid county returns for this view.'}</p>
          : <>
            <ol key={`${yearIndex}-${mode}-${flippedOnly}`} id="county-rankings" className={`county-bars${showAll ? ' expanded' : ''}`} tabIndex={showAll ? 0 : undefined}>
              {(showAll ? ranked : ranked.slice(0, 5)).map((county, index) => {
                const location = elections.countyNames?.[county.fips] ?? { name: county.fips, state: '' };
                const value = loyalty ? (county.leader === 'R' ? -1 : county.leader === 'O' ? 0 : 1) : shift ? county.shift : county.margin;
                if (loyalty) {
                  const ended = flippedOnly && yearIndex > 0;
                  const span = ended ? `${county.start}–${years[yearIndex - 1]}` : `since ${county.start}`;
                  return <li key={county.fips}>
                    <button className="county-choice" aria-pressed={selectedFips === county.fips} onClick={() => onSelect(county.fips)}>
                      <span className="county-rank" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                      <span className="county-row-content">
                        <span className="county-label"><span className="county-name">{location.name}</span><strong>{county.length}<small> elections</small></strong></span>
                        <span className="county-comparison"><span>{location.state}</span><span>{party[county.leader]} {span}{ended ? ` → ${county.next === 'tie' ? 'tie' : party[county.next]}` : ''}</span></span>
                        <span className="county-bar-track" aria-hidden="true"><span style={{ width: `${county.length / (years.indexOf(lastCountyYear) + 1) * 100}%`, background: county.leader === 'O' ? otherFill : fills[county.leader === 'R' ? 1 : 0] }} /></span>
                      </span>
                    </button>
                  </li>;
                }
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
            <p className="ranking-note">{loyalty ? 'Ranked by streak length. A missing return or a tie ends a streak. ' : `${shift ? 'pp = percentage points. ' : ''}Ranked by absolute ${shift ? 'shift' : 'margin'}. `}Filtering affects this list only.</p>
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
  const stageRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [focusRequest, setFocusRequest] = useState({ fips: view.county, id: 0 });
  const [exporting, setExporting] = useState(false);
  const exportBusy = useRef(false);
  const captureRef = useRef(null);
  const [feedback, setFeedback] = useState('');
  const [manualLink, setManualLink] = useState('');
  const yearIndex = years.indexOf(view.year);
  const electoral = useElectoral(elections, yearIndex);
  const stateOnly = view.year > lastCountyYear;
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
  // The browser's own fullscreen where it exists; where it does not (iPhone Safari), the stage still
  // covers the window as a fixed layer, and Escape or the button leaves it.
  const toggleFullscreen = () => {
    if (fullscreen) {
      if (document.fullscreenElement) document.exitFullscreen();
      setFullscreen(false);
    } else {
      setFullscreen(true);
      stageRef.current?.requestFullscreen?.().catch(() => {});
    }
  };
  useEffect(() => {
    if (!fullscreen) return;
    const left = () => { if (!document.fullscreenElement) setFullscreen(false); };
    const escape = (event) => { if (event.key === 'Escape' && !document.fullscreenElement) setFullscreen(false); };
    document.addEventListener('fullscreenchange', left);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('fullscreenchange', left); document.removeEventListener('keydown', escape); };
  }, [fullscreen]);
  const playbackYear = (year) => {
    const next = { ...viewRef.current, year };
    viewRef.current = next; setView(next);
    window.history.replaceState(null, '', serializeViewState(next, window.location.href));
  };

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(['elections.json', 'county-names.json', 'electoral.json'].map(async (name) => {
      const response = await fetch(`${import.meta.env.BASE_URL}${name}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Could not load ${name} (${response.status}).`);
      return response.json();
    })).then(([data, countyNames, electoral]) => {
      if (controller.signal.aborted) return;
      const series = buildSeries(data);
      setElections({ ...data, countyNames, electoral, series, flips: countFlips(series) });
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

  const playbackControls = <div className="playback-controls">
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
  </div>;
  const modeSwitch = <div className="mode-switch" role="group" aria-label="Map mode">
    {modes.map((mode) => <button key={mode} aria-pressed={view.mode === mode} onClick={() => changeView({ mode })}>{modeLabels[mode]}</button>)}
  </div>;

  return <main aria-busy={exporting}>
    {debugging && <DebugPanel settings={settings} onChange={updateSetting} />}
    <fieldset className="application" disabled={exporting}>
      <header className="map-header">
        <div className="map-intro">
          <h1>The county vote</h1>
          <p className="map-kicker">U.S. presidential elections · 1868–2024 · county returns to 2020</p>
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
            {playbackControls}
          </div>
          {modeSwitch}
        </section>
        <CountySearch countyNames={elections?.countyNames} onSelect={selectCounty} disabled={!elections} />
      </div>
      <TurnTimeline electoral={elections?.electoral} yearIndex={yearIndex} palette={palette} disabled={!elections} onSelect={(year) => changeView({ year })} />
      <div className="election-explorer">
        <section className="map-panel" aria-labelledby="map-title">
          <div className="map-panel-header">
            <div><h2 id="map-title">{view.year} {mapTitles[view.mode]}</h2>
              <p>{stateOnly && view.mode !== 'electors' ? `County returns end in ${lastCountyYear}; ${view.year} has state results only.`
                : view.mode === 'shift' ? (yearIndex ? `Movement in the D/R margin since ${years[yearIndex - 1]}.` : 'The first election in this series.') : mapDescriptions[view.mode]}</p>
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
          <div className={`map-stage${fullscreen ? ' is-fullscreen' : ''}${settings.skin === 'civ' ? ' is-civ' : ''}`} ref={stageRef} role="group" aria-label="County map">
          {settings.skin === 'civ' && !fullscreen && <p className="civ-turn" aria-hidden="true"><span>Turn <b>{yearIndex + 1}</b> / {years.length}</span><strong>{view.year}</strong>{nominees && <em>{nominees.join(' vs ')}</em>}</p>}
          {fullscreen && <div className="fullscreen-bar">
            <p><strong>{view.year}</strong> {mapTitles[view.mode]}<span>{nominees?.join(' vs ')}</span></p>
            {playbackControls}
            {modeSwitch}
          </div>}
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
          {stateOnly && view.mode !== 'electors' && <p className="map-empty">{view.year} · State results only. County returns in this series end in {lastCountyYear}; the counts beside the map use official state results.</p>}
          <div className="map-view-actions"><button onClick={() => focus(null)} disabled={!sceneReady}>National view</button>{view.county && <button onClick={() => focus(view.county)} disabled={!sceneReady}>Focus county</button>}
            <button onClick={toggleFullscreen}>{fullscreen ? 'Exit full screen' : 'Full screen'}</button></div>

          </div>
          <div className="map-caption">
            <div className="party-legend" role="group" aria-label={`${view.mode === 'shift' ? 'Shift direction' : 'Party lead'} in ${view.year}`}>
              {['Democratic', 'Republican'].map((party, index) => <div key={party}>
                <span className="party-name"><i className="party-swatch" style={{ background: palette.fills[index] }} aria-hidden="true" />{view.mode === 'shift' ? `Toward ${index ? 'Republicans' : 'Democrats'}` : view.mode === 'loyalty' ? `${party} streak` : view.mode === 'electors' ? `${party} electors` : `${party} lead`}</span>
                <span className="candidate-name">{nominees?.[index] ?? 'Loading candidate…'}</span>
              </div>)}
            </div>
            <div className="map-scale-note">
              <p className="height-key">{heightKeys[view.mode] ?? `Height: ${view.height === 'margin %' ? 'vote-share gap' : 'vote-count gap'} · nonlinear`}</p>
              <p className="neutral-legend">{view.mode === 'electors' ? <span><i className="party-swatch neutral-swatch" aria-hidden="true" />Third party, or an elector who broke the state’s pledge</span> : <>{['territory', 'loyalty'].includes(view.mode) && <span><i className="party-swatch neutral-swatch" aria-hidden="true" />Third parties led</span>}<span><i className="party-swatch neutral-swatch" aria-hidden="true" />{view.mode === 'shift' ? 'No change' : 'Tie'}</span><span><i className="party-swatch missing-swatch" aria-hidden="true" />No data</span>{view.county && <span><i className="party-swatch selected-swatch" aria-hidden="true" />Selected county</span>}</>}</p>
            </div>
            <p className="map-interaction-hint">Drag to pan · Scroll to zoom · Right-drag to orbit</p>
          </div>
          <RoadToMajority electoral={electoral} palette={palette} />
        </section>
        <aside className="county-sidebar" aria-label="County data">
          {view.county && elections && <CountyDetails elections={elections} fips={view.county} yearIndex={yearIndex} palette={palette}
            onFocus={() => focus(view.county)} onNational={() => focus(null)} onClose={() => {
              changeView({ county: null }); document.querySelector('[role="combobox"][aria-autocomplete]')?.focus();
            }} />}
          <VictoryPanel electoral={electoral} palette={palette} />
          <section className="national-overview" aria-labelledby="national-title">
            <h2 id="national-title">Nationwide <span>{yearIndex ? `${years[yearIndex - 1]}–${view.year}` : view.year}</span></h2>
            <FlipCount flips={elections?.flips[yearIndex]} fills={palette.fills} previousYear={years[yearIndex - 1]} />
            <StreakEndings elections={elections} yearIndex={yearIndex} onSelect={selectCounty} />
          </section>
          <CountyRanking elections={elections} yearIndex={yearIndex} fills={palette.fills} mode={['territory', 'electors'].includes(view.mode) ? 'result' : view.mode} flippedOnly={view.flippedOnly}
            onFilterChange={(flippedOnly) => changeView({ flippedOnly })} onSelect={selectCounty} selectedFips={view.county} onInteract={pause} />
        </aside>
      </div>
      <footer className="map-note">
        <details className="method-note">
          <summary>Data & methods <span aria-hidden="true">+</span></summary>
          <p>Margin = 100 × (Democratic votes − Republican votes) / all votes. Shift = current margin − previous margin, in percentage points (pp). Positive shifts move toward Democrats; negative shifts toward Republicans. Map heights are nonlinear; rankings and county details use unscaled values.</p>
          <p>A flip is a strict change in the D/R lead between two valid adjacent elections; ties are not flips. Nationwide statistics use all comparable counties and do not change when a county or list filter is selected. County counts do not represent voter counts or individual voters changing parties.</p>
          <p>Modern county names and U.S. Census 2017 boundaries are used. Historical returns for renamed or merged counties are combined into their successors. Missing records stay missing; Alaska district returns are unavailable, and Hawaii has no returns before 1960.</p>
          <p>Territory colours each county by who led: Democrats, Republicans, or third parties when their votes together beat both parties (the returns keep third parties as one sum, so no single third-party candidate is named for a county). Margin and Shift show only the Democratic–Republican lead. Loyalty raises each county by how many elections in a row it had the same leader; a missing return, a tie or any change of leader, third parties included, ends a streak.</p>
          <p>Victory conditions: counties led and their land area (Census 2020 Gazetteer, the 48 contiguous states and DC) come from county returns. States won, popular vote and electors come from official state results (The American Presidency Project, UC Santa Barbara), including third-party electors, split states, faithless electors and electors chosen by legislatures (Florida 1868, Colorado 1876). The tipping point is the state, or Maine or Nebraska district, that gave the winner a majority of electors, counting from the winner’s widest leads. Wasted votes are every vote for a state’s losers plus the winner’s votes beyond one more than the runner-up, statewide. People per elector divides each state’s resident population at the census that set its electors by its electors.</p>
          <p>County returns end in 2020. 2024 is shown with state results only.</p>
          <p>Returns: Amlani & Algara, Harvard Dataverse. Geography: U.S. Census Bureau / us-atlas. Basemap: Natural Earth. The existing source data and aggregation are retained.</p>
          <p>Use search or ranking buttons to select a county; direct selection of 3D county geometry is not available. Links restore the data view and a county focus, not arbitrary camera angles or lighting. PNG cards fit the captured map pixels proportionally into a 1600 × 1000 layout.</p>
        </details>
        <span>County returns 1868–2020 · State results 1868–2024</span>
        <span>Sources: Amlani & Algara · The American Presidency Project · U.S. Census Bureau · Natural Earth</span>
      </footer>
    </fieldset>
  </main>;
}
