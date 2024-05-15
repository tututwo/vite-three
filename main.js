import data from "./src/JustWinningParty.csv";
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import GUI from 'lil-gui';
import * as d3 from 'd3';
import { gsap } from 'gsap';

data.forEach((d) => {
  d["county_fips"] = +d["county_fips"];
  d["candidatevotes"] = +d["candidatevotes"];
});

const depthScale = d3.scaleSymlog().domain([0, 10 ** 6]).constant(10 ** 4).range([0, 70]);

let groupedData = d3.groups(data, (d) => d.year);
let dataset = groupedData[0][1]; // Initial dataset (2000)

const svgMarkup = document.querySelector('svg#extrude-svg-path').outerHTML;
const svgLoader = new SVGLoader();
const svgData = svgLoader.parse(svgMarkup);
const svgGroup = new THREE.Group();

const material = new CustomShaderMaterial({
  baseMaterial: THREE.MeshPhysicalMaterial,
  vertexShader: /* glsl */ `
    attribute float partyAffiliation;
    varying float vHeight;
    varying float vPartyAffiliation;
    uniform float depth;

    void main() {
      vec3 pos = position;
      pos.z *= depth; // Scale z-coordinate
      vHeight = pos.z; // Use scaled z-coordinate
      vPartyAffiliation = partyAffiliation; // Pass party affiliation to fragment shader
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vHeight;
    varying float vPartyAffiliation;
    uniform vec3 color1;
    uniform vec3 color2;

    vec3 republicanColor2 = vec3(245.0/255.0, 254.0/255.0, 142.0/255.0);
    vec3 republicanColor1 = vec3(169.0/255.0, 100.0/255.0, 128.0/255.0);

    void main() {
      vec3 finalColor;
      if (vPartyAffiliation > 0.5) {
        float mixFactor = vHeight / 50.0;
        finalColor = mix(republicanColor1, republicanColor2, mixFactor);
      } else {
        float mixFactor = vHeight / 50.0;
        finalColor = mix(color1, color2, mixFactor);
      }
      csm_DiffuseColor = vec4(finalColor, 1.0);
    }
  `,
  uniforms: {
    depth: { value: 1.2 }, // Initial depth scale
    color1: { value: new THREE.Color(74 / 255, 105 / 255, 241 / 255) },
    color2: { value: new THREE.Color(128 / 255, 255 / 255, 244 / 255) },
  },
  wireframe: false,
});

function createExtrudeGeometry() {
  svgData.paths.forEach((path, i) => {
    let scaledDepth = 0;
    const pathData = dataset.find((d) => +d["county_fips"] === +path.userData.node.id);

    if (pathData === undefined) {
      scaledDepth = 0;
    } else {
      scaledDepth = Math.max(depthScale(+pathData["candidatevotes"]), 0.1);
    }

    const shapes = path.toShapes(true);

    shapes.forEach((shape, j) => {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: scaledDepth,
        steps: Math.floor(scaledDepth / 10),
      });

      const partyAffiliation = pathData?.party === "REPUBLICAN" ? 1 : 0;

      const partyAffiliationArray = new Float32Array(geometry.attributes.position.count);
      partyAffiliationArray.fill(partyAffiliation);

      geometry.setAttribute('partyAffiliation', new THREE.BufferAttribute(partyAffiliationArray, 1));

      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.id = +path.userData.node.id;
      mesh.userData.party = pathData?.party || 'NO_PARTY';
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

const canvas = document.querySelector('#threejs');
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

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedObjects = [];

const ambientLight = new THREE.AmbientLight(0xffffff, 2.7);
scene.add(ambientLight);

const directionalLight1 = new THREE.DirectionalLight(0xffffff, 3.2);
directionalLight1.position.set(200, 400, 300);
directionalLight1.castShadow = true;
scene.add(directionalLight1);

const directionalLight2 = new THREE.DirectionalLight(0xffffff, 1.8);
directionalLight2.position.set(-200, -400, -300);
scene.add(directionalLight2);

const directionalLightHelper1 = new THREE.DirectionalLightHelper(directionalLight1, 10);
scene.add(directionalLightHelper1);

const directionalLightHelper2 = new THREE.DirectionalLightHelper(directionalLight2, 10);
scene.add(directionalLightHelper2);

// Postprocessing
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const outlinePass = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera);
composer.addPass(outlinePass);

const effectFXAA = new ShaderPass(FXAAShader);
effectFXAA.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight);
composer.addPass(effectFXAA);

window.addEventListener('resize', onWindowResize);
canvas.addEventListener('pointermove', onPointerMove);

const gui = new GUI();
const params = {
  edgeStrength: 3.0,
  edgeGlow: 0.0,
  edgeThickness: 1.0,
  pulsePeriod: 0,
  rotate: false,
  usePatternTexture: false,
  year: 2000,
};

gui.add(params, 'edgeStrength', 0.01, 10).onChange((value) => {
  outlinePass.edgeStrength = Number(value);
});
gui.add(params, 'edgeGlow', 0.0, 1).onChange((value) => {
  outlinePass.edgeGlow = Number(value);
});
gui.add(params, 'edgeThickness', 1, 4).onChange((value) => {
  outlinePass.edgeThickness = Number(value);
});
gui.add(params, 'pulsePeriod', 0.0, 5).onChange((value) => {
  outlinePass.pulsePeriod = Number(value);
});
gui.add(params, 'rotate');
gui.add(params, 'usePatternTexture').onChange((value) => {
  outlinePass.usePatternTexture = value;
});

function Configuration() {
  this.visibleEdgeColor = '#ffffff';
  this.hiddenEdgeColor = '#190a05';
}

const conf = new Configuration();
gui.addColor(conf, 'visibleEdgeColor').onChange((value) => {
  outlinePass.visibleEdgeColor.set(value);
});
gui.addColor(conf, 'hiddenEdgeColor').onChange((value) => {
  outlinePass.hiddenEdgeColor.set(value);
});

const yearOptions = [2000, 2004, 2008, 2012, 2016, 2020];
gui.add(params, 'year', yearOptions).onChange((value) => {
  dataset = groupedData.find((d) => +d[0] === value)[1];
  updateGeometry();
});

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

function onWindowResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
  effectFXAA.uniforms['resolution'].value.set(1 / window.innerWidth, 1 / window.innerHeight);
}

function updateGeometry() {
  svgGroup.children.forEach((mesh) => {
    const pathData = dataset.find((d) => +d['county_fips'] === +mesh.userData.id);
    const newDepth = pathData ? depthScale(+pathData['candidatevotes']) : 0;
    gsap.to(mesh.geometry.parameters.options, {
      depth: Math.max(newDepth, 0.1),
      duration: 1,
      ease: 'power1.inOut',
      onUpdate: () => {
        const shape = mesh.geometry.parameters.shapes;
        const options = mesh.geometry.parameters.options;
        mesh.geometry.dispose();
        mesh.geometry = new THREE.ExtrudeGeometry(shape, options);
        mesh.geometry.verticesNeedUpdate = true;
        mesh.geometry.computeVertexNormals();
      },
    });
  });
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  composer.render();
}

animate();
