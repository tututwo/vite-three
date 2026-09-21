import { interpolateRgbBasis } from 'd3';

// Every presidential election in public/elections.json (see scripts/export-elections.R).
export const years = Array.from({ length: 39 }, (_, index) => 1868 + index * 4);
export const heightModes = ['margin %', 'margin votes'];
export const flatHeights = new Array(years.length).fill(0);
export const groundColor = '#faf8f5';

// ramps: [Democratic, Republican], low -> high altitude. Both start at the same near-ground cream,
// so a county that flips sinks into the floor colour before it rises in the other ramp.
// accents: the two parties as text colours that stay legible on the light floor.
// fills: the two parties as flat areas outside the map, taken from high on each ramp so they match it.
export const palettes = {
  'Lavender & peach': {
    ramps: [
      ['#fdf8e9', '#f0e7ef', '#dfd3f5', '#c9bff8', '#b3a4ed', '#9a86e0', '#8068d1'],
      ['#fdf8e9', '#fee9cd', '#fed8b0', '#fdc497', '#faad7f', '#f39367', '#e87c51'],
    ].map(interpolateRgbBasis),
    accents: ['#4b2bbf', '#e0491b'],
  },
  // The original ramps sampled from the reference video, minus their dusky stops for a dark floor.
  'Blue & red': {
    ramps: [
      ['#fdf8e9', '#4C5CB8', '#688EFB', '#57B3FF', '#4CDDF5', '#5EECEB', '#A5FBEA'],
      ['#fdf8e9', '#A33F5D', '#E0708F', '#E38274', '#F0AC6E', '#ECDE7D', '#F4FCA5'],
    ].map(interpolateRgbBasis),
    accents: ['#1f3fe0', '#e0193f'],
  },
};
for (const palette of Object.values(palettes)) palette.fills = palette.ramps.map((ramp) => ramp(0.85));
export const paletteNames = Object.keys(palettes);

export const defaultSettings = {
  year: years[0],
  playing: true,
  height: heightModes[0],
  palette: paletteNames[0],
  secondsPerElection: 2,
  stagger: 0.5,
  breath: 0.04,
  maxHeight: 110,
  minHeight: 0.6,
  heightExponent: 1,
  colorGamma: 0.5,
};

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

// Per election: how many counties changed party since the one before (the first has no "before").
export function countFlips(series) {
  const flips = years.map(() => ({ toDemocratic: 0, toRepublican: 0 }));
  for (const county of Object.values(series)) {
    const margins = county['margin %'];
    for (let index = 1; index < years.length; index++) {
      // A year without votes (or a tie) is 0 and never counts as a flip.
      if (margins[index - 1] * margins[index] < 0) flips[index][margins[index] > 0 ? 'toDemocratic' : 'toRepublican']++;
    }
  }
  return flips;
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
