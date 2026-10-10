import { useMemo } from 'react';
import { brokenStreaks, lastCountyYear, marginLabel, years } from './electionData.js';
import { countyCounts, electoralCounts, parties, winnerOf } from './victory.js';
import './electoral.css';

// The map's neutral grey: third parties, together, never name a single winner here.
export const otherFill = '#969eaa';
const partyNames = { D: 'Democratic', R: 'Republican', O: 'Other' };
const fillsOf = (palette) => ({ D: palette.fills[0], R: palette.fills[1], O: otherFill });
const share = (part, whole, digits = 0) => `${(100 * part / whole).toFixed(digits)}%`;
const compact = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n));
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const sum = (tally) => parties.reduce((total, party) => total + (tally?.[party] ?? 0), 0);

// Voting-rights and electoral changes, shown on the timeline as moments, never as effects on the data.
const moments = [
  [1870, '15th Am.', '15th Amendment: the vote cannot be denied by race'],
  [1888, 'Secret ballot', 'States adopt the secret (Australian) ballot, 1888–1896'],
  [1920, '19th Am.', '19th Amendment: women’s suffrage'],
  [1924, 'Citizenship Act', 'Indian Citizenship Act'],
  [1961, '23rd Am.', '23rd Amendment: electors for Washington, D.C., from 1964'],
  [1965, 'VRA', 'Voting Rights Act (1965); the 24th Amendment ended poll taxes in federal elections in 1964'],
  [1971, '26th Am.', '26th Amendment: voting age 18'],
];

export function useElectoral(elections, yearIndex) {
  return useMemo(() => {
    const election = elections?.electoral?.elections[yearIndex];
    if (!election) return null;
    const { states } = elections.electoral;
    return { election, ...electoralCounts(election), counts: countyCounts(elections, yearIndex, elections.electoral.countyLand),
      stateName: (code) => states[code]?.name ?? code };
  }, [elections, yearIndex]);
}

function Split({ values, fills, label }) {
  const total = sum(values);
  return <span className="victory-split" role="img" aria-label={label}>
    {total > 0 && ['D', 'O', 'R'].map((party) => values[party] > 0 && <span key={party} style={{ flexGrow: values[party], background: fills[party] }} />)}
  </span>;
}

function Badge({ party, fills }) {
  return party ? <span className="victory-badge" style={{ background: fills[party] }} title={`${partyNames[party]} wins this count`}>{party}</span>
    : <span className="victory-badge victory-badge-none" title="No single winner">–</span>;
}

// "D 487 · R 2,623 · Other 1", Democrats first like the bars.
const listing = (values, format) => ['D', 'R', 'O'].filter((party) => party !== 'O' || values[party] > 0)
  .map((party) => `${party === 'O' ? 'Other' : party} ${format(values[party] ?? 0, party)}`).join(' · ');

export function VictoryPanel({ electoral, palette }) {
  if (!electoral) return null;
  const fills = fillsOf(palette);
  const { counts, states, dc, popular, cast, won, majority, election } = electoral;
  const area = counts && sum(counts.area) + counts.area.tie;
  const broke = parties.reduce((total, party) => total + Math.max(0, (won[party] ?? 0) - (cast[party] ?? 0)), 0);
  const rows = [
    { key: 'counties', label: 'Counties led', values: counts?.counties, format: (n) => n.toLocaleString() },
    { key: 'land', label: 'Land area', detail: '48 states + DC', values: counts?.area, format: (n) => share(n, area) },
    { key: 'states', label: 'States won', values: states, format: (n, party) => `${n}${party === dc ? ' + DC' : ''}` },
    { key: 'popular', label: 'Popular vote', values: popular, format: (n) => share(n, popular.total, 1), winner: winnerOf({ D: popular.D, R: popular.R }) },
    { key: 'electors', label: 'Electoral College', detail: 'the rule', values: cast, format: (n) => String(n) },
  ];
  return <section className="victory-panel" aria-labelledby="victory-title">
    <p className="section-kicker">Victory conditions · {election.year}</p>
    <h2 id="victory-title">Same votes, five counts</h2>
    <p className="victory-intro">Who wins depends on what you count. Only the last count elects a president.</p>
    <ol className="victory-rows">
      {rows.map((row) => <li key={row.key} className={row.key === 'electors' ? 'victory-rule' : undefined}>
        <div className="victory-row-label"><span>{row.label}{row.detail && <small>{row.detail}</small>}</span>
          {row.values ? <Badge party={row.winner !== undefined ? row.winner : winnerOf(row.values)} fills={fills} /> : null}</div>
        {row.values ? <>
          <p className="victory-values">{listing(row.values, row.format)}</p>
          <Split values={row.values} fills={fills} label={`${row.label}: ${listing(row.values, row.format)}`} />
        </> : <p className="victory-values victory-missing">County returns end in {lastCountyYear}.</p>}
        {row.key === 'electors' && <p className="victory-note">{majority} of {sum(won)} to win
          {broke ? ` · ${broke} ${broke === 1 ? 'elector' : 'electors'} did not vote for the candidate their state chose${election.other ? ` (${election.other})` : ''}` : ''}
          {cast.none ? ` · ${cast.none} not counted` : ''}</p>}
      </li>)}
    </ol>
    <RuleDetails electoral={electoral} fills={fills} />
  </section>;
}

