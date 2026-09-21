import { useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector2 } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { VignetteShader } from "three/addons/shaders/VignetteShader.js";

export default function PostProcessing({ settings, outlineMesh }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);
  const pipeline = useRef(null);

  useLayoutEffect(() => {
    const composer = new EffectComposer(gl);
    // Multisample geometry edges without FXAA blending away small, distant counties.
    composer.renderTarget1.samples = composer.renderTarget2.samples = Math.min(4, gl.capabilities.maxSamples);
    const gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.updateGtaoMaterial({
      radius: 14,
      distanceExponent: 1.4,
      thickness: 8,
      scale: 1.3,
      samples: 16,
    });

    const bokeh = new BokehPass(scene, camera, {
      focus: 800,
      aperture: 0.000012,
      maxblur: 0.004,
    });
    const outline = new OutlinePass(new Vector2(1, 1), scene, camera);
    // The invisible stand-in coincides with its county, so both edges match.
    outline.hiddenEdgeColor.copy(outline.visibleEdgeColor);

    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms.offset.value = 0.75;
    vignette.uniforms.darkness.value = 1;
    const passes = [
      new RenderPass(scene, camera),
      gtao,
      bokeh,
      outline,
      vignette,
      new OutputPass(),
    ];
    for (const pass of passes) composer.addPass(pass);
    pipeline.current = { composer, gtao, bokeh, outline, vignette };

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
    const ghost = outlineMesh.current;
    passes.outline.selectedObjects.length = ghost?.visible ? 1 : 0;
    if (ghost?.visible) passes.outline.selectedObjects[0] = ghost;
    passes.composer.render(delta);
  }, 1);

  return null;
}
