import { forceCollide, forceSimulation, forceX, forceY, mean } from 'd3';

// The Electoral College as a hex board: one hex per elector, each state a cluster near where it lies.
// States start at their map centres pulled toward the middle (so the board packs into one landmass),
// separate as circles sized by electors (a Dorling cartogram), then grow round-robin on a pointy-top
// hex grid whose lattice is the floor's (ElectionScene), so the board sits on the painted grid.
// ponytail: greedy packing plus hand nudges; tune NUDGES per apportionment if a state lands oddly.

const SQRT3 = Math.sqrt(3);
// Edge i of a hex faces 60 * i degrees (y up); its neighbour is this axial step away.
export const directions = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
// Nudges in Albers pixels of a 975-wide map, y down, for states the packing misplaces (2010 electors).
const NUDGES = { VT: [-6, -70], NH: [0, -40], ME: [10, -40], AL: [0, 45], MS: [-5, 30], MD: [14, 6],
  WV: [-10, -30], DE: [18, -10], DC: [10, -20], TN: [0, -10], KY: [0, -20] };
const insets = new Set(['AK', 'HI']);
export const partyIds = { X: 0, D: 1, R: 2, O: 3 };

// Every elector a state had, by who received the vote: counted electors when they differ from the
// state's choice (faithless or uncounted), the majority first so minorities sit on the cluster's edge.
export function hexParties(state) {
  const electors = Object.values(state.won).reduce((sum, n) => sum + n, 0);
  const source = state.cast ?? state.won;
  const parties = Object.entries(source).sort((a, b) => b[1] - a[1])
    .flatMap(([party, count]) => Array(count).fill(party === 'none' ? 'X' : party));
  while (parties.length < electors) parties.push('X');
  return parties.slice(0, electors);
}

// Cells per state depend only on how many electors each state had, so one layout serves every
// election of an apportionment: about 15 layouts for 1868-2024, each computed once.
const cache = new WeakMap();
function layout(counts, centers, { size, scale, compact, insetPull }) {
  if (!cache.has(centers)) cache.set(centers, new Map());
  const layouts = cache.get(centers);
  const cacheKey = [size, scale, compact, insetPull, ...counts.map(({ code, electors }) => `${code}${electors}`)].join(' ');
  if (layouts.has(cacheKey)) return layouts.get(cacheKey);
  const width = SQRT3 * size;
  const nodes = counts.map(({ code, electors }) => ({ code, electors, center: centers[code] })).filter((node) => node.electors && node.center);
  const mainland = nodes.filter((node) => !insets.has(node.code));
  const middle = [mean(mainland, (node) => node.center[0]), mean(mainland, (node) => node.center[1])];
  const hexArea = 2.598 * size * size;
  for (const node of nodes) {
    const pull = insets.has(node.code) ? insetPull : compact;
    const [nx, ny] = NUDGES[node.code] ?? [0, 0];
    node.tx = middle[0] + (node.center[0] - middle[0]) * pull + nx * scale;
    node.ty = middle[1] + (node.center[1] - middle[1]) * pull - ny * scale;
    node.x = node.tx;
    node.y = node.ty;
    node.r = Math.sqrt(node.electors * hexArea / Math.PI);
  }
  forceSimulation(nodes).stop()
    .force('x', forceX((node) => node.tx).strength(0.12))
    .force('y', forceY((node) => node.ty).strength(0.12))
    .force('collide', forceCollide((node) => node.r + size * 0.04).iterations(6))
    .tick(600);

  const centerOf = (q, r) => [width * (q + r / 2), 1.5 * size * r];
  const key = (q, r) => `${q},${r}`;
  const owner = new Map();
  const nearestFree = (x, y) => {
    const r0 = Math.round(y / (1.5 * size)), q0 = Math.round(x / width - r0 / 2);
    let best = null, distance = Infinity;
    for (let reach = 8; !best; reach *= 2) {
      for (let dr = -reach; dr <= reach; dr++) for (let dq = -reach; dq <= reach; dq++) {
        if (owner.has(key(q0 + dq, r0 + dr))) continue;
        const [hx, hy] = centerOf(q0 + dq, r0 + dr), d = (hx - x) ** 2 + (hy - y) ** 2;
        if (d < distance) { distance = d; best = [q0 + dq, r0 + dr]; }
      }
    }
    return best;
  };
  // Round-robin: each state claims its free neighbour hex nearest its circle's centre, one per round.
  const order = [...nodes].sort((a, b) => b.electors - a.electors || a.code.localeCompare(b.code));
  for (const node of order) node.cells = [];
  for (let active = order; active.length; active = active.filter((node) => node.cells.length < node.electors)) {
    for (const node of active) {
      let cell = null, distance = Infinity;
      for (const [q, r] of node.cells) for (const [dq, dr] of directions) {
        if (owner.has(key(q + dq, r + dr))) continue;
        const [hx, hy] = centerOf(q + dq, r + dr), d = (hx - node.x) ** 2 + (hy - node.y) ** 2;
        if (d < distance) { distance = d; cell = [q + dq, r + dr]; }
      }
      cell ??= nearestFree(node.x, node.y);
      owner.set(key(...cell), node);
      node.cells.push(cell);
    }
  }

  const result = { nodes, centerOf, key };
  if (layouts.size > 40) layouts.clear();
  layouts.set(cacheKey, result);
  return result;
}

// centers: { [state]: [x, y] } in world units (y up). scale: world units per Albers pixel.
export function electorHexes(election, centers, { size, scale = 1, compact = 0.55, insetPull = 0.35 }) {
  const parties = Object.fromEntries(election.states.map((state) => [state.state, hexParties(state)]));
  const counts = election.states.map(({ state }) => ({ code: state, electors: parties[state].length }));
  const { nodes, centerOf, key } = layout(counts, centers, { size, scale, compact, insetPull });
  const hexes = nodes.flatMap((node) => node.cells.map(([q, r], index) => {
    const [x, y] = centerOf(q, r);
    return { state: node.code, q, r, x, y, party: parties[node.code][index] };
  }));
  const byCell = new Map(hexes.map((hex) => [key(hex.q, hex.r), hex]));
  // Bits 0-5: a party border on edge i; 6-11: a state border; the party id from bit 13.
  for (const hex of hexes) {
    let edges = partyIds[hex.party] * 8192;
    directions.forEach(([dq, dr], side) => {
      const next = byCell.get(key(hex.q + dq, hex.r + dr));
      if (!next || next.party !== hex.party) edges += 2 ** side;
      if (!next || next.state !== hex.state) edges += 2 ** (side + 6);
    });
    hex.edges = edges;
  }
  const labels = nodes.map((node) => ({ state: node.code, electors: node.electors,
    x: mean(node.cells, ([q, r]) => centerOf(q, r)[0]), y: mean(node.cells, ([q, r]) => centerOf(q, r)[1]) }));
  return { hexes, labels };
}
