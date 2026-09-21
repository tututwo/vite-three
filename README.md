# 3D Election Map

A React Three Fiber map built with React 19.2, Fiber 9, Drei 10, Three.js and Vite.

```sh
npm install
npm run dev
npm test
npm run build
```

The controls select an election year, pause/resume playback, switch the height metric, and adjust animation, lighting and effects. Drag to pan, scroll to zoom, and right-drag to orbit. Hover a county to outline it. Reduced-motion preferences disable autoplay and breathing on initial load.

- `src/App.jsx`: React controls, Canvas, loading and error UI.
- `src/ElectionScene.jsx`: scene, MapControls, caption and a single Fiber animation loop.
- `src/electionData.js`: signed heights per county and election, and their interpolation.
- `src/mapGeometry.js`: one BatchedMesh, county geometry, gradient shader and resource cleanup.
- `src/PostProcessing.jsx`: the existing Three.js GTAO, depth of field, outline, vignette and FXAA passes, rendered by Fiber.
- `public/counties.svg` and `public/elections.json`: generated assets, loaded in parallel at runtime.

## Data

All 39 presidential elections from 1868 to 2020. Height and colour show the Democratic-vs-Republican margin, so strong third-party years (1912, 1924, 1968, 1992) read as closer than the county's real winner. Counties are grey until they first vote (territories, Hawaii before 1960); Alaska reports by district and stays grey.

```sh
npm run data:elections   # data/*.Rdata -> public/elections.json (needs R with jsonlite)
npm run data:map -- 10   # us-atlas -> mapshaper simplify dp 10% -> public/counties.svg
```

- `scripts/export-elections.R` sums counties that were renamed or merged into the shape that covers them today (Dade -> Miami-Dade, Shannon -> Oglala Lakota, the Virginia cities, ...) and fixes misspelled nominees. `npm test` fails if a county with returns has no shape on the map.
- `scripts/build-map.mjs` simplifies the shared topology, so neighbours stay watertight. Lower the percentage for chunkier counties.
- Returns: Amlani & Algara, county presidential returns 1868-2020 (Harvard Dataverse). Shapes: `us-atlas` (Census 2017, Albers USA).
- `data/`: the source `.Rdata` plus the original R exploration (raw CSVs, `.qmd` notebooks). Kept out of `public/` so Vite does not ship it.

GPU resources are recreated and released with the scene lifecycle, including React Strict Mode. React is kept on the 19.2 release line to match Fiber 9.7's peer dependency range. The existing color pipeline uses no tone mapping (`Canvas flat`).
