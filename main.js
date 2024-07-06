import data from "./src/princetonData.csv";
import * as THREE from "three";
// import { DirectionalLightHelper } from "three/examples/jsm/helpers/DirectionalLightHelper.js";
import CustomShaderMaterial from "three-custom-shader-material/vanilla";
import { MapControls } from "three/addons/controls/MapControls.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import GUI from "lil-gui";
import * as d3 from "d3";
import { gsap } from "gsap";

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedObjects = [];

const depthVariable = "winningPercentage"; //
const countyId = "fips";
const colroVariable = "winningParty";
data.forEach((d) => {
  // d["depthVariable"] = +d["depthVariable"];
  d["year"] = +d["election_year"];
  d[depthVariable] = +d[depthVariable];
});
const depthScale = d3
  .scaleLinear()
  .domain([0, 0.25, 0.5, 1])
  .range([0, 25, 40, 50]);
// const depthScale = d3
//   .scaleSymlog()
//   .domain([10, 10 ** 6])
//   .constant(10 ** 4)
//   .range([0, 100]);

let groupedData = d3.groups(data, (d) => d.year);

let currentYear = 2000;
const yearRange = [2000, 2004, 2008, 2012, 2016, 2020];
const countyData = {}; // Object to store data for all counties and years
groupedData.forEach(([year, yearData]) => {
  yearData.forEach((county) => {
    if (!countyData[county[countyId]]) {
      countyData[county[countyId]] = {};
    }
    countyData[county[countyId]][year] = {
      height: Math.max(depthScale(+county[depthVariable]), 0.1),
      party: county[colroVariable],
    };
  });
});
const textureWidth = 3114; // Assuming there are 3141 counties
const textureHeight = yearRange.length;

const textureData = new Float32Array(textureWidth * textureHeight * 2);

yearRange.forEach((year, yearIndex) => {
  Object.keys(countyData).forEach((fips, fipsIndex) => {
    const index = (yearIndex * textureWidth + fipsIndex) * 2;
    textureData[index] = countyData[fips][year]?.height || 0;
    textureData[index + 1] =
      countyData[fips][year]?.party === "Republican" ? 1 : 0;
  });
});

