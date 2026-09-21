import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Matrix4, ShapePath } from 'three';
import { buildSeries, defaultSettings, flatHeights, getCountyHeight, heightModes, interpolateSeries, years } from './electionData.js';
import { createCountyMap } from './mapGeometry.js';

const elections = (values) => years.map((_, index) => values[index] ?? null);

test('election data, signed transitions, and the bundled map + returns', () => {
  const series = buildSeries({
    years,
    counties: {
      '01001': { diff: elections([900, -400, 0]), total: elections([1000, 400, 50]) },
      '01003': { diff: elections([Infinity, NaN, 5, 5]), total: elections([10, 10, 0, -3]) },
    },
  });
  assert.deepEqual(series['01001']['margin %'].slice(0, 4), [1, -1, 0, 0]);
  assert.deepEqual(series['01001']['margin votes'].slice(0, 3), [1, -Math.sqrt(400 / 900), 0]);
  assert.deepEqual(series['01001'].voted.slice(0, 4), [1, 1, 1, 0], 'a tie still counts as having voted');
  for (const values of Object.values(series['01003'])) assert.deepEqual(values, flatHeights, 'garbage never becomes a height');
  assert.throws(() => buildSeries({ years: [2000, 2004], counties: {} }), /1868-2020/);
  assert.throws(() => buildSeries(null), /1868-2020/);

  const last = years.length - 1;
  const heights = [...flatHeights];
  heights[0] = 1;
  heights[1] = heights[last] = -1;
  assert.equal(interpolateSeries(heights, 0.5, 0, 0), 0, 'a party flip passes through zero');
  assert.equal(interpolateSeries(heights, 0.2, 1, 0.5), 1, 'stagger waits for the wave');
  assert.equal(interpolateSeries(heights, last + 0.5, 0, 0), 0, 'last election wraps into first');
  assert.equal(interpolateSeries(heights, years.length, 0, 0), 1);
  assert.equal(interpolateSeries(heights, -0.5, 0, 0), 0);
  assert.equal(getCountyHeight(0, 0, 0, defaultSettings), defaultSettings.minHeight);
  const still = { ...defaultSettings, breath: 0 };
  assert.equal(getCountyHeight(-1, 5, 2, still), still.minHeight + still.maxHeight);
  assert.equal(interpolateSeries(flatHeights, 2.75, 0.5, 0.5), 0);

  const data = JSON.parse(readFileSync(new URL('../public/elections.json', import.meta.url), 'utf8'));
  assert.equal(data.nominees.length, years.length);
  const bundled = buildSeries(data);
  assert.ok(Object.keys(bundled).length > 3000);
  assert.ok(Object.values(bundled).some((county) =>
    Math.min(...county['margin %']) < 0 && Math.max(...county['margin %']) > 0
  ));
  for (const county of Object.values(bundled)) {
    for (const mode of heightModes) {
      assert.equal(county[mode].length, years.length);
      assert.ok(county[mode].every((height) => Number.isFinite(height) && Math.abs(height) <= 1));
    }
  }
  assert.equal(bundled['12086'].voted[years.indexOf(1960)], 1, 'Dade county votes live on in Miami-Dade');

  const svg = readFileSync(new URL('../public/counties.svg', import.meta.url), 'utf8');
  const shapes = new Set([...svg.matchAll(/id="(\d{5})"/g)].map((match) => match[1]));
  assert.ok(shapes.size > 3000);
  // If a simplification level drops another tiny county, give it a successor in export-elections.R.
  assert.deepEqual(Object.keys(bundled).filter((fips) => !shapes.has(fips)), [], 'every county with returns has a shape');

  const path = new ShapePath();
  path.moveTo(0, 0).lineTo(10, 0).lineTo(10, 20).lineTo(0, 20).lineTo(0, 0);
  path.userData = { node: { id: '01001' } };
  const map = createCountyMap({ paths: [path] }, still, series);
  assert.deepEqual(map.position, [-5, 10, 0]);
  map.update(0.5, 0, { ...still, stagger: 0 });
  assert.equal(map.counties[0].height, still.minHeight);
  const matrix = new Matrix4();
  map.mesh.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[10] - still.minHeight) < 1e-6);
  const resources = [map.mesh.geometry, map.mesh.material, map.uniforms.ramp.value, map.counties[0].geometry];
  let disposed = 0;
  resources.forEach((resource) => resource.addEventListener('dispose', () => disposed++));
  map.dispose();
  assert.equal(disposed, resources.length, 'the map owns and releases every allocated GPU resource');
});
