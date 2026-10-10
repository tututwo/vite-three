import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { electorHexes, hexParties } from './electorBoard.js';

const electoral = JSON.parse(readFileSync(new URL('../public/electoral.json', import.meta.url), 'utf8'));
const election = (year) => electoral.elections.find((entry) => entry.year === year);
// Any spread-out centres will do for the invariants; the real ones come from the county map.
const centers = Object.fromEntries(Object.keys(electoral.states).map((code, index) => [code, [Math.cos(index) * 300, Math.sin(index * 1.7) * 200]]));

test('every elector gets exactly one hex, and no two hexes share a cell', () => {
  for (const year of [1868, 1872, 1960, 2016, 2024]) {
    const { hexes } = electorHexes(election(year), centers, { size: 8 });
    const electors = election(year).states.reduce((sum, state) => sum + Object.values(state.won).reduce((a, b) => a + b, 0), 0);
    assert.equal(hexes.length, electors, `${year} hexes`);
    assert.equal(new Set(hexes.map(({ q, r }) => `${q},${r}`)).size, hexes.length, `${year} cells`);
  }
});

test('2016 hexes follow the electors as counted: 304 R, 227 D, 7 faithless, Maine split 3–1', () => {
  const { hexes } = electorHexes(election(2016), centers, { size: 8 });
  const tally = (list) => list.reduce((counts, { party }) => ({ ...counts, [party]: (counts[party] ?? 0) + 1 }), {});
  assert.deepEqual(tally(hexes), { R: 304, D: 227, O: 7 });
  assert.deepEqual(tally(hexes.filter(({ state }) => state === 'ME')), { D: 3, R: 1 });
});

test('electors that were not counted (Georgia 1872) still hold their hexes', () => {
  assert.deepEqual(hexParties(election(1872).states.find(({ state }) => state === 'GA')), [...Array(8).fill('O'), 'X', 'X', 'X']);
});