const heightPartyTexture = new THREE.DataTexture(
  textureData,
  textureWidth,
  textureHeight,
  THREE.RGFormat,
  THREE.FloatType
);
heightPartyTexture.needsUpdate = true;
const material = new CustomShaderMaterial({
  baseMaterial: THREE.MeshPhysicalMaterial,
  vertexShader: /* glsl */ `
    uniform sampler2D heightPartyData;
    uniform float currentYearIndex;
    uniform float nextYearIndex;
    uniform float transitionFactor;
    uniform vec2 textureSize;
    uniform float heightScale;

    attribute float countyIndex;

    varying float vHeight;
    varying float vParty;
    varying float vCurrentParty;
    varying float vNextParty;
    varying float vTransitionFactor;
    void main() {
      vec2 currentUV = vec2((countyIndex + 0.5) / textureSize.x, (currentYearIndex + 0.5) / textureSize.y);
      vec2 nextUV = vec2((countyIndex + 0.5) / textureSize.x, (nextYearIndex + 0.5) / textureSize.y);

      vec2 currentData = texture2D(heightPartyData, currentUV).rg;
      vec2 nextData = texture2D(heightPartyData, nextUV).rg;

      float currentHeight = currentData.r;
      float nextHeight = nextData.r;
      float finalHeight = mix(currentHeight, nextHeight, transitionFactor);

      float currentParty = currentData.g;
      float nextParty = nextData.g;
      float finalParty = mix(currentParty, nextParty, transitionFactor);
      vCurrentParty = currentData.g;
      vNextParty = nextData.g;
      vTransitionFactor = transitionFactor;
      vec3 newPosition = position;
      newPosition.z *= finalHeight * heightScale;
      vHeight = finalHeight;
      vParty = finalParty;
      
      csm_Position = newPosition;
    }
  `,
  fragmentShader: /* glsl */ `
  varying float vHeight;
  varying float vCurrentParty;
  varying float vNextParty;
  varying float vTransitionFactor;
  
  uniform vec3 republicanColor1;
  uniform vec3 republicanColor2;
  uniform vec3 democraticColor1;
  uniform vec3 democraticColor2;
  
  void main() {
    // Calculate colors for both parties
    vec3 republicanColor = mix(republicanColor1, republicanColor2, vHeight / 30.0);
    vec3 democraticColor = mix(democraticColor1, democraticColor2, vHeight / 30.0);
    
    // Interpolate between current and next party colors
    vec3 currentColor = mix(democraticColor, republicanColor, vCurrentParty);
    vec3 nextColor = mix(democraticColor, republicanColor, vNextParty);
    
    // Transition between current and next colors
    vec3 finalColor = mix(currentColor, nextColor, vTransitionFactor);
    
    csm_DiffuseColor = vec4(finalColor, 1.0);
    csm_Metalness = 0.7;
    csm_Roughness = 0.2;
  }
  `,
  uniforms: {
    heightPartyData: { value: heightPartyTexture },
    currentYearIndex: { value: 0 },
    nextYearIndex: { value: 0 },
    transitionFactor: { value: 0.0 },
    textureSize: { value: new THREE.Vector2(textureWidth, textureHeight) },
    heightScale: { value: 1.0 },
    republicanColor1: { value: new THREE.Color(0.7, 0.1, 0.2) },
    republicanColor2: { value: new THREE.Color(1.0, 0.3, 0.3) },
    democraticColor1: { value: new THREE.Color(0.1, 0.3, 0.7) },
    democraticColor2: { value: new THREE.Color(0.3, 0.6, 1.0) },
  },
  // Add MeshPhysicalMaterial properties
  clearcoat: 0.3,
  clearcoatRoughness: 0.25,
  envMapIntensity: 1.5,
});
material.uniforms.currentYearIndex.value = yearRange.indexOf(currentYear);
material.uniforms.nextYearIndex.value = yearRange.indexOf(currentYear);
const svgMarkup = document.querySelector("svg#extrude-svg-path").outerHTML;
const svgLoader = new SVGLoader();
const svgData = svgLoader.parse(svgMarkup);
const svgGroup = new THREE.Group();

const geometry = new THREE.BufferGeometry();
// ... other attributes ...
function createExtrudeGeometry() {
  svgData.paths.forEach((path, i) => {
    const shapes = path.toShapes(true);
    shapes.forEach((shape, j) => {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 1,
        bevelEnabled: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.id = +path.userData.node.id;
      svgGroup.add(mesh);
    });
  });
}

createExtrudeGeometry();
// Create an attribute for each year
function createOrUpdateGeometry(mesh, countyIndex) {
  const geometry = mesh.geometry;
  const countyIndexArray = new Float32Array(geometry.attributes.position.count);
  countyIndexArray.fill(countyIndex);
  geometry.setAttribute(
    "countyIndex",
    new THREE.BufferAttribute(countyIndexArray, 1)
  );
}

// Call this for each mesh when creating or updating
svgGroup.children.forEach((mesh, index) => {
  createOrUpdateGeometry(mesh, index);
});

svgGroup.scale.y *= -1;

const svgGroupBB = new THREE.Box3().setFromObject(svgGroup);
const center = svgGroupBB.getCenter(new THREE.Vector3());

svgGroup.position.x = -center.x;
svgGroup.position.y = -center.y;
svgGroup.position.z = -center.z;

const scene = new THREE.Scene();

svgGroup.castShadow = true;
svgGroup.receiveShadow = false;
scene.add(svgGroup);

const cameraSpecs = {
  fov: 105,
  near: 0.01,
  far: 1000,
};

const camera = new THREE.OrthographicCamera(
  window.innerWidth / -2,
  window.innerWidth / 2,
  window.innerHeight / 2,
  window.innerHeight / -2,
  cameraSpecs.near,
  cameraSpecs.far
);
camera.zoom = 1.9;
camera.position.z = 250;
camera.position.y = -150;

const canvas = document.querySelector("#threejs");
const renderer = new THREE.WebGLRenderer({ canvas });

const controls = new MapControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.screenSpacePanning = false;
controls.minDistance = 100;
controls.maxDistance = 500;
controls.maxPolarAngle = Math.PI;

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

