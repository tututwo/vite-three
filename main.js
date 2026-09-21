import csv from "./src/princetonData.csv?raw";
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { VignetteShader } from "three/addons/shaders/VignetteShader.js";
import GUI from "lil-gui";
import * as d3 from "d3";
import { gsap } from "gsap";

const countyId = "fips";
const colorVariable = "winningParty";
// What a column's height means, each shaped into 0..1
const heightVariables = {
  // squared: close races stay flat, landslides tower
  "margin %": (d) => Math.min(+d.winningPercentage / 0.9, 1) ** 2,
  // sqrt: Los Angeles doesn't flatten everyone else
  "margin votes": (d, maxVoteDiff) => Math.sqrt(+d.voteDiff / maxVoteDiff),
};
// Low -> high altitude. The first two stops are the dusky near-zero colours, so a
// county that flips sinks into almost the same dark tone before it rises in the other ramp
const democraticColors = [
  "#373F73",
  "#4C5CB8",
  "#688EFB",
  "#57B3FF",
  "#4CDDF5",
  "#5EECEB",
  "#A5FBEA",
];
const republicanColors = [
  "#684558",
  "#A33F5D",
  "#E0708F",
  "#E38274",
  "#F0AC6E",
  "#ECDE7D",
  "#F4FCA5",
];
const groundColor = "#30343d";

const yearRange = [2000, 2004, 2008, 2012, 2016, 2020];
const yearCount = yearRange.length;
const params = {
  year: yearRange[0],
  playing: true,
  height: "margin %",
  secondsPerElection: 3,
  stagger: 0.5, // share of each transition a county may spend waiting for the wave to reach it
  breath: 0.04, // idle swell as a fraction of height, 0 = still
  maxHeight: 110,
  minHeight: 0.6,
  heightExponent: 1, // >1 flattens the carpet and exaggerates the towers
  colorGamma: 0.5, // <1 moves low columns up the ramp, out of the dusky zone
};
const state = { time: 0 }; // continuous position on the timeline, in elections (0 = 2000, 1.5 = between 2004 and 2008)

// fips -> height variable -> signed height per election: + Democratic, - Republican.
// Interpolating the signed value is what makes a flip pass through zero height
const rows = d3.csvParse(csv);
const maxVoteDiff = d3.max(rows, (d) => +d.voteDiff);
const series = {};
rows.forEach((d) => {
  const sign = d[colorVariable] === "Republican" ? -1 : 1;
  const yearIndex = yearRange.indexOf(+d.election_year);
  for (const [name, shape] of Object.entries(heightVariables)) {
    ((series[d[countyId]] ??= {})[name] ??= new Array(yearCount).fill(0))[
      yearIndex
    ] = sign * shape(d, maxVoteDiff);
  }
});
console.assert(
  Object.values(series).some(
    (county) =>
      Math.min(...county["margin %"]) < 0 && Math.max(...county["margin %"]) > 0
  ),
  "Some county should flip party between 2000 and 2020"
);

const svgMarkup = document.querySelector("svg#extrude-svg-path").outerHTML;
const svgData = new SVGLoader().parse(svgMarkup);
console.assert(
  svgData.paths.filter((path) => series[path.userData.node.id]).length > 3000,
  "SVG path ids should be fips codes that match the CSV"
);

// One geometry per county (islands merged), extruded to depth 1 so the instance's z scale is its height
const flat = new Array(yearCount).fill(0);
const counties = svgData.paths
  .map((path) => ({
    fips: path.userData.node.id, // kept as a string ("04015")
    series: series[path.userData.node.id] ?? {},
    shapes: path.toShapes(),
  }))
  .filter((county) => county.shapes.length)
  .map((county) => ({
    ...county,
    geometry: mergeGeometries(
      county.shapes.map(
        (shape) =>
          new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false })
      )
    ),
  }));

// 256x2 lookup: row 0 Democratic, row 1 Republican, u = altitude
const rampWidth = 256;
const rampData = new Uint8Array(rampWidth * 2 * 4);
const ramps = [democraticColors, republicanColors].map((colors) =>
  d3.interpolateRgbBasis(colors)
);
ramps.forEach((interpolator, row) => {
  for (let x = 0; x < rampWidth; x++) {
    const { r, g, b } = d3.rgb(interpolator(x / (rampWidth - 1)));
    rampData.set([r, g, b, 255], (row * rampWidth + x) * 4);
  }
});
const rampTexture = new THREE.DataTexture(rampData, rampWidth, 2);
rampTexture.colorSpace = THREE.SRGBColorSpace;
rampTexture.minFilter = rampTexture.magFilter = THREE.LinearFilter;
rampTexture.needsUpdate = true;

