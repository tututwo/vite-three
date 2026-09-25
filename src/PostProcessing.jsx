import { useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MultiplyBlending } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// The vignette is three's mix towards black (offset 0.75), multiplied over the finished frame by
// one quad instead of a full-screen pass. The canvas holds sRGB values, so the linear falloff is
// raised to 1/2.2 there; inside the depth-of-field composer the frame is still linear.
const vignetteShader = {
  uniforms: { encoding: { value: 1 / 2.2 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform float encoding;
    void main() {
      vec2 offset = (vUv - 0.5) * 0.75;
      gl_FragColor = vec4(vec3(pow(1.0 - dot(offset, offset), encoding)), 1.0);
    }`,
};

export default function PostProcessing({ settings, counties }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);
  const depthOfField = useRef(null);
  const vignette = useRef(null);

  // Depth of field is the one effect that needs full-screen passes, so its composer exists only
  // while it is switched on; otherwise the scene renders straight to the canvas.
  useLayoutEffect(() => {
    if (!settings.depthOfField) return;
    const composer = new EffectComposer(gl);
    const bokeh = new BokehPass(scene, camera, {
      focus: 800,
      aperture: 0.000012,
      maxblur: 0.004,
    });
    // Bokeh measures depth with its own override material, which has to raise the columns too.
    if (counties) {
      const { onBeforeCompile, customProgramCacheKey } = counties.customDepthMaterial;
      Object.assign(bokeh._materialDepth, { onBeforeCompile, customProgramCacheKey });
    }
    const passes = [new RenderPass(scene, camera), bokeh, new OutputPass()];
    for (const pass of passes) composer.addPass(pass);
    depthOfField.current = { composer, bokeh };

    return () => {
      depthOfField.current = null;
      for (const pass of passes) pass.dispose();
      composer.dispose();
    };
  }, [gl, scene, camera, counties, settings.depthOfField]);

  useLayoutEffect(() => {
    const composer = depthOfField.current?.composer;
    if (!composer) return;
    // The canvas's own MSAA does not reach the scene drawn into the composer, so the composer
    // multisamples below 2x pixel ratio, like the canvas. A new ratio resizes (and so reallocates) the targets.
    composer.renderTarget1.samples = composer.renderTarget2.samples = dpr >= 2 ? 0 : Math.min(4, gl.capabilities.maxSamples);
    composer.setPixelRatio(dpr);
    composer.setSize(size.width, size.height);
  }, [gl, scene, camera, counties, size.width, size.height, dpr, settings.depthOfField]);

  // A positive priority makes this the sole owner of the final render.
  useFrame((_, delta) => {
    const effects = depthOfField.current;
    vignette.current.material.uniforms.encoding.value = effects ? 1 : 1 / 2.2;
    if (!effects) return gl.render(scene, camera);
    if (controls) {
      effects.bokeh.uniforms.focus.value = camera.position.distanceTo(controls.target);
    }
    effects.composer.render(delta);
  }, 1);

  return (
    <mesh ref={vignette} visible={settings.vignette} renderOrder={1e6} frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial args={[vignetteShader]} blending={MultiplyBlending} premultipliedAlpha transparent
        depthTest={false} depthWrite={false} />
    </mesh>
  );
}
