import { useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { VignetteShader } from "three/addons/shaders/VignetteShader.js";

export default function PostProcessing({ settings }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);
  const pipeline = useRef(null);

  useLayoutEffect(() => {
    const composer = new EffectComposer(gl);
    const gtao = new GTAOPass(scene, camera, 1, 1);
    // AO is soft by nature, so half resolution and half the samples hold up, and cut about a
    // third of the frame.
    gtao.setSize = (width, height) => GTAOPass.prototype.setSize.call(gtao, width / 2, height / 2);
    gtao.updateGtaoMaterial({
      radius: 14,
      distanceExponent: 1.4,
      thickness: 8,
      scale: 1.3,
      samples: 8,
    });
    gtao.updatePdMaterial({ samples: 8 });

    const bokeh = new BokehPass(scene, camera, {
      focus: 800,
      aperture: 0.000012,
      maxblur: 0.004,
    });

    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms.offset.value = 0.75;
    vignette.uniforms.darkness.value = 1;
    const passes = [
      new RenderPass(scene, camera),
      gtao,
      bokeh,
      vignette,
      new OutputPass(),
    ];
    for (const pass of passes) composer.addPass(pass);
    pipeline.current = { composer, gtao, bokeh, vignette };

    return () => {
      pipeline.current = null;
      for (const pass of passes) pass.dispose();
      // Three r186's GTAOPass.dispose() omits these two owned materials.
      gtao.gtaoMaterial.dispose();
      gtao.blendMaterial.dispose();
      composer.dispose();
    };
  }, [gl, scene, camera]);

  useLayoutEffect(() => {
    const { composer } = pipeline.current;
    // Multisample geometry edges without FXAA blending away small, distant counties. At 2x pixel
    // ratio the edges are already fine and 4 samples cost more than the rest of the frame.
    // A new ratio always resizes the targets, which reallocates them with this sample count.
    composer.renderTarget1.samples = composer.renderTarget2.samples = dpr >= 2 ? 0 : Math.min(4, gl.capabilities.maxSamples);
    composer.setPixelRatio(dpr);
    composer.setSize(size.width, size.height);
  }, [gl, scene, camera, size.width, size.height, dpr]);

  // A positive priority makes this the sole owner of the final render.
  useFrame((_, delta) => {
    const passes = pipeline.current;
    if (!passes) return;
    passes.gtao.blendIntensity = settings.ambientOcclusion;
    passes.bokeh.enabled = settings.depthOfField;
    passes.vignette.enabled = settings.vignette;
    if (controls) {
      passes.bokeh.uniforms.focus.value = camera.position.distanceTo(controls.target);
    }
    passes.composer.render(delta);
  }, 1);

  return null;
}