const rampUniforms = {
  ramp: { value: rampTexture },
  maxHeight: { value: params.maxHeight },
  colorGamma: { value: params.colorGamma },
  noDataColor: { value: new THREE.Color("#3b4149") }, // Alaska reports by district, not by county
};
const material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
material.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, rampUniforms);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying float vHeight;")
    .replace(
      "#include <project_vertex>",
      "#include <project_vertex>\nvHeight = (batchingMatrix * vec4(transformed, 1.0)).z;"
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      /* glsl */ `#include <common>
      varying float vHeight;
      uniform sampler2D ramp;
      uniform float maxHeight;
      uniform float colorGamma;
      uniform vec3 noDataColor;`
    )
    .replace(
      "#include <color_fragment>",
      /* glsl */ `
      // Colour is a function of altitude, not of the county: every column climbs the same ramp,
      // so its walls show the gradient and its roof shows how far it got.
      // vColor.r is the party (0 Democratic, 1 Republican) and picks the ramp row, vColor.g is 0 without data
      float rampU = pow(clamp(vHeight / maxHeight, 0.0, 1.0), colorGamma);
      vec3 rampColor = texture2D(ramp, vec2(rampU, mix(0.25, 0.75, vColor.r))).rgb;
      diffuseColor.rgb = mix(noDataColor, rampColor, vColor.g);`
    );
};

const map = new THREE.BatchedMesh(
  counties.length,
  d3.sum(counties, (county) => county.geometry.attributes.position.count),
  0,
  material
);
map.castShadow = true;
map.receiveShadow = true;
// The whole map is always on screen, per-county culling and sorting would only cost CPU
map.perObjectFrustumCulled = false;
map.sortObjects = false;
counties.forEach((county) => {
  county.id = map.addInstance(map.addGeometry(county.geometry));
});

const svgGroup = new THREE.Group();
svgGroup.add(map);
svgGroup.scale.y *= -1;
const svgGroupBB = new THREE.Box3().setFromObject(svgGroup);
const center = svgGroupBB.getCenter(new THREE.Vector3());
svgGroup.position.set(-center.x, -center.y, 0);

// Polls close east to west, so that is the way a change sweeps across the map;
// the jitter keeps neighbours from moving in lockstep
const mapWidth = svgGroupBB.max.x - svgGroupBB.min.x;
counties.forEach((county) => {
  county.geometry.computeBoundingBox();
  const centroid = county.geometry.boundingBox.getCenter(new THREE.Vector3());
  const east = (centroid.x - svgGroupBB.min.x) / mapWidth;
  county.delay = 0.75 * (1 - east) + 0.25 * Math.random();
  county.phase = centroid.x * 0.03 + centroid.y * 0.02;
});

const _matrix = new THREE.Matrix4();
const _color = new THREE.Color();
function updateCounties(seconds) {
  const from = Math.floor(state.time) % yearCount;
  const to = (from + 1) % yearCount; // 2020 wraps back to 2000 so the loop never cuts
  const progress = state.time - Math.floor(state.time);
  counties.forEach((county) => {
    const heights = county.series[params.height] ?? flat;
    const eased = THREE.MathUtils.smoothstep(
      (progress - county.delay * params.stagger) / (1 - params.stagger),
      0,
      1
    );
    const signed = THREE.MathUtils.lerp(heights[from], heights[to], eased);
    const breath = 1 + params.breath * Math.sin(seconds * 1.6 + county.phase);
    county.height =
      params.minHeight +
      params.maxHeight * Math.abs(signed) ** params.heightExponent * breath;
    map.setMatrixAt(county.id, _matrix.makeScale(1, 1, county.height));
    map.setColorAt(
      county.id,
      _color.setRGB(signed < 0 ? 1 : 0, heights === flat ? 0 : 1, 1)
    );
  });
}
updateCounties(0);

