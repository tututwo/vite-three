import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ShapePath } from 'three';
import {
  basemapBounds, brokenStreaks, buildSeries, countFlips, defaultSettings, electionAt, flatHeights, heightModes, paletteNames, rankFlippedCounties, streaks, years,
} from './electionData.js';
import { countyCounts, electoralCounts } from './victory.js';
import { createCountyMap } from './mapGeometry.js';

const elections = (values) => years.map((_, index) => values[index] ?? null);
const asset = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const still = { ...defaultSettings, breath: 0 };
const fixtureSeries = () => buildSeries({
  years,
  counties: {
    '01001': { diff: elections([900, -400, 0]), total: elections([1000, 400, 50]) },
    '01003': { diff: elections([Infinity, NaN, 5, 5]), total: elections([10, 10, 0, -3]) },
  },
});

test('header distinguishes loading, first election, missing comparisons and actual flip counts', async () => {
  const { createServer } = await import('vite');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, logLevel: 'silent' });
  try {
    const { FlipCount, CountyRanking } = await server.ssrLoadModule('/src/App.jsx');
    const render = (flips, previousYear) => renderToStaticMarkup(createElement(FlipCount, {
      flips, previousYear, fills: ['#9a86e0', '#f39367'],
    })).replace(/<[^>]*>/g, '');
    assert.equal(render(undefined, 2016), '', 'loading does not invent a zero');
    assert.match(render({ toDemocratic: 0, toRepublican: 0, compared: 0 }, undefined), /first election/);
    assert.doesNotMatch(render({ toDemocratic: 0, toRepublican: 0, compared: 0 }, undefined), /changed lead/);
    for (const [democratic, republican, expected] of [[64, 15, '79.0%'], [0, 0, '0.0%'], [1, 0, '1.0%']]) {
      const text = render({ toDemocratic: democratic, toRepublican: republican, compared: 100 }, 2016);
      assert.ok(text.includes(`Share of counties${expected}`), text);
      assert.ok(text.includes(`Counties flipped${democratic + republican}`), text);
      assert.ok(text.includes('Of 100 counties with returns in both elections.'), text);
      assert.ok(text.includes(`${democratic} to Democrats`));
      assert.ok(text.includes(`${republican} to Republicans`));
    }
    const missing = render({ toDemocratic: 0, toRepublican: 0, compared: 0 }, 2016);
    assert.equal(missing, 'No comparable county returns for this election and 2016.');
    assert.doesNotMatch(missing, /%|NaN/, 'missing comparisons are not reported as zero flips');
    const in1896 = countFlips(buildSeries(JSON.parse(asset('elections.json'))))[years.indexOf(1896)];
    assert.deepEqual(in1896, { toDemocratic: 362, toRepublican: 322, compared: 2652 });
    const text1896 = render(in1896, 1892);
    assert.match(text1896, /Counties flipped684Share of counties25\.8%/);
    assert.match(text1896, /Of 2,652 counties with returns in both elections\./);

    const renderRanking = (data, yearIndex) => renderToStaticMarkup(createElement(CountyRanking, {
      elections: data, yearIndex, fills: ['#9a86e0', '#f39367'], onInteract: () => {},
    })).replace(/<[^>]*>/g, '');
    const data = { ...JSON.parse(asset('elections.json')), countyNames: JSON.parse(asset('county-names.json')) };
    const ranking = renderRanking(data, years.indexOf(2020));
    assert.match(ranking, /Kenedy, Texas40\.0 pp/);
    assert.match(ranking, /D \+8\.1% → R \+32\.0%194 votes/);
    assert.match(ranking, /Show all 79 flipped counties/);
    assert.match(ranking, /pp = percentage points/);
    assert.match(renderRanking(null, 1), /Loading county returns/);
    assert.match(renderRanking(data, 0), /Choose 1872 or later/);
    assert.match(renderRanking({ counties: { '01001': { diff: [10, 20], total: [100, 100] } } }, 1), /No counties changed/);
  } finally {
    await server.close();
  }
});

