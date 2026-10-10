import { useEffect, useId, useMemo, useRef } from 'react';
import { line, scaleLinear } from 'd3';
import { countyMetrics, marginLabel, shiftLabel, years } from './electionData.js';
import './county-ui.css';

function MarginHistory({ records, yearIndex, palette }) {
  const id = useId();
  const width = 340, height = 210;
  const bound = Math.max(25, Math.ceil(Math.max(...records.map(({ margin }) => Math.abs(margin ?? 0))) / 25) * 25);
  const x = scaleLinear().domain([years[0], years.at(-1)]).range([62, width - 12]);
  const y = scaleLinear().domain([-bound, bound]).range([height - 28, 22]);
  const path = line().defined(({ margin }) => margin !== null).x(({ year }) => x(year)).y(({ margin }) => y(margin))(records);
  const current = records[yearIndex];
  return <figure className="county-history-chart">
    <figcaption>Voting history<span>D/R margin · share of all votes</span></figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <title id={`${id}-title`}>{`Democratic minus Republican vote margin, ${years[0]}–${years.at(-1)}`}</title>
      <desc id={`${id}-description`}>Above zero means a Democratic lead; below zero means a Republican lead. Missing returns break the line. Diamonds mark strictly opposite leads in consecutive elections. Selected year: {current.year}, {marginLabel(current.margin)}. The full data is available in the history table below.</desc>
      <defs><linearGradient id={`${id}-line`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="22" y2={height - 28}>
        <stop offset="50%" stopColor={palette.accents[0]} /><stop offset="50%" stopColor={palette.accents[1]} />
      </linearGradient></defs>
      {[bound, 0, -bound].map((tick) => <g key={tick}>
        <line x1="62" x2={width - 12} y1={y(tick)} y2={y(tick)} stroke={tick ? 'rgb(0 0 0 / 8%)' : 'rgb(0 0 0 / 32%)'} strokeDasharray={tick ? undefined : '3 3'} />
        <text x="54" y={y(tick) + 3} textAnchor="end">{tick > 0 ? `D +${tick}%` : tick < 0 ? `R +${-tick}%` : '0'}</text>
      </g>)}
      {[1868, 1920, 1968, 2020].map((year) => <text key={year} x={x(year)} y={height - 7} textAnchor={year === 1868 ? 'start' : year === 2020 ? 'end' : 'middle'}>{year}</text>)}
      <line x1={x(current.year)} x2={x(current.year)} y1="18" y2={height - 25} stroke="rgb(0 0 0 / 44%)" strokeDasharray="2 4" />
      <path d={path ?? ''} fill="none" stroke={`url(#${id}-line)`} strokeWidth="2" strokeLinejoin="round" />
      {records.filter(({ margin }) => margin !== null).map((record) => <circle key={record.year} cx={x(record.year)} cy={y(record.margin)} r="1.8" fill={record.margin === 0 ? '#707070' : palette.accents[record.margin > 0 ? 0 : 1]} />)}
      {records.filter(({ flipped }) => flipped).map((record) => <path key={record.year} d={`M ${x(record.year)} ${y(record.margin) - 5} l 5 5 -5 5 -5 -5 Z`} fill="#fff" stroke="#525252" strokeWidth="1.2" />)}
      {current.margin !== null && <circle cx={x(current.year)} cy={y(current.margin)} r="4" fill={current.margin === 0 ? '#707070' : palette.accents[current.margin > 0 ? 0 : 1]} stroke="#fff" strokeWidth="1.4" />}
    </svg>
    <p className="county-chart-key"><span>◇ Changed two-party lead</span><span>Dashed line: {current.year}</span></p>
  </figure>;
}

export default function CountyDetails({ elections, fips, yearIndex, palette, onClose, onFocus, onNational }) {
  const heading = useRef(null);
  const id = useId();
  const county = elections?.counties[fips];
  const location = elections?.countyNames[fips];
  const records = useMemo(() => years.map((year, index) => ({ year, ...countyMetrics(county, index) })), [county]);
  useEffect(() => {
    // User selections reveal the panel; restoring a URL keeps the initial viewport.
    heading.current?.focus({ preventScroll: document.activeElement === document.body });
  }, [fips, location]);
  if (!fips || !location) return null;
  const current = records[yearIndex];
  const available = records.filter(({ margin }) => margin !== null);
  const flipCount = records.filter(({ flipped }) => flipped).length;
  const leadStatus = !yearIndex ? 'First election; no previous comparison.'
    : current.margin === null ? 'No current return to compare.'
      : current.previousMargin === null ? 'No previous return to compare.'
        : current.flipped ? `Changed to a ${current.margin > 0 ? 'Democratic' : 'Republican'} lead.`
          : current.margin === 0 || current.previousMargin === 0 ? 'A tied election does not count as a flip.'
            : 'No change in the two-party lead.';
  return <section className="county-details" aria-labelledby={`${id}-heading`}>
    <div className="county-details-heading">
      <div><p className="county-eyebrow">Selected county</p>
        <h2 id={`${id}-heading`} ref={heading} tabIndex={-1}>{location.name}</h2>
        <p className="county-location">{location.state}<span>FIPS {fips}</span></p>
      </div>
      <button type="button" className="county-close" onClick={onClose} aria-label="Close county details"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
    </div>
    <div className="county-view-actions">
      <button type="button" onClick={onFocus}>Focus on map</button>
      <button type="button" onClick={onNational}>National view</button>
    </div>
    <dl className="county-detail-metrics">
      <div><dt>{current.year} margin</dt><dd style={{ color: current.margin ? palette.accents[current.margin > 0 ? 0 : 1] : undefined }}>{marginLabel(current.margin)}</dd></div>
      <div><dt>Total votes · {current.year}</dt><dd>{current.total === null ? 'No data' : current.total.toLocaleString()}</dd></div>
      <div className="county-shift-metric"><dt>{yearIndex ? `Shift since ${years[yearIndex - 1]}` : 'Shift · first election'}</dt><dd>{shiftLabel(current.shift)}</dd></div>
    </dl>
    <p className="county-lead-status">{leadStatus}</p>
    {current.margin === null && <p className="county-missing" role="status">No valid return for {current.year}. This county’s available history remains below.</p>}
    <MarginHistory records={records} yearIndex={yearIndex} palette={palette} />
    <p className="county-history-summary">{available.length
      ? `${available.length} elections with returns, ${available[0].year}–${available.at(-1).year}; ${flipCount} ${flipCount === 1 ? 'change' : 'changes'} in two-party lead across consecutive elections. Missing years are not compared across gaps.`
      : 'No valid election returns are available for this county in this series.'}</p>
    <details className="county-history-table">
      <summary>Historical returns · {years.length} elections</summary>
      <p>Margin is D minus R as a share of all votes. Positive shift is toward Democrats; negative is toward Republicans. pp = percentage points.</p>
      <div className="county-table-scroll" tabIndex={0} role="region" aria-label="Historical county returns">
        <table><caption className="county-visually-hidden">{location.name}, {location.state}: election history</caption>
          <thead><tr><th scope="col">Year</th><th scope="col">Margin</th><th scope="col">Shift (pp)</th><th scope="col">Votes</th></tr></thead>
          <tbody>{records.map((record) => <tr key={record.year} aria-current={record.year === current.year ? 'true' : undefined}>
            <th scope="row">{record.year}</th>
            <td>{marginLabel(record.margin)}{record.flipped && <small>Flipped</small>}</td>
            <td>{record.shift === null ? '—' : `${record.shift > 0 ? '+' : ''}${record.shift.toFixed(1)}`}</td>
            <td>{record.total === null ? '—' : record.total.toLocaleString()}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
    <p className="county-method-note">Modern county names and boundaries; historical renamed or merged counties are combined into their successors. D/R lead uses all votes as the denominator. Actual third-party winners are not shown.</p>
  </section>;
}