const scene = new THREE.Scene();
scene.background = new THREE.Color(groundColor);
scene.fog = new THREE.Fog(groundColor, 1200, 3200);
scene.add(svgGroup);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(8000, 8000),
  new THREE.MeshStandardMaterial({ color: groundColor, roughness: 1 })
);
ground.receiveShadow = true;
scene.add(ground);

// Caption painted on the ground, like the date in the reference video
const captionCanvas = Object.assign(document.createElement("canvas"), {
  width: 1024,
  height: 400,
});
const captionTexture = new THREE.CanvasTexture(captionCanvas);
captionTexture.anisotropy = 8;
const caption = new THREE.Mesh(
  new THREE.PlaneGeometry(240, 94),
  new THREE.MeshBasicMaterial({ map: captionTexture, transparent: true })
);
caption.position.set(150, -245, 0.2);
scene.add(caption);
function drawCaption(year) {
  const ctx = captionCanvas.getContext("2d");
  ctx.clearRect(0, 0, captionCanvas.width, captionCanvas.height);
  ctx.fillStyle = "#e8eaee";
  ctx.textAlign = "center";
  ctx.font = "600 72px Inter, system-ui, sans-serif";
  ctx.fillText("Presidential margin", 512, 80);
  ctx.font = "700 170px Inter, system-ui, sans-serif";
  ctx.fillText(year, 512, 240);
  // Legend: both ramps back to back, biggest margins at the ends
  for (let x = 0; x < 640; x++) {
    ctx.fillStyle = ramps[x < 320 ? 0 : 1](Math.abs(x - 320) / 320);
    ctx.fillRect(192 + x, 290, 1, 30);
  }
  ctx.fillStyle = "#e8eaee";
  ctx.font = "500 40px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Democratic", 192, 368);
  ctx.textAlign = "right";
  ctx.fillText("Republican", 832, 368);
  captionTexture.needsUpdate = true;
}
drawCaption(params.year);

const camera = new THREE.PerspectiveCamera(
  30,
  window.innerWidth / window.innerHeight,
  10,
  6000
);
camera.up.set(0, 0, 1); // the map lies in the XY plane
camera.position.set(-60, -660, 520);

const canvas = document.querySelector("#threejs");
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// No tone mapping on purpose: the lights are balanced so roofs land at ~1x the ramp colour.
// Neutral crushes the dark floor towards blue, AgX washes the palette out
renderer.shadowMap.enabled = true;

const controls = new MapControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 150;
controls.maxDistance = 2000;
controls.maxPolarAngle = Math.PI / 2 - 0.15;
controls.target.set(0, -20, 0);

/*
Lighting
*/
// Soft fill: sky from above, a little bounce from the dark floor
const fillLight = new THREE.HemisphereLight("#dfe6ff", "#3a3440", 1.2);
fillLight.position.set(0, 0, 1);
scene.add(fillLight);

// Shadowless light from the camera's side, so the walls facing us sit between the lit and the dark ones
const frontLight = new THREE.DirectionalLight("#e6ecff", 1.0);
frontLight.position.set(-200, -600, 300);
scene.add(frontLight);

// Key light from the north-west, high enough that towers throw short shadows
const keyLight = new THREE.DirectionalLight("#fff4e6", 2.4);
keyLight.position.set(-380, 260, 620);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(4096, 4096);
keyLight.shadow.radius = 10;
keyLight.shadow.bias = -0.0003;
keyLight.shadow.normalBias = 0.6;
Object.assign(keyLight.shadow.camera, {
  left: -520,
  right: 520,
  top: 420,
  bottom: -420,
  near: 100,
  far: 1600,
});
scene.add(keyLight);

// Postprocessing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// Contact darkening between neighbouring columns
const gtaoPass = new GTAOPass(
  scene,
  camera,
  window.innerWidth,
  window.innerHeight
);
gtaoPass.updateGtaoMaterial({
  radius: 14,
  distanceExponent: 1.4,
  thickness: 8,
  scale: 1.3,
  samples: 16,
});
composer.addPass(gtaoPass);

// Shallow focus on the orbit target: the far coast and the near floor go soft, like a tabletop model
const bokehPass = new BokehPass(scene, camera, {
  focus: 800,
  aperture: 0.000012, // tiny because the scene is hundreds of units deep
  maxblur: 0.004,
});
composer.addPass(bokehPass);