test('county rankings distinguish margin shifts from current margins using unscaled valid returns', () => {
  const counties = {
    '01005': { diff: [1, -95], total: [100, 100] },
    '01003': { diff: [-95, 5], total: [100, 100] },
    '01001': { diff: [-95, 5], total: [100, 100] },
    '01007': { diff: [null, -20], total: [100, 100] },
    '01009': { diff: [20, null], total: [100, 100] },
    '01011': { diff: [0, -20], total: [100, 100] },
    '01013': { diff: [20, 0], total: [100, 100] },
    '01015': { diff: [20, 10], total: [100, 100] },
    '01017': { diff: [Infinity, -20], total: [100, 100] },
    '01019': { diff: [20, NaN], total: [100, 100] },
    '01021': { diff: [20, -20], total: [0, 100] },
    '01023': { diff: [20, -20], total: [100, -1] },
    '01025': { diff: [20, -20], total: [100, Infinity] },
  };
  const swing = rankFlippedCounties(counties, 1);
  assert.deepEqual(swing.map(({ fips }) => fips), ['01001', '01003', '01005'], 'ties use FIPS, not insertion order; non-flips and invalid returns are excluded');
  assert.deepEqual(swing[0], { fips: '01001', previousMargin: -95, margin: 5, swing: 100, total: 100, value: 100 });
  const margin = rankFlippedCounties(counties, 1, 'margin');
  assert.deepEqual(margin.map(({ fips }) => fips), ['01005', '01001', '01003']);
  assert.equal(margin[0].margin, -95, 'margins above 90% must not inherit the map height clamp');
  assert.equal(margin[0].value, 95);
  assert.deepEqual(rankFlippedCounties(counties, 0), [], 'first election has no comparison');
  assert.deepEqual(rankFlippedCounties(counties, years.length), []);
});

test('signed series and flips', () => {
  const series = fixtureSeries();
  assert.deepEqual(series['01001']['margin %'].slice(0, 4), [1, -1, 0, 0]);
  assert.deepEqual(series['01001']['margin votes'].slice(0, 3), [1, -Math.sqrt(400 / 900), 0]);
  assert.deepEqual(series['01001'].voted.slice(0, 4), [1, 1, 1, 0], 'a tie still counts as having voted');
  for (const values of Object.values(series['01003'])) assert.deepEqual(values, flatHeights, 'garbage never becomes a height');
  assert.throws(() => buildSeries({ years: [2000, 2004], counties: {} }), /1868-2024/);
  assert.throws(() => buildSeries(null), /1868-2024/);
  const fixtureFlips = countFlips(series);
  assert.deepEqual(fixtureFlips[1], { toDemocratic: 0, toRepublican: 1, compared: 1 });
  assert.deepEqual(fixtureFlips[2], { toDemocratic: 0, toRepublican: 0, compared: 1 }, 'sinking to a tie is not a flip yet');
  assert.deepEqual(fixtureFlips[3], { toDemocratic: 0, toRepublican: 0, compared: 0 }, 'a county that stops voting is not compared');

  const last = years.length - 1;
  assert.deepEqual([0.4, 0.6, last + 0.4, last + 0.6].map(electionAt), [0, 1, last, 0], 'the caption wraps with the map');
});

