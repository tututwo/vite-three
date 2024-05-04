import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPixelatedPass } from "three/addons/postprocessing/RenderPixelatedPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MapControls } from "three/addons/controls/MapControls.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import p5 from "p5";
import { gsap } from "gsap";
import GUI from "lil-gui";
const p5Instance = new p5();

//! ////////////////////////////////////////////////////
//! //////////////SVG Path //////////////////////////
//! ////////////////////////////////////////////////////
const svgMarkup = document.querySelector("svg#extrude-svg-path").outerHTML;

const svgLoader = new SVGLoader();
const svgData = svgLoader.parse(svgMarkup);
const svgGroup = new THREE.Group();
// const material = new THREE.MeshNormalMaterial();
const pixelationVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const pixelationFragmentShader = `
uniform float pixelSize;
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main(){
  vec2 dxy = pixelSize / vec2(textureSize(tDiffuse, 0));
  vec2 coord = dxy * floor(vUv / dxy);
  gl_FragColor = texture(tDiffuse, coord);
}
`;
const pixelationShader = {
  uniforms: {
    tDiffuse: { value: null },
    pixelSize: { value: 1.0 },
  },
  vertexShader: pixelationVertexShader,
  fragmentShader: pixelationFragmentShader,
};
const pixelationPass = new ShaderPass(pixelationShader);
pixelationPass.uniforms.pixelSize.value = 8;

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
      float mixFactor = (vHeight + 20.0) / 50.0;
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

svgData.paths.forEach((path, i) => {
  const shapes = path.toShapes(true);
  shapes.forEach((shape, j) => {
    let depth = Math.random() * 40 - 10;
    depth = Math.max(depth, 1);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: depth,
      bevelEnabled: false,
    });
    geometry.computeVertexNormals();
    // geometry.center();
    const mesh = new THREE.Mesh(geometry, material);

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
console.log(center);
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

/* Post Processing */
// Assuming renderer, scene, and camera are already defined
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// Add the pixelation pass
composer.addPass(pixelationPass);
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
  .add(pixelationPass.uniforms.pixelSize, "value", 1, 20, 1)
  .name("Pixel Size");
const renderLoop = () => {
  window.requestAnimationFrame(renderLoop);
  controls.update();
  // renderer.render(scene, camera);
  composer.render();
};
renderLoop();
