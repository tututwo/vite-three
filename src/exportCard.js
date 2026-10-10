import { countyMetrics, lastCountyYear, marginLabel, palettes, shiftLabel, streaks, years } from './electionData.js';
import { countyCounts, electoralCounts } from './victory.js';

const titles = { territory: 'Territory', result: 'Result', shift: 'Shift', loyalty: 'Loyalty' };
const legends = {
  territory: ['Democratic lead', 'Republican lead', 'Third parties led', 'No data'],
  result: ['Democratic lead', 'Republican lead', 'Tie', 'No data'],
  shift: ['Toward Democrats', 'Toward Republicans', 'No change', 'No data'],
  loyalty: ['Democratic streak', 'Republican streak', 'Third parties led', 'No data'],
};
const metrics = {
  territory: 'Flat map; colour depth shows the vote-share margin.',
  shift: 'Height: absolute shift (pp), nonlinearly scaled.',
  loyalty: 'Height: elections in a row with the same leader (third parties included), up to 39.',
};

// One line with the same votes counted five ways, so the card carries the victory conditions.
function fiveCounts(elections, index) {
  const election = elections.electoral?.elections[index];
  if (!election) return '';
  const e = electoralCounts(election);
  const counts = countyCounts(elections, index, elections.electoral.countyLand);
  const pair = (values, format) => `D ${format(values.D)} · R ${format(values.R)}${values.O ? ` · Other ${format(values.O)}` : ''}`;
  const area = counts && Object.values(counts.area).reduce((a, b) => a + b, 0);
  return [
    counts ? `Counties ${pair(counts.counties, (n) => n.toLocaleString('en-US'))}` : `County returns end in ${lastCountyYear}`,
    counts && `Land ${pair(counts.area, (n) => `${Math.round(100 * n / area)}%`)}`,
    `States ${pair(e.states, (n) => n)}${e.dc ? ` (+ DC ${e.dc})` : ''}`,
    `Popular ${pair(e.popular, (n) => `${(100 * n / e.popular.total).toFixed(1)}%`)}`,
    `Electors ${pair(e.cast, (n) => n)}`,
  ].filter(Boolean).join('   |   ');
}

// Copying the final WebGL frame happens in PostProcessing; this only composes the card.
export async function downloadCard(mapCanvas, view, elections) {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1000;
  const ctx = canvas.getContext('2d');
  if (!ctx || !mapCanvas.width || !mapCanvas.height) throw new Error('The map image is unavailable.');
  const palette = palettes[view.palette];
  const index = years.indexOf(view.year);
  const shift = view.mode === 'shift';
  const loyalty = view.mode === 'loyalty';
  const write = (text, x, y, size = 23, color = '#444', weight = 400) => {
    ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  const wrap = (text, x, y, width, size = 21) => {
    ctx.font = `${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) {
        write(line, x, y, size); y += 29; line = word;
      } else line = next;
    }
    write(line, x, y, size);
    return y + 29;
  };
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1600, 1000);
  write('U.S. PRESIDENTIAL ELECTIONS · COUNTY EXPLORER · 1868–2024', 48, 45, 20, '#666');
  write(`${view.year} · ${titles[view.mode]}`, 48, 105, 48, '#171717', 600);
  write(shift ? (index ? `Change since ${years[index - 1]} · percentage points` : 'No previous election comparison in this series')
    : `Democratic–Republican lead · share of all votes${index ? ` · compared with ${years[index - 1]}` : ' · first election'}`, 48, 145, 25);
  const labels = [...legends[view.mode]];
  if (view.county) labels.push('Selected county');
  [palette.fills[0], palette.fills[1], '#999caa', '#faf8f5', ...(view.county ? ['#d9ae45'] : [])].forEach((fill, i) => {
    const x = [48, 390, 745, 970, 1200][i];
    ctx.fillStyle = fill; ctx.fillRect(x, 168, 18, 18);
    ctx.strokeStyle = '#bbb'; ctx.strokeRect(x, 168, 18, 18);
    write(labels[i], x + 29, 185, 22);
  });
  ctx.fillStyle = '#faf8f5'; ctx.fillRect(48, 207, 1504, 485);
  const scale = Math.min(1504 / mapCanvas.width, 485 / mapCanvas.height);
  const width = mapCanvas.width * scale, height = mapCanvas.height * scale;
  ctx.drawImage(mapCanvas, 48 + (1504 - width) / 2, 207 + (485 - height) / 2, width, height);
  let y = 731;
  if (view.county) {
    const location = elections.countyNames[view.county];
    const values = countyMetrics(elections.counties[view.county], index);
    y = wrap(`${location.name}, ${location.state} · FIPS ${view.county}`, 48, y, 1504, 27);
    const streak = streaks(elections.counties[view.county])[index];
    y = wrap(`${marginLabel(values.margin)} · ${shiftLabel(values.shift)} · ${values.total === null ? 'No current returns' : `${values.total.toLocaleString('en-US')} votes`}${values.flipped ? ' · D/R lead flipped' : ''}${loyalty && streak.length ? ` · ${streak.length} in a row with the same leader` : ''}`, 48, y, 1504, 22);
  } else {
    const flips = elections.flips[index];
    y = wrap(!index ? 'First election in this series: no previous election comparison.' : flips.compared ? `Nationwide: ${flips.toDemocratic + flips.toRepublican} counties flipped among ${flips.compared.toLocaleString('en-US')} with valid returns in both elections.`
      : `County returns end in ${lastCountyYear}; ${view.year} shows state results only.`, 48, y, 1504, 24);
  }
  y = wrap(fiveCounts(elections, index), 48, y + 4, 1504, 20);
  const metric = metrics[view.mode] ?? `Height: ${view.height === 'margin %' ? 'absolute vote-share margin' : 'absolute vote-count margin'}, nonlinearly scaled.`;
  y = wrap(`${metric} Margin = 100 × (D votes − R votes) / all votes. Third parties led where their votes together beat both parties.`, 48, Math.max(y + 8, 807), 1504);
  y = wrap('Modern county names/boundaries; renamed and merged returns combined. Missing returns stay missing; Alaska district returns are unavailable. Land: 48 contiguous states and DC.', 48, y + 4, 1504);
  y = wrap('Sources: Amlani & Algara, Harvard Dataverse (county returns 1868–2020); The American Presidency Project, UCSB (state results); U.S. Census Bureau; us-atlas; Natural Earth.', 48, y + 4, 1504, 20);
  write(`Map captured at ${mapCanvas.width} × ${mapCanvas.height} pixels; fitted proportionally. Card: 1600 × 1000.`, 48, Math.max(y + 5, 968), 18, '#666');
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG creation failed.')), 'image/png'));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `election-${view.year}-${view.mode}${view.county ? `-${view.county}` : ''}.png`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