function RuleDetails({ electoral, fills }) {
  const { tippingPoint, majority, wasted, perElector, election, stateName } = electoral;
  const wastedTotal = Math.max(...parties.map((party) => wasted[party]));
  return <dl className="rule-details">
    <div><dt>Tipping point</dt><dd>{tippingPoint ? <>
      <strong>{stateName(tippingPoint.state)}{tippingPoint.district ? ` ${tippingPoint.district}` : ''} · {Number.isFinite(tippingPoint.points) ? `${tippingPoint.party} +${tippingPoint.points.toFixed(1)} pp` : 'chosen by its legislature'}</strong>
      {Number.isFinite(tippingPoint.votes) && <span>{tippingPoint.votes.toLocaleString()} votes delivered the {ordinal(majority)} elector</span>}
    </> : 'No candidate won a majority of electors.'}</dd></div>
    <div><dt>Wasted votes <small>winner-take-all</small></dt><dd>
      {parties.filter((party) => wasted[party] > 0).map((party) => <span key={party} className="rule-bar">
        <span>{party === 'O' ? 'Other' : party}</span><i style={{ width: `${100 * wasted[party] / wastedTotal}%`, background: fills[party] }} /><b>{compact(wasted[party])}</b>
      </span>)}
      <small>Every vote for a state’s losers, plus the winner’s votes beyond one more than the runner-up. Statewide.</small>
    </dd></div>
    <div><dt>People per elector <small>{election.census} census</small></dt><dd>
      <span>Fewest: <strong>{perElector.fewest.state} {compact(perElector.fewest.people)}</strong> · Most: <strong>{perElector.most.state} {compact(perElector.most.people)}</strong></span>
    </dd></div>
  </dl>;
}

export function RoadToMajority({ electoral, palette }) {
  if (!electoral) return null;
  const fills = fillsOf(palette);
  const { road, won, majority, winner, tippingPoint, cast, stateName } = electoral;
  const total = sum(won);
  // The majority line counts from the winner's end of the road.
  const line = winner === 'D' ? total - majority : majority;
  const broke = cast.D !== won.D || cast.R !== won.R;
  return <figure className="road" aria-labelledby="road-title">
    <figcaption><strong id="road-title">Road to {majority}</strong><span>States in order of the winner’s lead, safest Republican to safest Democratic · width = electors</span></figcaption>
    <div className="road-track">
      {road.map((segment) => {
        const tipping = segment === tippingPoint;
        const lead = Number.isFinite(segment.points) ? `${segment.party === 'O' ? 'Other' : segment.party} ${segment.points >= 0 ? '+' : '−'}${Math.abs(segment.points).toFixed(1)} pp` : 'chosen by the legislature';
        const name = `${stateName(segment.state)}${segment.district ? ` ${segment.district}` : ''}`;
        return <span key={`${segment.state}${segment.district}${segment.party}`} className={tipping ? 'road-tipping' : undefined}
          style={{ flexGrow: segment.electors, background: fills[segment.party] }} title={`${name}: ${segment.electors} electors · ${lead}${tipping ? ' · tipping point' : ''}`}>
          {segment.electors / total >= 0.025 && <small>{segment.state}</small>}
        </span>;
      })}
      {winner && <i className="road-line" style={{ left: `${100 * line / total}%` }} aria-hidden="true"><b>{majority}</b></i>}
    </div>
    <p className="road-legend">
      <span>← R · {won.R} won</span>
      {won.O > 0 && <span>Other · {won.O} won</span>}
      <span>{broke ? `Counted: R ${cast.R} – D ${cast.D}${cast.O ? ` – Other ${cast.O}` : ''}` : tippingPoint ? `Tipping point: ${stateName(tippingPoint.state)}` : ''}</span>
      <span>{won.D} won · D →</span>
    </p>
  </figure>;
}

