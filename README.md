# 3D Election Map

A React Three Fiber map built with React 19.2, Fiber 9, Drei 10, Three.js and Vite.

```sh
npm install
npm run dev
npm test
npm run build
```

The app opens paused at **2020 · Territory**. Four map modes share one engine:

- **Territory** lays the counties flat and colours each by who led (deeper colour = wider vote-share lead). Grey marks counties where third parties, together, beat both parties.
- **Margin** (`mode=result`) raises the D/R lead and keeps the vote-share or vote-count height setting.
- **Shift** shows movement toward Democrats or Republicans; heights use the absolute change in margin, in percentage points.
- **Loyalty** raises each county by how many elections in a row it had the same leader. A missing return, a tie or any change of leader, third parties included, ends a streak, so a county that changes sides drops to one level.

The **40 turns** timeline under the toolbar shows who won the electors and the popular vote in every election 1868–2024, marks third parties that won electors, popular-vote winners who lost, and voting-rights milestones; selecting a turn changes the year. 2024 has state results only, because county returns end in 2020. Gray means a tie/no change, cream means no valid data, and gold marks the selected county. The first election has no previous comparison.

**Same votes, five counts** (the sidebar) counts each election five ways: counties led, land area (48 contiguous states and DC), states won, popular vote and the Electoral College, with the tipping-point state, wasted votes and people per elector. **Road to 270** under the map lines the states up from the safest Republican to the safest Democratic lead, each as wide as its electors, and outlines the state that delivered the majority. The county card adds a loyalty strip, and **Streaks ended this election** lists counties that left a long streak.

The ranking shows the five largest absolute margins (Result) or shifts (Shift), including counties that did not flip. **View all counties** expands it. **Flipped counties only** affects the list, not the map or nationwide statistics; it is unavailable in 1868. The data sidebar reports nationwide changes in the D/R lead among all comparable counties. In 2020, 79 of 3,110 comparable counties changed lead.

Use **Find a county** to search modern county names, state names, or a full five-digit FIPS (including leading zeros). Use Up/Down then Enter, or select any ranking button. Both open the same county details with current returns, directional shift, a signed-margin chart, and an expandable history table. Missing years break the chart and never create inferred flips across gaps. Selection survives year/mode/filter changes; closing details clears it. **Focus county** zooms to its gold highlight; **National view** restores the initial view. Drag to pan, scroll to zoom, and right-drag to orbit. Direct clicks on the deformed 3D geometry are not a selection mechanism.

**Copy link** saves year, Result/Shift, county, list filter, palette and Result height metric. Pasting it into another tab restores the data view paused, with an appropriate county focus. Browser Back/Forward restores those states. Arbitrary camera rotations, animation settings and lighting are not shared. If clipboard access fails, a selectable URL appears. Links and assets preserve the Vite deployment path, currently `/data-visualization/presidential-margins-1868-2020/live/`.

**Download PNG** pauses playback and captures the final rendered map after the selected year and camera settle, temporarily freezing breathing. The native Canvas card is 1600 × 1000 with the legend, definitions, county summary when selected, coverage and sources. It states the actual captured map pixel dimensions; a smaller source is not advertised as a high-resolution map. Export leaves playback paused and restores temporary display settings. No screenshot package, server renderer, or persistent drawing buffer is used.

The interface shares one grid: title/actions, a 44px toolbar with year/playback/mode and search, then a large map beside county details, nationwide context and rankings. The legend stays attached to the map. On phones, DOM and keyboard order is title/actions → toolbar/search → map → county details/ranking. Year selection changes immediately; Play animates the timeline. Search, rankings and history remain available if WebGL fails. Reduced-motion preferences disable breathing and camera transitions, including preference changes while the app is open. **Data & methods** remains available below the explorer. Map settings retain color palettes, height, animation, lighting and optional depth of field.

- `src/App.jsx`: data loading independent of WebGL, controls, shared selection, URL navigation and export UI.
- `src/CountySearch.jsx`, `src/CountyDetails.jsx`: accessible local search, SVG/D3 county history and data table.
- `src/viewState.js`, `src/exportCard.js`: validated URL state and native Canvas PNG composition.
- `src/ElectionScene.jsx`: scene, MapControls, the floor with the basemap painted into it, and a single Fiber animation loop.
- `src/electionData.js`: shared raw margin/shift/validity definitions, county leader (third parties included), loyalty streaks, flip counts, stable rankings, visual series and palettes.
- `src/victory.js`, `src/Electoral.jsx`: the five counts, road to a majority, tipping point, wasted votes and people per elector; their panels, the turn timeline and the loyalty strip.
- `src/mapGeometry.js`: all counties in one mesh. The vertex shader eases each county between elections from a data texture (one row per county), so the CPU only sets a few uniforms per frame; the fragment shader colours by altitude and adds ambient occlusion where a wall rises out of the county across its border.
- `src/PostProcessing.jsx`: renders straight to the canvas with a vignette quad; a Bokeh composer exists only while depth of field is on.
- `public/counties.svg`, `public/elections.json`, `public/county-names.json`, `public/electoral.json` and `public/basemap.svg`: generated assets, loaded in parallel at runtime. Counties and the static Canada/Mexico/ocean basemap share one continuous Albers projection, including Alaska and Hawaii at their geographic positions.

