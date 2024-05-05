import data from "./src/JustWinningParty.csv";
import * as THREE from "three";

import { MapControls } from "three/addons/controls/MapControls.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";

import { gsap } from "gsap";
import * as d3 from "d3";
import GUI from "lil-gui";

data.forEach((d) => {
  d["county_fips"] = +d["county_fips"];
  d["candidatevotes"] = +d["candidatevotes"];
});

const depthScale = d3
  .scaleLog()
  .domain([1, d3.max(data, (d) => d["candidatevotes"])])
  .range([0, 45])
  .base(10);

let groupedData = d3.groups(data, (d) => d.year);
// year 2000
let dataset = groupedData[0][1];
let dataset_2004 = groupedData[1][1];
//! ////////////////////////////////////////////////////
//! //////////////SVG Path //////////////////////////
//! ////////////////////////////////////////////////////
const svgMarkup = document.querySelector("svg#extrude-svg-path").outerHTML;

const svgLoader = new SVGLoader();
const svgData = svgLoader.parse(svgMarkup);
const svgGroup = new THREE.Group();
// const material = new THREE.MeshNormalMaterial();
const material = new THREE.ShaderMaterial({
  vertexShader: `
    varying float vHeight;
    uniform float depth;
    void main() {
      vec3 pos = position;
      pos.z *= depth; // Apply depth scaling to z-coordinate
      vHeight = pos.z; // Use scaled z-coordinate
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: `
    varying float vHeight;
    void main() {
      vec3 color1 = vec3(0.0, 0.0, 1.0);
      vec3 color2 = vec3(0.0, 1.0, 0.8);
      float mixFactor = (vHeight + 10.0) / 50.0;
      gl_FragColor = vec4(mix(color1, color2, mixFactor), 1.0);
    }
  `,
  uniforms: {
    depth: { value: 1.0 }, // Initial depth scale
  },
});

// gsap.to(material.uniforms.depth, {
//   value: p5Instance.noise(10)*4, // Target depth scale
//   duration: 3,
//   repeat: -1, // Repeat indefinitely
//   yoyo: true, // Go back and forth
//   ease: "power1.inOut"
// });

//todo: find path with the same county_fip code, and depthScale it
svgData.paths.forEach((path, i) => {
  let scaledDepth = 0;
  const pathData = dataset.find(
    (d) => +d["county_fips"] === +path.userData.node.id
  );

  if (pathData === undefined) {
    scaledDepth = 0;
  } else {
    scaledDepth = Math.max(depthScale(+pathData["candidatevotes"]), 0.1);
  }
  const shapes = path.toShapes(true);

  shapes.forEach((shape, j) => {
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: scaledDepth,
      bevelEnabled: false,
    });

    // geometry.center();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.id = +path.userData.node.id;
    // const pathBB = new THREE.Box3(new THREE.Vector3(),new THREE.Vector3()).setFromObject(mesh); // min and max
    // console.log(pathBB);
    // const bb = geometry.computeBoundingSphere();
    // console.log(bb);
    svgGroup.add(mesh);
  });
});
svgGroup.scale.y *= -1;

const svgGroupBB = new THREE.Box3().setFromObject(svgGroup); // min and max
const center = svgGroupBB.getCenter(new THREE.Vector3());

svgGroup.position.x = -center.x;
svgGroup.position.y = -center.y;
svgGroup.position.z = -center.z;

const scene = new THREE.Scene();

// scene.add(cubeMesh);
scene.add(svgGroup);

/*
 * Camera
 */
const cameraSpecs = {
  fov: 105,
  near: 0.01,
  far: 1000,
};
// const camera = new THREE.PerspectiveCamera(
//   cameraSpecs.fov,
//   window.innerWidth / window.innerHeight,
//   cameraSpecs.near,
//   cameraSpecs.far
// );
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
const helper = new THREE.CameraHelper(camera);
scene.add(helper);
// camera.lookAt(svgGroup.position);

const canvas = document.querySelector("#threejs");
const renderer = new THREE.WebGLRenderer({ canvas });

/*Controls */
// const controls = new OrbitControls(camera, canvas);
const controls = new MapControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

controls.screenSpacePanning = false;

controls.minDistance = 100;
controls.maxDistance = 500;

controls.maxPolarAngle = Math.PI;
// controls.autoRotate = true;
//
renderer.setSize(window.innerWidth, window.innerHeight);
const axesHelper = new THREE.AxesHelper(350);
scene.add(axesHelper);

function animateToNewData(year) {

  const newData = groupedData.find((d) => +d[0] === year)?.[1];

  if (!newData) return;

  svgData.paths.forEach((path) => {

    const currentMesh = svgGroup.children.find(
      (mesh) => +mesh.userData.id === +path.userData.node.id
    );

    if (currentMesh) {
      const newDataForPath = newData.find(
        (d) => +d.county_fips === +path.userData.node.id
      );
      const newDepth = newDataForPath
        ? depthScale(newDataForPath.candidatevotes)
        : 0;
      
      gsap.to(currentMesh.geometry.parameters.options, {
        depth: Math.max(newDepth, .1),
        duration: 3,
        ease: "power1.inOut",
        onUpdate: () => updateGeometry(currentMesh),
      });
    }
  });
}
function updateGeometry(mesh) {
  const shape = mesh.geometry.parameters.shapes;
  const options = mesh.geometry.parameters.options;
  mesh.geometry.dispose(); // Dispose of the current geometry
  mesh.geometry = new THREE.ExtrudeGeometry(shape, options);
  mesh.geometry.verticesNeedUpdate = true;
  mesh.geometry.computeVertexNormals();
}

/**
 * Debug
 */
const gui = new GUI();
gui.add(camera.position, "x", -300, 1300, 10);
gui.add(camera.position, "y", -300, 300, 10);
gui.add(camera.position, "z", -300, 600, 5);
// camera specs
// gui.add(camera, "fov", 1, 120).onChange(() => camera.updateProjectionMatrix());
gui
  .add(camera, "near", 0.1, 100)
  .onChange(() => camera.updateProjectionMatrix());
gui
  .add(camera, "far", 200, 1000)
  .onChange(() => camera.updateProjectionMatrix());
gui
  .add({ year: 2000 }, "year", 2000, 2020, 4)
  .onChange((value) => animateToNewData(value));

const renderLoop = () => {
  window.requestAnimationFrame(renderLoop);
  controls.update();
  renderer.render(scene, camera);
};
renderLoop();
