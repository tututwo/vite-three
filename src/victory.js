import { countyMetrics } from './electionData.js';

// Same votes, five counts: who wins each election depends on what is counted.
// County returns come from public/elections.json, everything per state from public/electoral.json.
export const parties = ['D', 'R', 'O'];
const total = (tally) => parties.reduce((sum, party) => sum + (tally[party] ?? 0), 0);
// The party with the most, or null on a tie.
const leaderOf = (tally) => {
  const [first, second] = [...parties].sort((a, b) => (tally[b] ?? 0) - (tally[a] ?? 0));
  return (tally[first] ?? 0) > (tally[second] ?? 0) ? first : null;
};

// votes = [D, R, strongest other candidate, all votes]: the party's lead over its strongest rival.
function lead(votes, party) {
  const byParty = { D: votes[0], R: votes[1], O: votes[2] };
  const rival = Math.max(...parties.filter((other) => other !== party).map((other) => byParty[other]));
  return { votes: byParty[party] - rival, points: 100 * (byParty[party] - rival) / votes[3] };
}

// Counties and land area (the 48 contiguous states and DC) by who led, among counties with returns.
export function countyCounts(elections, index, land) {
  const counties = { D: 0, R: 0, O: 0, tie: 0 }, area = { D: 0, R: 0, O: 0, tie: 0 };
  for (const [fips, county] of Object.entries(elections.counties)) {
    const { leader } = countyMetrics(county, index);
    if (!leader) continue;
    counties[leader]++;
    area[leader] += land[fips] ?? 0;
  }
  return total(counties) + counties.tie ? { counties, area } : null;
}

// One segment per party per state, or per Maine/Nebraska district where the source has them, ordered from
// the safest Republican lead to the safest Democratic one with third parties between: the road to a majority.
function segments(election) {
  const list = [];
  for (const state of election.states) {
    const parts = state.districts ? [{ ...state, won: { ...state.won } }, ...state.districts.map((district) => ({ ...district, state: state.state }))] : [state];
    if (state.districts) for (const district of state.districts) for (const party of parties) parts[0].won[party] -= district.won[party] ?? 0;
    for (const part of parts) {
      for (const party of parties) {
        if (!part.won[party]) continue;
        const margin = part.votes ? lead(part.votes, party) : { votes: Infinity, points: Infinity };
        list.push({ state: state.state, district: part.name ?? null, party, electors: part.won[party], ...margin });
      }
    }
  }
  const side = { R: 0, O: 1, D: 2 };
  return list.sort((a, b) => side[a.party] - side[b.party] || (a.party === 'D' ? a.points - b.points : b.points - a.points));
}

export function electoralCounts(election) {
  const won = { D: 0, R: 0, O: 0 }, states = { D: 0, R: 0, O: 0, split: 0 }, popular = { D: 0, R: 0, total: 0 };
  const wasted = { D: 0, R: 0, O: 0 };
  let dc = null, most = null, fewest = null;
  for (const state of election.states) {
    for (const party of parties) won[party] += state.won[party] ?? 0;
    const winner = leaderOf(state.won);
    if (state.state === 'DC') dc = winner;
    else if (winner) states[winner]++;
    else states.split++;
    const people = state.population / total(state.won);
    if (!most || people > most.people) most = { state: state.state, people };
    if (!fewest || people < fewest.people) fewest = { state: state.state, people };
    if (!state.votes) continue;
    const [democratic, republican, top, all] = state.votes;
    popular.D += democratic; popular.R += republican; popular.total += all;
    // Wasted: every vote for a loser, and the winner's votes beyond one more than the runner-up's.
    // Statewide, so Maine's and Nebraska's district electors are not counted separately.
    const byParty = { D: democratic, R: republican, O: top };
    const first = leaderOf(byParty);
    for (const party of parties) {
      const votes = party === 'O' ? all - democratic - republican : byParty[party];
      wasted[party] += party === first ? votes - byParty[first] + Math.max(lead(state.votes, first).votes - 1, 0) : votes;
    }
  }
  popular.O = popular.total - popular.D - popular.R;
  const electors = total(won);
  const majority = Math.floor(electors / 2) + 1;
  const winner = parties.find((party) => won[party] >= majority) ?? null;
  const road = segments(election);
  let tippingPoint = null;
  if (winner) {
    let count = 0;
    const own = road.filter((segment) => segment.party === winner);
    tippingPoint = (winner === 'D' ? own.reverse() : own).find((segment) => (count += segment.electors) >= majority);
  }
  return { won, cast: election.cast, electors, majority, winner, states, dc, popular, wasted, perElector: { most, fewest }, road, tippingPoint };
}

export const winnerOf = leaderOf;
