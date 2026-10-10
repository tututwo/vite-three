import { useEffect, useRef } from 'react';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

// A tuning panel for the map, open with ?debug in the URL. Every control writes one setting by name,
// live; "Copy settings JSON" puts the tuned values on the clipboard to paste back as App.jsx defaults.
// [name, min, max, step] is a slider, [name, 'color'] a colour, [name, [options]] a menu, [name] a checkbox.
const groups = [
  ['Skin', [['skin', ['civ', 'editorial']], ['oceanColor', 'color'], ['landColor', 'color'], ['inkColor', 'color']]],
  ['Hex grid', [['hexSize', 4, 20, 0.1], ['hexWidth', 0, 0.1, 0.002], ['gridOcean', 0, 1, 0.01], ['hexOnLand', 0, 1, 0.01]]],
  ['Borders', [['borders', 0, 1, 0.01], ['borderWidth', 0, 5, 0.05], ['borderCore', 0.05, 1, 0.01], ['borderGlow', 0, 1, 0.01],
    ['borderHighlight', 0, 1, 0.01], ['borderColumns', 0, 1, 0.01], ['flipFade', 0, 0.005, 0.0001]]],
  ['Fog of war', [['fogColor', 'color'], ['fogInk', 'color'], ['fogHatch', 1, 12, 0.1], ['fogLine', 0, 0.8, 0.01],
    ['fogClouds', 0, 1, 0.01], ['fogScale', 0.002, 0.08, 0.001], ['fogSpeed', 0, 3, 0.01]]],
  ['Elector board', [['boardCompact', 0.3, 1, 0.01], ['boardGap', 0, 0.4, 0.01], ['boardHeight', 0, 60, 0.5],
    ['boardBase', 0.2, 10, 0.1], ['hexBorder', 0, 0.4, 0.005], ['boardLabels'], ['boardLabelMin', 3, 20, 1]]],
  ['City banners', [['bannerCount', 0, 20, 1], ['bannerSpacing', 0, 150, 1]]],
  ['Columns & motion', [['maxHeight', 10, 250, 1], ['heightExponent', 0.5, 4, 0.1], ['colorGamma', 0.2, 2, 0.05],
    ['stagger', 0, 0.9, 0.01], ['breath', 0, 0.15, 0.005], ['secondsPerElection', 0.5, 10, 0.1]]],
  ['Lights', [['fill', 0, 5, 0.1], ['front', 0, 5, 0.1], ['key', 0, 8, 0.1], ['ambientOcclusion', 0, 2, 0.05],
    ['shadowSoftness', 0, 12, 0.1], ['vignette']]],
];
const keys = groups.flatMap(([, controls]) => controls.map(([name]) => name));

export default function DebugPanel({ settings, onChange }) {
  const values = useRef({ ...settings });
  const panel = useRef(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const gui = new GUI({ title: 'Map debugger' });
    groups.forEach(([title, controls], index) => {
      const folder = gui.addFolder(title);
      for (const [name, ...options] of controls) {
        const controller = options[0] === 'color' ? folder.addColor(values.current, name)
          : Array.isArray(options[0]) ? folder.add(values.current, name, options[0])
            : folder.add(values.current, name, ...options);
        controller.onChange((value) => change.current(name, value));
      }
      if (index > 2) folder.close();
    });
    gui.add({ copy: () => navigator.clipboard?.writeText(JSON.stringify(Object.fromEntries(keys.map((key) => [key, values.current[key]])), null, 2)) }, 'copy')
      .name('Copy settings JSON');
    panel.current = gui;
    return () => { gui.destroy(); panel.current = null; };
  }, []);

  // Settings changed elsewhere (the Map settings sliders, a mode switch) show up here too.
  useEffect(() => {
    Object.assign(values.current, settings);
    panel.current?.controllersRecursive().forEach((controller) => controller.updateDisplay());
  }, [settings]);
  return null;
}
