import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Matrix4, ShapePath } from 'three';
import {
  buildSeries, countFlips, defaultSettings, flatHeights, getCountyHeight, heightModes, interpolateSeries,
  paletteNames, years,
} from './electionData.js';
import { createCountyMap } from './mapGeometry.js';

const elections = (values) => years.map((_, index) => values[index] ?? null);

test('header distinguishes loading, the first election, zero flips and a single flip', async () => {
  const { createServer } = await import('vite');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, logLevel: 'silent' });
  try {
    const { FlipCount } = await server.ssrLoadModule('/src/App.jsx');
    const render = (flips, previousYear) => renderToStaticMarkup(createElement(FlipCount, {
      flips, previousYear, accents: ['#4b2bbf', '#e0491b'], fills: ['#9a86e0', '#f39367'],
    })).replace(/<[^>]*>/g, '');
    assert.equal(render(undefined, 2016), '', 'loading does not invent a zero');
    assert.match(render({ toDemocratic: 0, toRepublican: 0 }, undefined), /first election/);
    assert.doesNotMatch(render({ toDemocratic: 0, toRepublican: 0 }, undefined), /since/);
    for (const [democratic, republican, expected] of [[64, 15, '79 counties'], [0, 0, '0 counties'], [1, 0, '1 county']]) {
      const text = render({ toDemocratic: democratic, toRepublican: republican }, 2016);
      assert.ok(text.includes(`${expected} flipped since 2016`));
      assert.ok(text.includes(`${democratic} to Democrats`));
      assert.ok(text.includes(`${republican} to Republicans`));
    }
  } finally {
    await server.close();
  }
});

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
  const fixtureFlips = countFlips(series);
  assert.deepEqual(fixtureFlips[1], { toDemocratic: 0, toRepublican: 1 });
  assert.deepEqual(fixtureFlips[2], { toDemocratic: 0, toRepublican: 0 }, 'sinking to a tie is not a flip yet');

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
  const flips = countFlips(bundled);
  assert.deepEqual(flips[0], { toDemocratic: 0, toRepublican: 0 });
  const in1964 = flips[years.indexOf(1964)];
  assert.ok(in1964.toDemocratic > 1000 && in1964.toRepublican > 50, 'LBJ landslide, while the Deep South leaves');

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

  assert.deepEqual(paletteNames, ['Lavender & peach', 'Blue & red']);
  const texels = map.uniforms.ramp.value.image.data;
  const lavender = texels.slice();
  const version = map.uniforms.ramp.value.version;
  map.update(0, 0, { ...still, palette: 'Blue & red' });
  assert.notDeepEqual(texels, lavender, 'switching palette repaints the ramp');
  assert.ok(map.uniforms.ramp.value.version > version, 'and re-uploads it');
  assert.deepEqual([...texels.slice(0, 3)], [...lavender.slice(0, 3)], 'both palettes leave the floor at the same cream');
  const resources = [map.mesh.geometry, map.mesh.material, map.uniforms.ramp.value, map.counties[0].geometry];
  let disposed = 0;
  resources.forEach((resource) => resource.addEventListener('dispose', () => disposed++));
  map.dispose();
  assert.equal(disposed, resources.length, 'the map owns and releases every allocated GPU resource');

  const anchored = createCountyMap({ paths: [path], xml: { getAttribute: () => '315.105 206.925' } }, still, series);
  assert.deepEqual(anchored.position, [-315.105, 206.925, 0], 'geographic extents must not shift the mainland framing');
  anchored.dispose();
  assert.throws(() => createCountyMap({ paths: [path], xml: { getAttribute: () => 'invalid' } }, still, series), /Invalid county map origin/);
});