/*
Lighting
*/
// Ambient light
// Ambient light
const ambientLight = new THREE.AmbientLight(0xffffff, 5);
scene.add(ambientLight);

// Custom helper for ambient light (a small sphere)
const ambientLightHelper = new THREE.Mesh(
  new THREE.SphereGeometry(5, 8, 8),
  new THREE.MeshBasicMaterial({ color: ambientLight.color })
);
ambientLightHelper.position.set(0, 100, 0); // Position it above the scene
scene.add(ambientLightHelper);

// Directional light (main light)
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(-1, 1, 20);
scene.add(directionalLight);

const directionalLightHelper = new THREE.DirectionalLightHelper(
  directionalLight,
  50
);
scene.add(directionalLightHelper);

// Soft light from the back
const backLight = new THREE.DirectionalLight(0x8888ff, 15);
backLight.position.set(-282, -181, 350);
scene.add(backLight);

const backLightHelper = new THREE.DirectionalLightHelper(backLight, 50);
scene.add(backLightHelper);

// Postprocessing
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
composer.addPass(renderPass);

const outlinePass = new OutlinePass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  scene,
  camera
);
composer.addPass(outlinePass);

const effectFXAA = new ShaderPass(FXAAShader);
effectFXAA.uniforms["resolution"].value.set(
  1 / window.innerWidth,
  1 / window.innerHeight
);
composer.addPass(effectFXAA);
function onPointerMove(event) {
  if (event.isPrimary === false) return;
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  checkIntersection();
}

function addSelectedObject(object) {
  selectedObjects = [];
  selectedObjects.push(object);
}

function checkIntersection() {
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(svgGroup, true);
  if (intersects.length > 0) {
    const selectedObject = intersects[0].object;
    addSelectedObject(selectedObject);
    outlinePass.selectedObjects = selectedObjects;
  }
}
canvas.addEventListener("pointermove", onPointerMove);
const gui = new GUI();
const params = {
  year: 2000,
};

const yearOptions = [2000, 2004, 2008, 2012, 2016, 2020];

function transitionToYear(newYear) {
  const currentYearIndex = yearRange.indexOf(currentYear);
  const nextYearIndex = yearRange.indexOf(newYear);

  gsap.to(material.uniforms.transitionFactor, {
    value: 1,
    duration: 1,
    onUpdate: () => {
      material.uniforms.currentYearIndex.value = currentYearIndex;
      material.uniforms.nextYearIndex.value = nextYearIndex;
    },
    onComplete: () => {
      material.uniforms.currentYearIndex.value = nextYearIndex;
      material.uniforms.nextYearIndex.value = nextYearIndex;
      material.uniforms.transitionFactor.value = 0;
      currentYear = newYear; // Update the current year
    },
  });
}

// Use this function when the year selector changes
gui.add(params, "year", yearOptions).onChange((value) => {
  transitionToYear(value);
});
// Light controls
const lightFolder = gui.addFolder("Lights");

// Ambient Light
const ambientLightFolder = lightFolder.addFolder("Ambient Light");
ambientLightFolder.addColor(ambientLight, "color").onChange(() => {
  ambientLightHelper.material.color.set(ambientLight.color);
});
ambientLightFolder.add(ambientLight, "intensity", 0, 5);

// Directional Light
const directionalLightFolder = lightFolder.addFolder("Directional Light");
directionalLightFolder.addColor(directionalLight, "color");
directionalLightFolder.add(directionalLight, "intensity", 0, 5);
directionalLightFolder.add(directionalLight.position, "x", -350, 350);
directionalLightFolder.add(directionalLight.position, "y", -350, 350);
directionalLightFolder.add(directionalLight.position, "z", -350, 350);

// Back Light
const backLightFolder = lightFolder.addFolder("Back Light");
backLightFolder.addColor(backLight, "color");
backLightFolder.add(backLight, "intensity", 0, 50);
backLightFolder.add(backLight.position, "x", -350, 350);
backLightFolder.add(backLight.position, "y", -350, 350);
backLightFolder.add(backLight.position, "z", -350, 350);
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  composer.render();
}

animate();