export function TurnTimeline({ electoral, yearIndex, palette, onSelect, disabled }) {
  const fills = fillsOf(palette);
  const turns = useMemo(() => electoral?.elections.map((election) => {
    const { cast, won, popular } = electoralCounts(election);
    const electors = winnerOf(cast);
    const popularWinner = winnerOf({ D: popular.D, R: popular.R });
    return { year: election.year, electors, popular: popularWinner, third: won.O > 0, lost: electors && popularWinner && electors !== popularWinner };
  }) ?? [], [electoral]);
  if (!turns.length) return null;
  const at = (year) => `${100 * (year - years[0] + 2) / (years.length * 4)}%`;
  return <nav className="turns" aria-label={`${years.length} elections, ${years[0]}–${years.at(-1)}`}>
    <div className="turns-heading"><strong>{years.length} turns</strong><span>{years[0]}–{years.at(-1)}</span>
      <span className="turns-key"><i className="turns-third" />Third party won electors <i className="turns-lost" />Popular-vote winner lost <i className="turns-hatch" />State results only</span></div>
    <div className="turns-moments" aria-hidden="true">{moments.map(([year, label]) => <span key={year} style={{ left: at(year) }}>{label}</span>)}</div>
    <ol className="turns-track">
      {turns.map((turn, index) => <li key={turn.year}>
        <button type="button" disabled={disabled} aria-current={index === yearIndex ? 'true' : undefined} onClick={() => onSelect(turn.year)}
          className={turn.year > lastCountyYear ? 'turns-state-only' : undefined}
          aria-label={`${turn.year}: electors ${partyNames[turn.electors] ?? 'none'}, popular vote ${partyNames[turn.popular]}${turn.lost ? ', the popular-vote winner lost' : ''}${turn.third ? ', a third party won electors' : ''}`}>
          <span style={{ background: fills[turn.electors] ?? '#ddd' }} />
          <span style={{ background: fills[turn.popular] ?? '#ddd' }} className={turn.lost ? 'turns-lost' : undefined} />
          {turn.third && <i className="turns-third" />}
        </button>
      </li>)}
    </ol>
    <div className="turns-axis" aria-hidden="true"><span>Electors</span><span>Popular</span>
      {[1868, 1900, 1932, 1964, 1996, 2024].map((year) => <b key={year} style={{ left: at(year) }}>{year}</b>)}</div>
    <ul className="visually-hidden">{moments.map(([year, , text]) => <li key={year}>{year}: {text}</li>)}</ul>
  </nav>;
}

export function StreakEndings({ elections, yearIndex, onSelect }) {
  const broken = useMemo(() => elections && yearIndex && years[yearIndex] <= lastCountyYear ? brokenStreaks(elections.counties, yearIndex) : null, [elections, yearIndex]);
  if (!broken) return null;
  const long = broken.filter(({ length }) => length >= 5);
  const by = (party) => long.filter(({ leader }) => leader === party).length;
  const longest = broken[0];
  const location = longest && elections.countyNames[longest.fips];
  return <div className="streak-endings">
    <h3>Streaks ended this election</h3>
    {long.length ? <>
      <p><strong>{long.length.toLocaleString()} {long.length === 1 ? 'county' : 'counties'}</strong> ended a streak of 5+ elections: {[['D', 'Democratic'], ['R', 'Republican'], ['O', 'third-party']].filter(([party]) => by(party)).map(([party, name]) => `${by(party)} ${name}`).join(', ')}. {long.filter(({ length }) => length >= 10).length} of them were 10+.</p>
    </> : <p>No streak of 5+ elections ended in {years[yearIndex]}.</p>}
    {longest && <button type="button" className="streak-longest" onClick={() => onSelect(longest.fips)}>
      <span>Longest: <strong>{location?.name}, {location?.state}</strong></span>
      <span>{longest.leader} {longest.length} straight since {longest.start} → {longest.next === 'tie' ? 'tie' : longest.next}</span>
    </button>}
  </div>;
}

// The selected county's leaders over every election, its current streak in full colour.
export function LoyaltyStrip({ county, streakList, yearIndex, palette }) {
  const fills = fillsOf(palette);
  const current = streakList[yearIndex];
  const before = yearIndex ? streakList[yearIndex - 1] : null;
  const ended = before?.leader && current.leader !== before.leader && county.margin !== null ? before : null;
  // Full colour for the streak being described: the one that just ended, or the one still running.
  const first = ended ? yearIndex - ended.length : current.length ? yearIndex - current.length + 1 : yearIndex + 1;
  const name = (party) => party === 'O' ? 'third-party' : partyNames[party];
  return <figure className="loyalty-strip">
    <figcaption>
      {ended ? <><strong>{ended.length} straight {name(ended.leader)} {ended.length === 1 ? 'lead' : 'leads'}, {years[yearIndex - ended.length]}–{years[yearIndex - 1]}</strong><span className="streak-badge">Streak broken</span></>
        : current.length ? <strong>{current.length === 1 ? `${name(current.leader)} lead · 1 election` : `${current.length} straight ${name(current.leader)} leads since ${years[first]}`}</strong>
          : <strong>{county.margin === null ? `No return in ${years[yearIndex]}` : `Tie in ${years[yearIndex]}`}</strong>}
      {ended && <span>{years[yearIndex]}: {marginLabel(county.margin)}{current.leader === 'O' ? ' · third parties led' : ''}</span>}
    </figcaption>
    <ol aria-hidden="true">{streakList.map(({ leader }, index) => <li key={years[index]} title={`${years[index]}: ${leader ? name(leader) : 'no lead'}`}
      className={index >= first && index <= yearIndex ? 'loyalty-current' : index === yearIndex ? 'loyalty-now' : undefined}
      style={{ background: leader ? fills[leader] : undefined }} />)}</ol>
    <p className="loyalty-axis" aria-hidden="true"><span>{years[0]}</span><span>{years[yearIndex]}</span><span>{years.at(-1)}</span></p>
  </figure>;
}
