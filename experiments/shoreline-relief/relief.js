import { traceSmoothClosedPath } from '../../src/geometry/polygon.js';
import { hash01 } from '../../src/rng.js';

// Preview-only height model. No beach/cliff sprites or legacy shoreline code.
// A land mask projected in ONE view direction reveals downward-facing rock.
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = v => { v = clamp(v); return v * v * (3 - 2 * v); };
const rock = { field: [92, 80, 56], grass: [80, 83, 57], forest: [57, 65, 49],
  mountain: [78, 82, 86], swamp: [65, 68, 48] };

function noiseFactory(seed) {
  const phase = hash01(seed, 'relief-phase') * 4000;
  function lattice(x, y) {
    let n = Math.imul(x + Math.floor(phase), 374761393) ^ Math.imul(y, 668265263);
    n = Math.imul(n ^ n >>> 13, 1274126177);
    return ((n ^ n >>> 16) >>> 0) / 4294967295;
  }
  return (x, y, scale) => {
    x = x / scale; y = y / scale;
    const ix = Math.floor(x), iy = Math.floor(y), tx = smooth(x - ix), ty = smooth(y - iy);
    return (lattice(ix, iy) * (1 - tx) + lattice(ix + 1, iy) * tx) * (1 - ty) +
      (lattice(ix, iy + 1) * (1 - tx) + lattice(ix + 1, iy + 1) * tx) * ty;
  };
}

function nearestLand(land, width, height) {
  const nearest = new Int32Array(width * height); nearest.fill(-1);
  for (let i = 0; i < nearest.length; i++) if (land[i]) nearest[i] = i;
  function visit(x, y, offsets) {
    const i = y * width + x;
    if (land[i]) return;
    let best = nearest[i], distance = Infinity;
    if (best >= 0) distance = (best % width - x) ** 2 + (Math.floor(best / width) - y) ** 2;
    for (const [dx, dy] of offsets) {
      if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      const candidate = nearest[i + dy * width + dx];
      if (candidate < 0) continue;
      const d = (candidate % width - x) ** 2 + (Math.floor(candidate / width) - y) ** 2;
      if (d < distance) { best = candidate; distance = d; }
    }
    nearest[i] = best;
  }
  const forward = [[-1, 0], [-1, -1], [0, -1], [1, -1]];
  const backward = [[1, 0], [1, 1], [0, 1], [-1, 1]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) visit(x, y, forward);
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) visit(x, y, backward);
  return nearest;
}

