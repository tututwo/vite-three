# 3D Election Map

A React Three Fiber map built with React 19.2, Fiber 9, Drei 10, Three.js and Vite.

```sh
npm install
npm run dev
npm test
npm run build
```

The header's timeline scrubs or steps through the elections; the controls pause/resume playback, switch the height metric and the colour palette, and adjust animation, lighting and effects. Under the title, the header shows the share of counties that changed party since the previous election, the count and which way they went, over a bar per election of that share, which is the year control. Drag to pan, scroll to zoom, and right-drag to orbit. Reduced-motion preferences disable autoplay and breathing on initial load.

- `src/App.jsx`: React controls, Canvas, loading and error UI.
- `src/ElectionScene.jsx`: scene, MapControls, caption, the floor with the basemap painted into it, and a single Fiber animation loop.
- `src/electionData.js`: signed heights per county and election, flip counts and palettes.
- `src/mapGeometry.js`: all counties in one mesh. The vertex shader eases each county between elections from a data texture (one row per county), so the CPU only sets a few uniforms per frame; the fragment shader colours by altitude and adds ambient occlusion where a wall rises out of the county across its border.
- `src/PostProcessing.jsx`: renders straight to the canvas with a vignette quad; a Bokeh composer exists only while depth of field is on.
- `public/counties.svg`, `public/elections.json`, and `public/basemap.svg`: generated assets, loaded in parallel at runtime. Counties and the static Canada/Mexico/ocean basemap share one continuous Albers projection, including Alaska and Hawaii at their geographic positions.

## Data

All 39 presidential elections from 1868 to 2020. Height and colour show the Democratic-vs-Republican margin, so strong third-party years (1912, 1924, 1968, 1992) read as closer than the county's real winner. Counties without data use the background colour (territories, Hawaii before 1960); Alaska reports by district and also uses the background colour.

```sh
npm run data:elections   # data/*.Rdata -> public/elections.json (needs R with jsonlite)
npm run data:map -- 10   # us-atlas -> mapshaper simplify dp 10% -> public/counties.svg
npm run data:basemap     # Natural Earth + us-atlas -> aligned static basemap.svg (network needed only to regenerate)
```

- `scripts/export-elections.R` sums counties that were renamed or merged into the shape that covers them today (Dade -> Miami-Dade, Shannon -> Oglala Lakota, the Virginia cities, ...) and fixes misspelled nominees. `npm test` fails if a county with returns has no shape on the map.
- `scripts/build-map.mjs` simplifies the shared topology, so neighbours stay watertight, then moves Alaska/Hawaii out of their source insets into continuous Albers coordinates. Mainland paths and their scene origin are preserved. Lower the percentage for chunkier counties; small islands may disappear during simplification.
- Returns: Amlani & Algara, county presidential returns 1868-2020 (Harvard Dataverse). Shapes: `us-atlas` (Census 2017).
- Basemap context: [Natural Earth 1:50m](https://www.naturalearthdata.com/), public-domain country boundaries and lakes. The local texture uses the same continuous projection as the counties.
- `data/`: the source `.Rdata` plus the original R exploration (raw CSVs, `.qmd` notebooks). Kept out of `public/` so Vite does not ship it.

GPU resources are recreated and released with the scene lifecycle, including React Strict Mode. React is kept on the 19.2 release line to match Fiber 9.7's peer dependency range. The existing color pipeline uses no tone mapping (`Canvas flat`). Depth of field defaults off and the scene has no distance fog; depth of field remains available in Lights & effects. Canvas rendering uses a 1.5–2 pixel ratio, with the canvas's own MSAA below 2×, and draws frames on demand while playback is paused without breathing. Controls collapse into a bottom panel on narrow screens, with reduced-motion, reduced-transparency and increased-contrast preferences supported.