const outlinePass = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  scene,
  camera
);
// The ghost sits exactly on its county, so "hidden" and "visible" edges have to look the same
outlinePass.hiddenEdgeColor.copy(outlinePass.visibleEdgeColor);
composer.addPass(outlinePass);

const vignettePass = new ShaderPass(VignetteShader);
vignettePass.uniforms["offset"].value = 0.75;
vignettePass.uniforms["darkness"].value = 1.0;
composer.addPass(vignettePass);

composer.addPass(new OutputPass());

const effectFXAA = new ShaderPass(FXAAShader);
composer.addPass(effectFXAA);

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelRatio = renderer.getPixelRatio();
  camera.aspect = width / height;
  // 30 degrees frames the map at 16:9; narrower windows widen the lens instead of cropping the coasts
  camera.fov = THREE.MathUtils.radToDeg(
    2 *
      Math.atan(
        Math.tan(THREE.MathUtils.degToRad(15)) *
          Math.max(1, 16 / 9 / camera.aspect)
      )
  );
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
  effectFXAA.uniforms["resolution"].value.set(
    1 / (width * pixelRatio),
    1 / (height * pixelRatio)
  );
}
window.addEventListener("resize", onResize);
onResize();

// Hover: the batch can't be outlined per county, so a colourless stand-in wears the outline
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const ghost = new THREE.Mesh(
  undefined,
  new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
);
let hovered = null;
svgGroup.add(ghost);

function onPointerMove(event) {
  if (event.isPrimary === false) return;
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObject(map)[0];
  if (!hit) return;
  hovered = counties.find((county) => county.id === hit.batchId);
  ghost.geometry = hovered.geometry;
  outlinePass.selectedObjects = [ghost];
}
canvas.addEventListener("pointermove", onPointerMove);

const gui = new GUI();
gui
  .add(params, "year", yearRange)
  .listen()
  .onChange((year) => {
    params.playing = false;
    gsap.to(state, {
      time: yearRange.indexOf(year),
      duration: 1.5,
      ease: "sine.inOut",
    });
  });
gui.add(params, "playing").listen();
gui.add(params, "height", Object.keys(heightVariables));
gui.add(params, "secondsPerElection", 0.5, 10);
gui.add(params, "stagger", 0, 0.9);
gui.add(params, "breath", 0, 0.15);
gui.add(params, "maxHeight", 10, 250).onChange((value) => {
  rampUniforms.maxHeight.value = value;
});
gui.add(params, "heightExponent", 0.5, 4);
gui.add(rampUniforms.colorGamma, "value", 0.2, 2).name("colorGamma");

const lightFolder = gui.addFolder("Lights").close();
lightFolder.add(fillLight, "intensity", 0, 5).name("fill");
lightFolder.add(frontLight, "intensity", 0, 5).name("front");
lightFolder.add(keyLight, "intensity", 0, 8).name("key");
lightFolder.add(keyLight.position, "x", -800, 800);
lightFolder.add(keyLight.position, "y", -800, 800);
lightFolder.add(keyLight.position, "z", 100, 1200);
lightFolder.add(keyLight.shadow, "radius", 0, 12).name("shadow softness");
lightFolder.add(gtaoPass, "blendIntensity", 0, 2).name("ambient occlusion");
lightFolder.add(bokehPass, "enabled").name("depth of field");
lightFolder.add(vignettePass, "enabled").name("vignette");

let lastSeconds = 0;
function animate(milliseconds = 0) {
  requestAnimationFrame(animate);
  const seconds = milliseconds / 1000;
  const delta = Math.min(seconds - lastSeconds, 0.1);
  lastSeconds = seconds;

  if (params.playing) {
    state.time = (state.time + delta / params.secondsPerElection) % yearCount;
  }
  const year = yearRange[Math.round(state.time) % yearCount];
  if (year !== params.year && params.playing) {
    params.year = year;
  }
  if (caption.userData.year !== year) {
    caption.userData.year = year;
    drawCaption(year);
  }

  updateCounties(seconds);
  if (hovered) ghost.scale.z = hovered.height;

  controls.update();
  bokehPass.uniforms["focus"].value = camera.position.distanceTo(
    controls.target
  );
  composer.render();
}

animate();
