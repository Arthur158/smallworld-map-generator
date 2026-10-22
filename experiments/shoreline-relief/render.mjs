import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { loadRuntimeAssets, normalizeSettings, generateMapResult } from '../../server/render-engine.mjs';
import { makeMap } from '../../src/generation/mapGenerator.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.resolve(process.argv[2] ?? 'shoreline-relief-preview');
await fs.mkdir(out, { recursive: true });
// Instrument an isolated copy of the real compositor for preview. Production
// never imports the experiment and contains no new rendering hook/settings.
let source = await fs.readFile(path.join(root, 'server/render-map-node.mjs'), 'utf8');
source = source.replaceAll(/from "(\.\.\/[^"\n]+)"/g, (_, relative) =>
  `from ${JSON.stringify(pathToFileURL(path.resolve(root, 'server', relative)).href)}`);
source = `import { drawShorelineRelief } from ${JSON.stringify(new URL('./relief.js', import.meta.url).href)};\nimport { createCanvas } from ${JSON.stringify(pathToFileURL(path.join(root, 'node_modules/@napi-rs/canvas/index.js')).href)};\n` + source;
const insertion = '  if (config.showBorders !== false) drawCurvedBorderNetwork(ctx, edgePaths);';
if (!source.includes(insertion)) throw new Error('Compositor changed: update preview insertion point.');
source = source.replace(insertion, '  drawShorelineRelief(ctx, drawnCells, config, createCanvas);\n' + insertion);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'smallworld-relief-preview-'));
try {
  const file = path.join(temp, 'render.mjs'); await fs.writeFile(file, source);
  const { renderMapNode } = await import(pathToFileURL(file).href);
  const assets = await loadRuntimeAssets();
  const cases = [
    ['mainland', { seed: 'city-fields-22', tileCount: 22, seaCorners: { NW: true, SE: true }, centerLake: true }],
    ['lake', { seed: 'relief-lake-5', tileCount: 38, seaCorners: { NW: true, SE: true }, centerLake: true }],
    ['dense', { seed: 'city-fields-120', tileCount: 120, seaCorners: { NW: true, NE: true, SE: true }, centerLake: true }],
  ];
  for (const [name, input] of cases) {
    const settings = normalizeSettings(input), config = { ...settings, ...assets }, cells = makeMap(config);
    const canvas = createCanvas(config.width, config.height), ctx = canvas.getContext('2d');
    const start = performance.now(); renderMapNode(ctx, cells, config);
    const elapsed = performance.now() - start;
    await fs.writeFile(path.join(out, `${name}-prototype.png`), canvas.toBuffer('image/png'));
    const display = createCanvas(1100, Math.round(config.height * 1100 / config.width));
    display.getContext('2d').drawImage(canvas, 0, 0, display.width, display.height);
    await fs.writeFile(path.join(out, `${name}-prototype-game.png`), display.toBuffer('image/png'));
    const clean = await generateMapResult(input);
    await fs.writeFile(path.join(out, `${name}-clean.png`), clean.imageBuffer);
    await fs.writeFile(path.join(out, `${name}-input.json`), JSON.stringify(input, null, 2));
    console.log(`${name}: ${Math.round(elapsed)}ms, ${config.width}x${config.height}`);
  }
} finally { await fs.rm(temp, { recursive: true, force: true }); }
