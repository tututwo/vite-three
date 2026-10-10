import { countyMetrics, marginLabel, palettes, shiftLabel, years } from './electionData.js';

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
  write('U.S. PRESIDENTIAL ELECTIONS · COUNTY EXPLORER · 1868–2020', 48, 45, 20, '#666');
  write(`${view.year} · ${shift ? 'Shift' : 'Result'}`, 48, 105, 48, '#171717', 600);
  write(shift ? (index ? `Change since ${years[index - 1]} · percentage points` : 'No previous election comparison in this series')
    : `Democratic–Republican lead · share of all votes${index ? ` · compared with ${years[index - 1]}` : ' · first election'}`, 48, 145, 25);
  const labels = shift ? ['Toward Democrats', 'Toward Republicans'] : ['Democratic lead', 'Republican lead'];
  labels.push(shift ? 'No change' : 'Tie', 'No data');
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
    y = wrap(`${marginLabel(values.margin)} · ${shiftLabel(values.shift)} · ${values.total === null ? 'No current returns' : `${values.total.toLocaleString('en-US')} votes`}${values.flipped ? ' · D/R lead flipped' : ''}`, 48, y, 1504, 22);
  } else {
    const flips = elections.flips[index];
    y = wrap(index ? `Nationwide: ${flips.toDemocratic + flips.toRepublican} counties flipped among ${flips.compared.toLocaleString('en-US')} with valid returns in both elections.`
      : 'First election in this series: no previous election comparison.', 48, y, 1504, 24);
    y += 20;
  }
  const metric = shift ? 'Height: absolute shift (pp)' : `Height: ${view.height === 'margin %' ? 'absolute vote-share margin' : 'absolute vote-count margin'}`;
  y = wrap(`${metric}, nonlinearly scaled. Margin = 100 × (D votes − R votes) / all votes. Shift = current margin − previous margin.`, 48, Math.max(y + 8, 807), 1504);
  y = wrap('D/R lead only; actual third-party winners are not shown. Modern county names/boundaries; renamed and merged returns combined. Missing returns stay missing; Alaska district returns are unavailable.', 48, y + 4, 1504);
  y = wrap('Sources: Amlani & Algara, Harvard Dataverse (1868–2020 returns); U.S. Census 2017 / us-atlas; Natural Earth.', 48, y + 4, 1504, 20);
  write(`Map captured at ${mapCanvas.width} × ${mapCanvas.height} pixels; fitted proportionally. Card: 1600 × 1000.`, 48, Math.max(y + 5, 968), 18, '#666');
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG creation failed.')), 'image/png'));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `election-${view.year}-${view.mode}${view.county ? `-${view.county}` : ''}.png`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