test('bundled returns, county shapes and basemap agree', () => {
  const data = JSON.parse(asset('elections.json'));
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
  assert.deepEqual(flips[0], { toDemocratic: 0, toRepublican: 0, compared: 0 });
  const in1964 = flips[years.indexOf(1964)];
  assert.ok(in1964.toDemocratic > 1000 && in1964.toRepublican > 50, 'LBJ landslide, while the Deep South leaves');
  assert.ok(in1964.compared > 3000 && in1964.compared >= in1964.toDemocratic + in1964.toRepublican, 'the share has a base');

  const names = JSON.parse(asset('county-names.json'));
  for (const fips of Object.keys(bundled)) {
    assert.ok(names[fips]?.name && names[fips]?.state, `county ${fips} needs a name and state`);
  }
  for (const [index, flip] of flips.entries()) {
    assert.equal(rankFlippedCounties(data.counties, index).length, flip.toDemocratic + flip.toRepublican,
      `ranked counties must agree with the flip total in ${years[index]}`);
  }
  for (const [year, count, swingFips, swingValue, marginFips, marginValue] of [
    [1940, 715, '48477', 96.24901548188978, '38051', 83.31584470094438],
    [2020, 79, '48261', 40.023279015630195, '48261', 31.95876288659794],
  ]) {
    const index = years.indexOf(year);
    const swing = rankFlippedCounties(data.counties, index);
    const margin = rankFlippedCounties(data.counties, index, 'margin');
    assert.equal(swing.length, count);
    assert.equal(swing[0].fips, swingFips);
    assert.ok(Math.abs(swing[0].value - swingValue) < 1e-10);
    assert.equal(margin[0].fips, marginFips);
    assert.ok(Math.abs(margin[0].value - marginValue) < 1e-10);
  }

  const shapes = new Set([...asset('counties.svg').matchAll(/id="(\d{5})"/g)].map((match) => match[1]));
  assert.ok(shapes.size > 3000);
  // If a simplification level drops another tiny county, give it a successor in export-elections.R.
  assert.deepEqual(Object.keys(bundled).filter((fips) => !shapes.has(fips)), [], 'every county with returns has a shape');
  assert.ok(asset('basemap.svg').includes(`viewBox="${basemapBounds.join(' ')}"`),
    'basemapBounds changed: rerun npm run data:basemap so the texture matches where the scene puts it');
});

test('county map geometry, palette and disposal', () => {
  const series = fixtureSeries();
  // Two 10x20 counties that share the border at x = 10.
  const county = (x, id) => {
    const path = new ShapePath();
    path.moveTo(x, 0).lineTo(x + 10, 0).lineTo(x + 10, 20).lineTo(x, 20).lineTo(x, 0);
    path.userData = { node: { id } };
    return path;
  };
  const path = county(0, '01001');
  const map = createCountyMap({ paths: [path, county(10, '01003')] }, still, series);
  assert.deepEqual(map.position, [-10, 10, 0]);

  // The vertex shader reads one row per county: [margin %, margin votes, voted] per election, then [delay, phase].
  const { image } = map.uniforms.series.value;
  const texel = (row, column) => [...image.data.slice((row * image.width + column) * 4, (row * image.width + column + 1) * 4)];
  assert.equal(image.width, years.length + 1);
  assert.deepEqual(texel(0, 0), [1, 1, 1, 0]);
  assert.deepEqual(texel(0, 1), [-1, Math.fround(-Math.sqrt(400 / 900)), 1, 0]);
  assert.deepEqual(texel(1, 0), [0, 0, 0, 0], 'garbage returns stay flat');
  assert.ok(texel(0, years.length)[0] > texel(1, years.length)[0], 'the western county waits longer into each transition');

  const { county: row, neighbor, position } = map.mesh.geometry.attributes;
  const across = new Set();
  for (let vertex = 0; vertex < neighbor.count; vertex++) {
    if (neighbor.getX(vertex) >= 0) across.add(`${row.getX(vertex)}->${neighbor.getX(vertex)} at x=${position.getX(vertex)}`);
  }
  assert.deepEqual([...across].sort(), ['0->1 at x=10', '1->0 at x=10'], 'only walls on the shared border rise out of a neighbour');

  map.update(3, { ...still, height: 'margin votes', ambientOcclusion: 0.5 });
  const { seconds, heightMode, maxHeight, occlusion } = map.uniforms;
  assert.deepEqual([seconds, heightMode, maxHeight, occlusion].map(({ value }) => value), [3, 1, still.maxHeight, 0.5]);

  // A seek starts from what is on screen: hold() freezes it the way the vertex shader computes it.
  const held = map.uniforms.held.value.image.data;
  const shown = () => [...held.slice(0, 3)].map((value) => +value.toFixed(5));
  map.update(0, { ...still, stagger: 0 });
  map.show(0, 1, 0.5);
  map.hold();
  assert.deepEqual(shown(), [0, 0.16667, 1], 'halfway from 1868 to 1872');
  map.show(-1, 2, 0.5);
  map.hold();
  assert.deepEqual(shown(), [0, 0.08333, 1], 'a seek during a seek starts from where the first one had got to');

  assert.deepEqual(paletteNames, ['Lavender & peach', 'Blue & red']);
  const texels = map.uniforms.ramp.value.image.data;
  const lavender = texels.slice();
  const version = map.uniforms.ramp.value.version;
  map.update(0, { ...still, palette: 'Blue & red' });
  assert.notDeepEqual(texels, lavender, 'switching palette repaints the ramp');
  assert.ok(map.uniforms.ramp.value.version > version, 'and re-uploads it');
  assert.deepEqual([...texels.slice(0, 3)], [...lavender.slice(0, 3)], 'both palettes leave the floor at the same cream');
  const resources = [map.mesh.geometry, map.mesh.material, map.mesh.customDepthMaterial, map.uniforms.ramp.value, map.uniforms.series.value, map.uniforms.held.value];
  let disposed = 0;
  resources.forEach((resource) => resource.addEventListener('dispose', () => disposed++));
  map.dispose();
  assert.equal(disposed, resources.length, 'the map owns and releases every allocated GPU resource');

  const anchored = createCountyMap({ paths: [path], xml: { getAttribute: () => '315.105 206.925' } }, still, series);
  assert.deepEqual(anchored.position, [-315.105, 206.925, 0], 'geographic extents must not shift the mainland framing');
  anchored.dispose();
  assert.throws(() => createCountyMap({ paths: [path], xml: { getAttribute: () => 'invalid' } }, still, series), /Invalid county map origin/);
});

