import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei/web/Html.js';
import * as THREE from 'three';
import { electorHexes } from './electorBoard.js';
import { electoralCounts } from './victory.js';

const capacity = 640; // more than the most electors there have been (538)
const parchment = new THREE.Color('#e6dcc3');
const uncounted = new THREE.Color('#5b6670');

// The lead, in points of all votes, of the party that won most of a state's electors; NaN where the
// legislature chose them (no popular vote), which keeps those states at the base height.
function leadOf(state, party) {
  if (!state.votes) return NaN;
  const [democratic, republican, other, all] = state.votes;
  const byParty = { D: democratic, R: republican, O: other };
  const rival = Math.max(...Object.entries(byParty).filter(([name]) => name !== party).map(([, votes]) => votes));
  return 100 * (byParty[party] - rival) / all;
}
const strength = (points) => Number.isFinite(points) ? Math.sqrt(Math.min(Math.max(points, 0), 60) / 60) : 0;

// Hex tops are painted in the shader from per-hex edge bits (electorBoard.js): the party border
// inset along edges where the party changes, a thin state line, gold round the tipping-point state,
// and a gold seal on an elector who did not vote for the state's choice.
function createBoard() {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const edges = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  geometry.setAttribute('edges', edges);
  const uniforms = {
    hexBorder: { value: 0.16 },
    gold: { value: new THREE.Color('#f3d27a') },
    accentD: { value: new THREE.Color() },
    accentR: { value: new THREE.Color() },
    accentO: { value: new THREE.Color('#8a7a55') },
  };
  const material = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  material.customProgramCacheKey = () => 'elector-hex-v1';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float edges;
        varying float vEdges;
        varying vec2 vHex;
        varying float vTop;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vEdges = edges;
        vHex = position.xy;
        vTop = step(0.5, normal.z);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vEdges;
        varying vec2 vHex;
        varying float vTop;
        uniform float hexBorder;
        uniform vec3 gold;
        uniform vec3 accentD;
        uniform vec3 accentR;
        uniform vec3 accentO;
        float bit(float bits, float index) { return mod(floor(bits / exp2(index)), 2.0); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // The edge this pixel is nearest faces a multiple of 60 degrees; the unit hex's apothem is 0.866.
        float side = mod(floor(atan(vHex.y, vHex.x) / 1.0471976 + 0.5) + 6.0, 6.0);
        float facing = side * 1.0471976;
        float toEdge = 0.8660254 - dot(vHex, vec2(cos(facing), sin(facing)));
        float edgeAA = fwidth(toEdge);
        float party = mod(floor(vEdges / 8192.0), 4.0);
        vec3 accent = party < 1.5 ? accentD : (party < 2.5 ? accentR : accentO);
        float band = bit(vEdges, side) * (1.0 - smoothstep(hexBorder, hexBorder + edgeAA, toEdge));
        float stateLine = bit(vEdges, side + 6.0) * (1.0 - smoothstep(0.03, 0.03 + edgeAA, toEdge));
        float goldEdge = bit(vEdges, 12.0) * bit(vEdges, side + 6.0) * (1.0 - smoothstep(hexBorder * 1.3, hexBorder * 1.3 + edgeAA, toEdge));
        float seal = step(2.5, party) * (1.0 - smoothstep(0.2, 0.2 + edgeAA * 2.0, length(vHex)));
        diffuseColor.rgb = mix(diffuseColor.rgb, accent, band * vTop);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.1, 0.14), stateLine * vTop * 0.55);
        diffuseColor.rgb = mix(diffuseColor.rgb, gold, max(goldEdge, seal) * vTop);
        // Walls a shade darker than the top, like a raised tile.
        diffuseColor.rgb *= mix(0.72, 1.0, vTop);`);
  };
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'elector-board';
  for (let index = 0; index < capacity; index++) mesh.setColorAt(index, parchment);
  return { mesh, geometry, material, uniforms, edges };
}

export default function HexBoard({ election, centers, scale, settings, palette }) {
  const invalidate = useThree((state) => state.invalidate);
  const board = useMemo(createBoard, []);
  useEffect(() => () => { board.geometry.dispose(); board.material.dispose(); board.mesh.dispose(); }, [board]);
  const { hexSize, boardCompact, boardGap, boardHeight, boardBase, hexBorder, boardLabels, boardLabelMin } = settings;
  const layout = useMemo(() => electorHexes(election, centers, { size: hexSize, scale, compact: boardCompact }), [election, centers, hexSize, scale, boardCompact]);
  const tipping = useMemo(() => electoralCounts(election).tippingPoint?.state ?? null, [election]);
  // What the board eases toward, and where it is now (heights and linear colours per hex).
  const motion = useRef({ cells: '', height: new Float32Array(capacity), color: new Float32Array(capacity * 3), target: null });

  // Targets per hex: height from the state's lead, colour from who received the elector, edge bits.
  const targets = useMemo(() => {
    const { hexes } = layout;
    const byState = Object.fromEntries(election.states.map((state) => {
      const counts = Object.entries(state.won).sort((a, b) => b[1] - a[1]);
      return [state.state, { party: counts[0]?.[0], points: leadOf(state, counts[0]?.[0]) }];
    }));
    const height = new Float32Array(capacity), color = new Float32Array(capacity * 3), edges = new Float32Array(capacity);
    const top = {}, scratch = new THREE.Color();
    hexes.forEach((hex, index) => {
      const { party, points } = byState[hex.state];
      height[index] = boardBase + boardHeight * strength(points);
      top[hex.state] = Math.max(top[hex.state] ?? 0, height[index]);
      if (hex.party === 'D' || hex.party === 'R') {
        const shade = hex.party === party ? 0.35 + 0.6 * strength(points) : 0.45;
        scratch.setStyle(palette.ramps[hex.party === 'D' ? 0 : 1](shade));
      } else scratch.copy(hex.party === 'O' ? parchment : uncounted);
      scratch.toArray(color, index * 3);
      edges[index] = hex.edges + (hex.state === tipping ? 4096 : 0);
    });
    return { hexes, height, color, edges, top };
  }, [layout, election, tipping, palette, boardBase, boardHeight]);

  useLayoutEffect(() => {
    board.edges.array.set(targets.edges);
    board.edges.needsUpdate = true;
    board.mesh.count = targets.hexes.length;
    board.uniforms.accentD.value.set(palette.accents[0]);
    board.uniforms.accentR.value.set(palette.accents[1]);
    const current = motion.current;
    // A new layout (another apportionment) rises out of the floor; the same layout eases in place.
    const cells = targets.hexes.map(({ q, r }) => `${q},${r}`).join(' ');
    if (cells !== current.cells) {
      current.height.fill(0);
      current.color.set(targets.color);
      current.cells = cells;
    }
    current.target = targets;
    invalidate();
  }, [targets, palette, board, invalidate]);

  useLayoutEffect(() => {
    board.uniforms.hexBorder.value = hexBorder;
    invalidate();
  }, [board, hexBorder, invalidate]);

  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const scratch = useMemo(() => new THREE.Color(), []);
  useFrame((_, delta) => {
    const { target, height, color } = motion.current;
    if (!target) return;
    const step = settings.reducedMotion ? 1 : 1 - Math.exp(-5 * Math.min(delta, 0.1));
    const radius = hexSize * (1 - boardGap);
    let moving = false;
    target.hexes.forEach((hex, index) => {
      height[index] += (target.height[index] - height[index]) * step;
      if (Math.abs(target.height[index] - height[index]) > 0.01) moving = true;
      else height[index] = target.height[index];
      for (let channel = index * 3; channel < index * 3 + 3; channel++) {
        color[channel] += (target.color[channel] - color[channel]) * step;
        if (Math.abs(target.color[channel] - color[channel]) > 0.002) moving = true;
      }
      board.mesh.setMatrixAt(index, matrix.makeScale(radius, radius, Math.max(height[index], 0.01)).setPosition(hex.x, hex.y, 0));
      board.mesh.setColorAt(index, scratch.fromArray(color, index * 3));
    });
    board.mesh.instanceMatrix.needsUpdate = true;
    board.mesh.instanceColor.needsUpdate = true;
    if (moving) invalidate();
  }, -0.4);

  return <>
    <primitive object={board.mesh} />
    {boardLabels && layout.labels.filter((label) => label.electors >= boardLabelMin || label.state === tipping).map((label) => <Html key={label.state} position={[label.x, label.y, targets.top[label.state] + 1]} center zIndexRange={[20, 0]} pointerEvents="none">
      <span className={`hex-label${label.state === tipping ? ' is-tipping' : ''}`}>{label.state}<b>{label.electors}</b>{label.state === tipping && <em>Tipping point</em>}</span>
    </Html>)}
  </>;
}
