import * as THREE from 'three';
import { rgb } from 'd3';
import { flatHeights, getCountyHeight, interpolateSeries, ramps } from './electionData.js';

export function createCountyMap(svgData, settings, series) {
  const counties = svgData.paths.flatMap((path) => {
    const shapes = path.toShapes();
    if (!shapes.length) return [];
    const fips = path.userData.node.id;
    return [{
      fips,
      series: series[fips] ?? {},
      geometry: new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false }),
    }];
  });

  const rampWidth = 256;
  const rampData = new Uint8Array(rampWidth * 2 * 4);
  ramps.forEach((interpolator, row) => {
    for (let x = 0; x < rampWidth; x++) {
      const { r, g, b } = rgb(interpolator(x / (rampWidth - 1)));
      rampData.set([r, g, b, 255], (row * rampWidth + x) * 4);
    }
  });
  const rampTexture = new THREE.DataTexture(rampData, rampWidth, 2);
  rampTexture.colorSpace = THREE.SRGBColorSpace;
  rampTexture.minFilter = rampTexture.magFilter = THREE.LinearFilter;
  rampTexture.needsUpdate = true;

  const uniforms = {
    ramp: { value: rampTexture },
    maxHeight: { value: settings.maxHeight },
    colorGamma: { value: settings.colorGamma },
    noDataColor: { value: new THREE.Color('#3b4149') },
  };
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  material.customProgramCacheKey = () => 'county-altitude-ramp-v1';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHeight;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvHeight = (batchingMatrix * vec4(transformed, 1.0)).z;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying float vHeight;
        uniform sampler2D ramp;
        uniform float maxHeight;
        uniform float colorGamma;
        uniform vec3 noDataColor;`)
      .replace('#include <color_fragment>', /* glsl */ `
        // Batched colors encode party in red and how much of the county has voted yet in green.
        float rampU = pow(clamp(vHeight / maxHeight, 0.0, 1.0), colorGamma);
        vec3 rampColor = texture2D(ramp, vec2(rampU, mix(0.25, 0.75, vColor.r))).rgb;
        diffuseColor.rgb = mix(noDataColor, rampColor, vColor.g);`);
  };

  const mesh = new THREE.BatchedMesh(
    counties.length,
    counties.reduce((sum, county) => sum + county.geometry.attributes.position.count, 0),
    0,
    material
  );
  mesh.name = 'election-counties';
  mesh.castShadow = mesh.receiveShadow = true;
  // Heights change every frame; a fixed batch bound must not clip growing columns.
  mesh.frustumCulled = false;
  mesh.perObjectFrustumCulled = false;
  mesh.sortObjects = false;
  const bounds = new THREE.Box3();
  for (const county of counties) {
    county.id = mesh.addInstance(mesh.addGeometry(county.geometry));
    county.geometry.computeBoundingBox();
    bounds.union(county.geometry.boundingBox);
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const width = bounds.max.x - bounds.min.x || 1;
  const centroid = new THREE.Vector3();
  for (const county of counties) {
    county.geometry.boundingBox.getCenter(centroid);
    const east = (centroid.x - bounds.min.x) / width;
    const jitter = ((Number(county.fips) * 2654435761) >>> 0) / 4294967296;
    county.delay = 0.75 * (1 - east) + 0.25 * jitter;
    county.phase = centroid.x * 0.03 + centroid.y * 0.02;
  }

  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  function update(time, seconds, currentSettings) {
    uniforms.maxHeight.value = currentSettings.maxHeight;
    uniforms.colorGamma.value = currentSettings.colorGamma;
    for (const county of counties) {
      const heights = county.series[currentSettings.height] ?? flatHeights;
      const signed = interpolateSeries(heights, time, county.delay, currentSettings.stagger);
      // Fades a county in from the no-data grey as it casts its first votes (statehood, new counties).
      const voted = interpolateSeries(county.series.voted ?? flatHeights, time, county.delay, currentSettings.stagger);
      county.height = getCountyHeight(signed, seconds, county.phase, currentSettings);
      mesh.setMatrixAt(county.id, matrix.makeScale(1, 1, county.height));
      mesh.setColorAt(county.id, color.setRGB(signed < 0 ? 1 : 0, voted, 1));
    }
  }
  update(0, 0, settings);

  return {
    mesh,
    counties,
    // The scene's enclosing group flips the SVG's downward Y axis.
    position: [-center.x, center.y, 0],
    uniforms,
    update,
    dispose() {
      mesh.dispose();
      material.dispose();
      rampTexture.dispose();
      for (const county of counties) county.geometry.dispose();
    },
  };
}
