// Low-poly county map: us-atlas -> mapshaper -> continuous Albers -> public/counties.svg
// Usage: npm run data:map -- [percent of removable vertices to keep, default 10]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import mapshaper from 'mapshaper';
import { geoAlbers, geoConicEqualArea, geoIdentity, geoPath, geoTransform } from 'd3';

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
const projection = geoAlbers().scale(1300 * scale).translate([487.5 * scale, 305 * scale]);
// us-atlas uses Albers USA's relocated, resized insets. Undo each regional projection
// before placing these states on the same geographic map as the lower 48 and basemap.
// Explicit regional inverses also handle points on the composite's clipping boundary.
const regions = {
  '02': geoConicEqualArea().rotate([154, 0]).center([-2, 58.5]).parallels([55, 65])
    .scale(1300 * 0.35).translate([487.5 - 0.307 * 1300, 305 + 0.201 * 1300]),
  '15': geoConicEqualArea().rotate([157, 0]).center([-3, 19.9]).parallels([8, 18])
    .scale(1300).translate([487.5 - 0.205 * 1300, 305 + 0.212 * 1300]),
};
const regionalPaths = Object.fromEntries(Object.entries(regions).map(([state, regional]) => [
  state,
  geoPath(geoTransform({
    point(x, y) { this.stream.point(...projection(regional.invert([x, y]))); },
  })).digits(2),
]));
const pathFor = (feature) => regionalPaths[feature.id.slice(0, 2)] ?? toPath;
const paths = counties.map((feature) => `<path id="${feature.id}" d="${pathFor(feature)(feature)}"/>`);

const stateBounds = (state) => (regionalPaths[state] ?? toPath).bounds({
  type: 'FeatureCollection', features: counties.filter((feature) => feature.id.startsWith(state)),
});
const alaska = stateBounds('02');
const hawaii = stateBounds('15');
const california = stateBounds('06');
assert.ok(alaska[1][1] < 0 && alaska[1][0] < california[1][0], 'Alaska is northwest, not over Mexico');
assert.ok(hawaii[1][0] < california[0][0], 'Hawaii is west of California');
assert.ok(hawaii[0][1] + hawaii[1][1] > california[0][1] + california[1][1], 'Hawaii is southwest of California');
assert.equal(counties.length, 3139, 'preserve every county shape in the projected source');
assert.equal(new Set(counties.map((feature) => feature.id)).size, counties.length);
assert.ok(paths.every((path) => !path.includes('NaN') && !path.includes('d=""')));
const bounds = counties.map((feature) => pathFor(feature).bounds(feature));
const min = [0, 1].map((axis) => Math.min(...bounds.map((bound) => bound[0][axis])));
const max = [0, 1].map((axis) => Math.max(...bounds.map((bound) => bound[1][axis])));
const viewBox = [...min, max[0] - min[0], max[1] - min[1]].map((value) => value.toFixed(2));
writeFileSync(
  new URL('../public/counties.svg', import.meta.url),
  // Preserve the original composite map's center so moving the insets does not move the camera.
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}" data-origin="315.105 206.925">\n${paths.join('\n')}\n</svg>\n`,
);
console.log(`${counties.length} counties, simplify dp ${percent}% -> public/counties.svg`);
