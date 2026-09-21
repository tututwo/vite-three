import csv from "./src/princetonData.csv?raw";
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
const colorVariable = "winningParty";
const democraticColors = [
  "#6A6ECA",
  "#688EFB",
  "#57B3FF",
  "#4CDDF5",
  "#5EECEB",
  "#54F7DD",
];
const republicanColors = [
  "#E0708F",
  "#D07890",
  "#E38274",
  "#F0AC6E",
  "#ECDE7D",
  "#EEFF8F",
];
const democraticInterpolator = d3.interpolateRgbBasis(democraticColors);
const republicanInterpolator = d3.interpolateRgbBasis(republicanColors);
const depthScale = d3.scaleLinear().domain([0, 0.9]).range([0, 100]);

let currentYear = 2000;
const yearRange = [2000, 2004, 2008, 2012, 2016, 2020];
const countyData = {}; // fips -> year -> { height, party, color }
d3.csvParse(csv).forEach((d) => {
  const share = +d[depthVariable];
  const interpolator =
    d[colorVariable] === "Republican"
      ? republicanInterpolator
      : democraticInterpolator;
  (countyData[d[countyId]] ??= {})[+d.election_year] = {
    height: Math.max(depthScale(share), 0.1),
    party: d[colorVariable],
    color: d3.rgb(interpolator(share)),
  };
});

const svgMarkup = document.querySelector("svg#extrude-svg-path").outerHTML;
const svgLoader = new SVGLoader();
const svgData = svgLoader.parse(svgMarkup);
console.assert(
  svgData.paths.filter((path) => countyData[path.userData.node.id]).length >
    3000,
  "SVG path ids should be fips codes that match the CSV"
);

// One texel per SVG path: a county finds its data by its own path index,
// and the path id is the fips code that joins it to the CSV
const countyCount = svgData.paths.length;
const yearCount = yearRange.length;
const dataTypeCount = 2; // Height/Party and Color

const textureSideLength = Math.ceil(Math.sqrt(countyCount));
const textureDepth = yearCount * dataTypeCount;
const sliceSize = textureSideLength * textureSideLength;

const texture3DData = new Float32Array(sliceSize * textureDepth * 4);

yearRange.forEach((year, yearIndex) => {
  svgData.paths.forEach((path, countyIndex) => {
    const county = countyData[path.userData.node.id]?.[year];
    const color = county?.color ?? { r: 59, g: 65, b: 73, opacity: 1 };

    // Even slices hold height + party, odd slices hold color
    const baseIndex1 = (yearIndex * 2 * sliceSize + countyIndex) * 4;
    const baseIndex2 = baseIndex1 + sliceSize * 4;
    texture3DData[baseIndex1] = county?.height || 0;
    texture3DData[baseIndex1 + 1] = county?.party === "Republican" ? 1 : 0;
    texture3DData[baseIndex2] = color.r / 255;
    texture3DData[baseIndex2 + 1] = color.g / 255;
    texture3DData[baseIndex2 + 2] = color.b / 255;
    texture3DData[baseIndex2 + 3] = color.opacity;
  });
});

