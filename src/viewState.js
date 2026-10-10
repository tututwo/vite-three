import { defaultSettings, heightModes, paletteNames, years } from './electionData.js';

const asUrl = (url) => {
  try { return new URL(url, 'https://election-map.invalid'); }
  catch { return new URL('https://election-map.invalid'); }
};

// County membership can be checked after names load; FIPS always remains a five-digit string.
export function parseViewState(url, countyNames) {
  const params = asUrl(url).searchParams;
  const county = params.get('county');
  return {
    year: years.includes(Number(params.get('year'))) ? Number(params.get('year')) : years.at(-1),
    mode: params.get('mode') === 'shift' ? 'shift' : 'result',
    county: /^\d{5}$/.test(county ?? '') && (!countyNames || Object.hasOwn(countyNames, county)) ? county : null,
    flippedOnly: params.get('flipped') === '1',
    palette: paletteNames.includes(params.get('palette')) ? params.get('palette') : defaultSettings.palette,
    height: heightModes.includes(params.get('height')) ? params.get('height') : defaultSettings.height,
  };
}

// Start with the current URL so a Vite deployment subpath, unrelated query and hash survive.
export function serializeViewState(state, url) {
  const next = asUrl(url);
  for (const key of ['year', 'mode', 'palette', 'height']) next.searchParams.set(key, state[key]);
  next.searchParams.set('flipped', state.flippedOnly ? '1' : '0');
  if (state.county) next.searchParams.set('county', state.county);
  else next.searchParams.delete('county');
  return next.href;
}