## Data

County returns cover all 39 presidential elections from 1868 to 2020 (`elections.json` keeps an empty 2024 column so the map has 40 turns); state results cover 1868–2024. Margin = `100 × (D − R) / all votes`; shift = current margin minus the immediately previous election’s margin. Valid returns require a finite difference and a finite, positive total. A flip requires two valid margins of strictly opposite sign; ties are valid and do not count as flips. `other = total − D − R` keeps third parties as one sum, so a third-party-led county (342 in 1892, 759 in 1912, 236 in 1924, 262 in 1948, 518 in 1968) never names a single candidate; Margin and Shift still show only the D/R lead. Counties without data use the background colour (territories, Hawaii before 1960); Alaska reports by district and also uses the background colour.

```sh
npm run data:elections   # data/*.Rdata -> public/elections.json (needs R with jsonlite)
npm run data:map -- 10   # us-atlas -> mapshaper simplify dp 10% -> public/counties.svg + county-names.json
npm run data:basemap     # Natural Earth + us-atlas -> aligned static basemap.svg (network needed only to regenerate)
npm run data:electoral   # data/state-results.csv, state-population.csv, county-land.csv -> public/electoral.json
```

- `scripts/export-elections.R` sums counties that were renamed or merged into the shape that covers them today (Dade -> Miami-Dade, Shannon -> Oglala Lakota, the Virginia cities, ...) and fixes misspelled nominees. `npm test` fails if a county with returns has no shape on the map.
- `scripts/build-map.mjs` simplifies the shared topology, so neighbours stay watertight, then moves Alaska/Hawaii out of their source insets into continuous Albers coordinates. Mainland paths and their scene origin are preserved. Lower the percentage for chunkier counties; small islands may disappear during simplification.
- Returns: Amlani & Algara, county presidential returns 1868-2020 (Harvard Dataverse). Shapes: `us-atlas` (Census 2017).
- `data/state-results.csv`: votes and electors per state from [The American Presidency Project](https://www.presidency.ucsb.edu/statistics/elections) (UC Santa Barbara), one page per election, with Maine/Nebraska district rows; Maine 2016's districts come from its certificate of ascertainment at the National Archives. `scripts/build-electoral.mjs` checks every election's counted electors against the official totals and holds the short list of exceptions: Greeley's death (1872), faithless and unpledged electors (1948–2016), and the 2000 abstention.
- `data/state-population.csv`: resident population per census, U.S. Census Bureau `apportionment.csv` for 1910–2020 and Wikipedia's census table for 1860–1900. Each election uses the census that set its electors (1912–1928 all use 1910, as Congress did not reapportion after 1920).
- `data/county-land.csv`: Census 2020 Gazetteer land area per county, for the Territory land share.
- Basemap context: [Natural Earth 1:50m](https://www.naturalearthdata.com/), public-domain country boundaries and lakes. The local texture uses the same continuous projection as the counties.
- `data/`: the source `.Rdata` plus the original R exploration (raw CSVs, `.qmd` notebooks). Kept out of `public/` so Vite does not ship it.

GPU resources are recreated and released with the scene lifecycle, including React Strict Mode. React is kept on the 19.2 release line to match Fiber 9.7's peer dependency range. The existing color pipeline uses no tone mapping (`Canvas flat`). Depth of field defaults off and the scene has no distance fog; depth of field remains available in Lights & effects. Canvas rendering uses a 1.5–2 pixel ratio, with the canvas's own MSAA below 2×, and draws frames on demand while playback is paused without breathing. Settings open from the map heading in a bounded, scrollable panel; Escape closes it and restores focus. The interface uses opaque neutral surfaces, honors reduced motion and increased contrast, and keeps data definitions available on phones.

## Verification

`npm run build` creates the static deployment in `dist/data-visualization/presidential-margins-1868-2020/live/`. Acceptance was performed through the running browser, including real PNG downloads, URL restoration, keyboard use, narrow layouts, reduced motion and rendering failures. One test covers loyalty streaks and the five counts (2016 Wisconsin tipping point, 2000 Florida, Elliott County's broken streak). The older ranking test still expects the pre-Result/Shift list and fails; it has not been rewritten.

See [the implementation and browser acceptance report](IMPLEMENTATION_REPORT.md) for desktop/mobile screenshots, downloaded cards, and known limits.
