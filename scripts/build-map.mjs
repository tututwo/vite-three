// Low-poly county map: us-atlas (Albers USA, 975x610) -> mapshaper -> public/counties.svg
// Usage: npm run data:map -- [percent of removable vertices to keep, default 10]
import { readFileSync, writeFileSync } from 'node:fs';
import mapshaper from 'mapshaper';
import { geoIdentity, geoPath } from 'd3';

const percent = Number(process.argv[2] ?? 10);
if (!(percent > 0 && percent <= 100)) throw new Error(`percent must be in (0, 100], got ${process.argv[2]}`);
// Keeps the lower 48 the size the camera, caption and shadow frustum were tuned for (~650 units wide).
const scale = 0.669;

const source = readFileSync(new URL('../node_modules/us-atlas/counties-albers-10m.json', import.meta.url), 'utf8');
// Simplifying the shared topology keeps neighbours watertight; Douglas-Peucker keeps the corners
// that make the shapes read as faceted, and keep-shapes stops small counties from vanishing.
const output = await mapshaper.applyCommands(
  `-i counties.json -simplify dp ${percent}% keep-shapes -o target=counties format=geojson counties.geojson`,
  { 'counties.json': source },
);
const counties = JSON.parse(output['counties.geojson']).features.filter((feature) => feature.geometry);
if (counties.length < 3100 || !counties.every((feature) => /^\d{5}$/.test(feature.id))) {
  throw new Error(`expected 3100+ counties with fips ids, got ${counties.length}`);
}

// Two decimals is far below a pixel at this scale and shrinks the file several times over.
const toPath = geoPath(geoIdentity().scale(scale)).digits(2);
const paths = counties.map((feature) => `<path id="${feature.id}" d="${toPath(feature)}"/>`);
const size = [975, 610].map((side) => (side * scale).toFixed(2));
writeFileSync(
  new URL('../public/counties.svg', import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.join(' ')}">\n${paths.join('\n')}\n</svg>\n`,
);
console.log(`${counties.length} counties, simplify dp ${percent}% -> public/counties.svg`);
