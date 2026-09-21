import { interpolateRgbBasis } from 'd3';

// Every presidential election in public/elections.json (see scripts/export-elections.R).
export const years = Array.from({ length: 39 }, (_, index) => 1868 + index * 4);
export const heightModes = ['margin %', 'margin votes'];
export const flatHeights = new Array(years.length).fill(0);
export const defaultSettings = {
  year: years[0],
  playing: true,
  height: heightModes[0],
  secondsPerElection: 2,
  stagger: 0.5,
  breath: 0.04,
  maxHeight: 110,
  minHeight: 0.6,
  heightExponent: 1,
  colorGamma: 0.5,
};

export const ramps = [
  ['#373F73', '#4C5CB8', '#688EFB', '#57B3FF', '#4CDDF5', '#5EECEB', '#A5FBEA'],
  ['#684558', '#A33F5D', '#E0708F', '#E38274', '#F0AC6E', '#ECDE7D', '#F4FCA5'],
].map(interpolateRgbBasis);

// data.counties[fips] = { diff: Democratic minus Republican votes, total: votes cast }, null = did not vote.
// Heights are signed (+ Democratic, - Republican) so that a flip has to pass through zero.
export function buildSeries(data) {
  if (String(data?.years) !== String(years)) throw new Error('elections.json does not cover 1868-2020');
  let maxVoteDiff = 0;
  for (const { diff } of Object.values(data.counties)) {
    for (const votes of diff) if (Number.isFinite(votes)) maxVoteDiff = Math.max(maxVoteDiff, Math.abs(votes));
  }

  const series = {};
  for (const [fips, { diff, total }] of Object.entries(data.counties)) {
    const county = series[fips] = {
      'margin %': [...flatHeights],
      'margin votes': [...flatHeights],
      voted: [...flatHeights],
    };
    for (let index = 0; index < years.length; index++) {
      const votes = diff[index];
      const cast = total[index];
      if (!Number.isFinite(votes) || !(cast > 0)) continue;
      const sign = Math.sign(votes);
      county['margin %'][index] = sign * Math.min(Math.abs(votes) / cast / 0.9, 1) ** 2;
      county['margin votes'][index] = sign * (maxVoteDiff ? Math.sqrt(Math.abs(votes) / maxVoteDiff) : 0);
      county.voted[index] = 1;
    }
  }
  return series;
}

// Eased value of a per-election series at a fractional election index; each county waits
// `delay * stagger` of the transition before it starts moving.
export function interpolateSeries(values, time, delay, stagger) {
  const election = Math.floor(time);
  const from = ((election % years.length) + years.length) % years.length;
  const to = (from + 1) % years.length;
  const progress = Math.max(0, Math.min(1, (time - election - delay * stagger) / (1 - stagger)));
  const eased = progress * progress * (3 - 2 * progress);
  return values[from] + (values[to] - values[from]) * eased;
}

export function getCountyHeight(signed, seconds, phase, settings) {
  const breath = 1 + settings.breath * Math.sin(seconds * 1.6 + phase);
  return settings.minHeight + settings.maxHeight * Math.abs(signed) ** settings.heightExponent * breath;
}