test('loyalty streaks and the five counts', () => {
  // D, D, third parties together ahead, D, tie, missing, R: a third-party lead, a tie and a gap each end a streak.
  const county = { diff: elections([10, 10, 1, 10, 0, null, -5]), total: elections([30, 30, 30, 30, 30, null, 30]), other: elections([0, 0, 20, 0, 0, null, 0]) };
  assert.deepEqual(streaks(county).slice(0, 7).map(({ leader, length }) => `${leader}${length}`), ['D1', 'D2', 'O1', 'D1', 'null0', 'null0', 'R1']);

  const returns = JSON.parse(asset('elections.json'));
  const electoral = JSON.parse(asset('electoral.json'));
  const at = (year) => years.indexOf(year);
  const e2016 = electoralCounts(electoral.elections[at(2016)]);
  assert.deepEqual([e2016.won, e2016.cast], [{ D: 232, R: 306, O: 0 }, { D: 227, R: 304, O: 7, none: 0 }]);
  assert.deepEqual([e2016.tippingPoint.state, e2016.tippingPoint.votes], ['WI', 22748]);
  assert.deepEqual([e2016.states.D, e2016.states.R, e2016.dc], [20, 30, 'D']);
  assert.deepEqual(['FL', 537], ((tip) => [tip.state, tip.votes])(electoralCounts(electoral.elections[at(2000)]).tippingPoint));
  assert.deepEqual(countyCounts(returns, at(2016), electoral.countyLand).counties, { D: 486, R: 2623, O: 1, tie: 0 });
  assert.equal(countyCounts(returns, at(2024), electoral.countyLand), null, '2024 has state results only');

  const broken = brokenStreaks(returns.counties, at(2016));
  assert.deepEqual([broken[0].fips, broken[0].leader, broken[0].length, broken[0].start], ['21063', 'D', 36, 1872], 'Elliott, Kentucky');
  assert.equal(broken.filter(({ length }) => length >= 5).length, 106);
});