/** Run after biome bases, before existing borders, buildings and game markers. */
export function drawShorelineRelief(ctx, drawnCells, config, createCanvas) {
  const { width, height, seed } = config;
  const mask = createCanvas(width, height), paint = mask.getContext('2d');
  const colors = [[0, 0, 0]];
  for (const { cell, poly } of drawnCells) {
    if (cell.biome === 'sea') continue;
    const index = colors.push(rock[cell.biome] ?? rock.grass) - 1;
    traceSmoothClosedPath(paint, poly);
    paint.fillStyle = `rgb(${index},0,0)`; paint.fill();
  }
  const landData = paint.getImageData(0, 0, width, height).data;
  const land = new Uint8Array(width * height);
  for (let i = 0; i < land.length; i++) if (landData[i * 4 + 3] > 127) land[i] = landData[i * 4];
  paint.clearRect(0, 0, width, height);
  for (const { cell, poly } of drawnCells) {
    if (cell.biome !== 'sea') continue;
    traceSmoothClosedPath(paint, poly);
    paint.fillStyle = cell.waterKind === 'lake' ? '#ff0000' : '#00ff00'; paint.fill();
  }
  const water = paint.getImageData(0, 0, width, height).data;
  const nearest = nearestLand(land, width, height), noise = noiseFactory(seed);
  const output = ctx.createImageData(width, height), pixels = output.data;
  const color = [0, 0, 0];
  let paintedPixels = 0, reliefPixels = 0;
  for (let y = 30; y < height - 30; y++) for (let x = 30; x < width - 30; x++) {
    const i = y * width + x, p = i * 4, n = nearest[i];
    if (water[p + 3] < 128 || land[i] || n < 0) continue;
    const nx = n % width, ny = Math.floor(n / width), distance = Math.hypot(x - nx, y - ny);
    if (distance > 48) continue;
    const lake = water[p] > 128, broad = noise(x, y, 65), detail = noise(x, y, 3.4);
    // Long translucent shallows: existing painted water remains visible beneath.
    let alpha = 0.24 * Math.exp(-distance / (lake ? 20 : 13)) * (0.65 + 0.65 * broad);
    color[0] = lake ? 105 : 90; color[1] = lake ? 172 : 169; color[2] = lake ? 157 : 159;
    // Project vertically below the actual land silhouette, never out along each
    // region normal. This prevents a ring of stone around a water body.
    let top = -1, drop = 0;
    for (let d = 1; d <= (lake ? 15 : 29); d++) {
      const sx = Math.round(x + d * 0.20), sy = y - d;
      if (sy < 0 || sx >= width) break;
      if (land[sy * width + sx]) { top = sy * width + sx; drop = d; break; }
    }
    if (top >= 0) {
      const tx = top % width, ty = Math.floor(top / width);
      const elevation = (lake ? 6.5 : 15) + noise(tx, ty, 78) * (lake ? 5 : 12) +
        (noise(tx, ty, 7) - 0.5) * 3;
      const edge = elevation - drop;
      if (edge > -0.6) {
        const base = colors[land[top]] ?? rock.grass;
        const depth = clamp(drop / elevation);
        // Unequal fractured blocks: independent 2D facets, not vertical stripes.
        // Coordinates remain in world space so the rock is never stretched
        // around the coast. The narrow face exposes only part of each block.
        const u = x / 13, v = y / 8;
        const gx = Math.floor(u), gy = Math.floor(v);
        let first = Infinity, second = Infinity, blockX = 0, blockY = 0, shade = 0;
        for (let by = gy - 1; by <= gy + 1; by++) for (let bx = gx - 1; bx <= gx + 1; bx++) {
          const cx = bx + hash01(seed, 'rock-x', bx, by) * 0.8 + 0.1;
          const cy = by + hash01(seed, 'rock-y', bx, by) * 0.8 + 0.1;
          const dist = Math.hypot(u - cx, v - cy);
          if (dist < first) {
            second = first; first = dist; blockX = cx; blockY = cy;
            shade = hash01(seed, 'rock-light', bx, by);
          } else if (dist < second) second = dist;
        }
        const fracture = 1 - smooth((second - first) / 0.11);
        const plane = (u - blockX) * -0.17 + (v - blockY) * -0.12;
        const light = 0.67 + shade * 0.65 + plane - depth * 0.17 - fracture * 0.13 * smooth(shade * 1.5);
        for (let c = 0; c < 3; c++) color[c] = base[c] * light + detail * 12;
        alpha = smooth((edge + 0.6) / 1.4) * 0.98;
        reliefPixels++;
      } else {
        const footDistance = drop - elevation;
        // Dark water at the foot grounds the face; scattered wash breaks it up.
        const shadow = 0.28 * Math.exp(-footDistance / 3.4);
        if (shadow > alpha) { color[0] = 22; color[1] = 77; color[2] = 84; alpha = shadow; }
        const foam = Math.exp(-(((footDistance - 2.8) / 1.5) ** 2)) *
          smooth((noise(x, y, 11) - 0.42) * 4) * (lake ? 0.17 : 0.46);
        if (foam > alpha) { color[0] = 202; color[1] = 226; color[2] = 211; alpha = foam; }
      }
    }
    if (alpha < 0.008) continue;
    for (let c = 0; c < 3; c++) pixels[p + c] = clamp(color[c], 0, 255);
    pixels[p + 3] = alpha * 255;
    paintedPixels++;
  }
  paint.clearRect(0, 0, width, height); paint.putImageData(output, 0, 0);
  ctx.save(); ctx.drawImage(mask, 0, 0); ctx.restore();
  return { paintedPixels, reliefPixels };
}