const texture3D = new THREE.Data3DTexture(
  texture3DData,
  textureSideLength,
  textureSideLength,
  textureDepth
);
texture3D.format = THREE.RGBAFormat;
texture3D.type = THREE.FloatType;
texture3D.needsUpdate = true;
const material = new CustomShaderMaterial({
  baseMaterial: THREE.MeshPhysicalMaterial,
  vertexShader: /* glsl */ `
  uniform sampler3D countyData;
uniform float currentYearIndex;
uniform float nextYearIndex;
uniform float transitionFactor;
uniform float heightScale;

attribute float countyIndex;

varying float vParty;
varying vec3 vColor;
varying float vNormalizedHeight;

void main() {
  // One texel per county, row by row. Even slices: height + party, odd slices: color
  int width = textureSize(countyData, 0).x;
  int index = int(countyIndex + 0.5);
  ivec2 texel = ivec2(index % width, index / width);
  int currentSlice = int(currentYearIndex) * 2;
  int nextSlice = int(nextYearIndex) * 2;

  vec4 currentDataHeight = texelFetch(countyData, ivec3(texel, currentSlice), 0);
  vec4 nextDataHeight = texelFetch(countyData, ivec3(texel, nextSlice), 0);
  vec4 currentDataColor = texelFetch(countyData, ivec3(texel, currentSlice + 1), 0);
  vec4 nextDataColor = texelFetch(countyData, ivec3(texel, nextSlice + 1), 0);

  float height = mix(currentDataHeight.r, nextDataHeight.r, transitionFactor);
  vParty = mix(currentDataHeight.g, nextDataHeight.g, transitionFactor);
  vColor = mix(currentDataColor.rgb, nextDataColor.rgb, transitionFactor);

  vec3 newPosition = position;
  newPosition.z *= height * heightScale;
  
  vNormalizedHeight = position.z;
  csm_Position = newPosition;
}
  `,
  fragmentShader: /* glsl */ `
    varying float vNormalizedHeight;
    varying float vParty;
    varying vec3 vColor;

    uniform vec3 republicanBaseColor;
    uniform vec3 democraticBaseColor;

    void main() {
      vec3 baseColor = mix(democraticBaseColor, republicanBaseColor, vParty);
      vec3 finalColor = mix(baseColor, vColor, vNormalizedHeight);
      
      csm_DiffuseColor = vec4(finalColor, 1.0);
      csm_Metalness = 0.5;
      csm_Roughness = 0.5;
    }
  `,
  uniforms: {
    countyData: { value: texture3D },
    currentYearIndex: { value: 0 },
    nextYearIndex: { value: 0 },
    transitionFactor: { value: 0.0 },
    heightScale: { value: 1.0 },
    republicanBaseColor: {
      value: new THREE.Color(169 / 255, 100 / 255, 128 / 255),
    },
    democraticBaseColor: {
      value: new THREE.Color(27 / 255, 44 / 255, 149 / 255),
    },
  },
  // Add MeshPhysicalMaterial properties
  clearcoat: 0.3,
  clearcoatRoughness: 0.25,
  envMapIntensity: 1.5,
});
material.uniforms.currentYearIndex.value = yearRange.indexOf(currentYear);
material.uniforms.nextYearIndex.value = yearRange.indexOf(currentYear);
const svgGroup = new THREE.Group();

// ... other attributes ...
function createExtrudeGeometry() {
  svgData.paths.forEach((path, i) => {
    const shapes = path.toShapes();
    shapes.forEach((shape, j) => {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 1,
        bevelEnabled: false,
        UVGenerator: {
          generateTopUV: function (geometry, vertices, indexA, indexB, indexC) {
            return [
              new THREE.Vector2(0, 1),
              new THREE.Vector2(0, 1),
              new THREE.Vector2(0, 1),
            ];
          },
          generateSideWallUV: function (
            geometry,
            vertices,
            indexA,
            indexB,
            indexC,
            indexD
          ) {
            return [
              new THREE.Vector2(0, vertices[indexA].y),
              new THREE.Vector2(1, vertices[indexB].y),
              new THREE.Vector2(0, vertices[indexC].y),
              new THREE.Vector2(1, vertices[indexD].y),
            ];
          },
        },
      });
      // Every mesh of a county (islands included) points at that county's texel
      const countyIndexArray = new Float32Array(
        geometry.attributes.position.count
      ).fill(i);
      geometry.setAttribute(
        "countyIndex",
        new THREE.BufferAttribute(countyIndexArray, 1)
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.id = path.userData.node.id; // fips, kept as a string ("04015")
      svgGroup.add(mesh);
    });
  });
}

createExtrudeGeometry();

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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

/*
Lighting
*/
// Ambient light
// Ambient light
const ambientLight = new THREE.AmbientLight(0xffffff, 4.8);
scene.add(ambientLight);

// Custom helper for ambient light (a small sphere)
const ambientLightHelper = new THREE.Mesh(
  new THREE.SphereGeometry(5, 8, 8),
  new THREE.MeshBasicMaterial({ color: ambientLight.color })
);
ambientLightHelper.position.set(0, 100, 0); // Position it above the scene
scene.add(ambientLightHelper);

// Directional light (main light)
const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
directionalLight.position.set(-350, 50, 350);
scene.add(directionalLight);

const directionalLightHelper = new THREE.DirectionalLightHelper(
  directionalLight,
  50
);
scene.add(directionalLightHelper);

// Soft light from the back
const backLight = new THREE.DirectionalLight("#5D6265",17);
backLight.position.set(350, 350, 65);
scene.add(backLight);

const backLightHelper = new THREE.DirectionalLightHelper(backLight, 50);
scene.add(backLightHelper);

// Postprocessing
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
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
      currentYear = newYear;
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
ambientLightFolder.add(ambientLight, "intensity", 0, 50);

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
