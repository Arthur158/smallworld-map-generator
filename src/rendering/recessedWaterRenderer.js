import { traceSmoothClosedPath } from "../geometry/polygon.js";
import { drawBiomeBase } from "./biomeRenderers.js";

function createSurface(ctx, config, width, height) {
  if (typeof config.createCanvas === "function") return config.createCanvas(width, height);
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const document = ctx.canvas?.ownerDocument ?? globalThis.document;
  if (!document?.createElement) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function validRegion(item) {
  return item?.cell && Array.isArray(item.poly) && item.poly.length >= 3 &&
    item.poly.every(point => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function paintUnion(ctx, regions, offsetY = 0) {
  ctx.save();
  ctx.translate(0, offsetY);
  // Shared antialiased edges add to full coverage instead of leaving a faint
  // seam between adjoining regions. No region outline enters the mask.
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "white";
  for (const { poly } of regions) {
    traceSmoothClosedPath(ctx, poly);
    ctx.fill();
  }
  ctx.restore();
}

function maskSurface(ctx, mask) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  // These canvases share exact pixel coordinates. High-quality resampling
  // would soften the mask outward and leak the cliff onto adjacent land.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mask, 0, 0);
  ctx.restore();
}

function sweepLandDown(ctx, land, depth) {
  paintUnion(ctx, land);
  // Sweep every intermediate height, not just a displaced silhouette: a short
  // headland must stay rooted in its own rim instead of hanging below it.
  // Take the maximum coverage, then subtract the original land. Repeated alpha
  // compositing would amplify antialiased edges into spurious vertical walls.
  const { width, height } = ctx.canvas, reach = Math.ceil(depth), stride = reach + 1;
  const values = new Uint8Array(width * stride), rows = new Int32Array(width * stride);
  const heads = new Uint16Array(width), counts = new Uint16Array(width);
  for (let band = 0; band < height; band += 64) {
    const image = ctx.getImageData(0, band, width, Math.min(64, height - band));
    for (let row = 0; row < image.height; row++) for (let x = 0; x < width; x++) {
      const y = band + row, index = (row * width + x) * 4;
      const original = image.data[index + 3], offset = x * stride;
      let head = heads[x], count = counts[x];
      while (count && rows[offset + head] < y - reach) { head = (head + 1) % stride; count--; }
      // Each column keeps a monotone queue: linear work, with only a cliff's
      // height of history rather than another full-size image allocation.
      while (count && values[offset + (head + count - 1) % stride] <= original) count--;
      const tail = offset + (head + count) % stride;
      values[tail] = original; rows[tail] = y; count++;
      image.data[index] = image.data[index + 1] = image.data[index + 2] = 255;
      image.data[index + 3] = values[offset + head] - original;
      heads[x] = head; counts[x] = count;
    }
    ctx.putImageData(image, 0, band);
  }
}

function cliffRuns(ctx, width, height) {
  const starts = new Int32Array(width).fill(-1), runs = [];
  for (let band = 0; band < height; band += 64) {
    const rows = Math.min(64, height - band);
    const pixels = ctx.getImageData(0, band, width, rows).data;
    for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) {
      const solid = pixels[(y * width + x) * 4 + 3] >= 128;
      if (solid && starts[x] < 0) starts[x] = band + y;
      if (!solid && starts[x] >= 0) {
        runs.push({ x, top: starts[x], bottom: band + y });
        starts[x] = -1;
      }
    }
  }
  for (let x = 0; x < width; x++) if (starts[x] >= 0) runs.push({ x, top: starts[x], bottom: height });
  return runs;
}

function roundCliffShoulders(ctx, waterMask, width, height, scale, depth) {
  // Round only existing exposed faces. Expanding the whole land mask would
  // invent cliffs on vertical coasts and on the near bank of a lake.
  const runs = cliffRuns(ctx, width, height);
  ctx.fillStyle = "white";
  for (const { x, top, bottom } of runs) {
    const height = bottom - top;
    if (height < 8 * scale) continue;
    const collar = Math.min(4 * scale, height * 0.18);
    const start = top + collar, span = bottom - start;
    const shoulder = 4 * scale * Math.min(1, height / depth) * 4 / 3;
    ctx.beginPath();
    ctx.moveTo(x, start);
    ctx.bezierCurveTo(x - shoulder, start + span / 3, x - shoulder, bottom - span / 3, x, bottom);
    ctx.lineTo(x + 1, bottom);
    ctx.bezierCurveTo(x + 1 + shoulder, bottom - span / 3, x + 1 + shoulder, start + span / 3, x + 1, start);
    ctx.closePath();
    ctx.fill();
  }
  maskSurface(ctx, waterMask);
}

function shadeCliffRelief(ctx, mask, width, height, scale) {
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  for (const { x, top, bottom } of cliffRuns(mask, width, height)) {
    if (bottom - top < 8 * scale) continue;
    // Light wraps over the upper shoulder and falls away down the rock face.
    // Each column starts at its actual land rim, even along a sloping shore.
    const light = ctx.createLinearGradient(0, top, 0, bottom);
    light.addColorStop(0, "rgba(215,181,135,0.04)");
    light.addColorStop(0.16, "rgba(215,181,135,0.12)");
    light.addColorStop(0.42, "rgba(30,18,10,0)");
    light.addColorStop(0.72, "rgba(17,12,8,0.13)");
    light.addColorStop(1, "rgba(10,8,5,0.28)");
    ctx.fillStyle = light;
    ctx.fillRect(x, top, 1, bottom - top);
  }
  ctx.restore();
}

function paintRock(ctx, image, width, height, scale) {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const tileWidth = 184 * scale;
  const tileHeight = tileWidth * imageHeight / imageWidth;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Reflect adjacent tiles so the opaque material has no abrupt repeat seams.
  // Its scale and orientation are independent of individual border segments.
  for (let row = 0, y = 0; y < height; row++, y += tileHeight) {
    for (let column = 0, x = 0; x < width; column++, x += tileWidth) {
      const flipX = column % 2 === 1;
      const flipY = row % 2 === 1;
      ctx.save();
      ctx.translate(x + (flipX ? tileWidth : 0), y + (flipY ? tileHeight : 0));
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(image, 0, 0, tileWidth, tileHeight);
      ctx.restore();
    }
  }
}

function coastNoise(seed) {
  let salt = 2166136261;
  for (const character of String(seed ?? "")) salt = Math.imul(salt ^ character.charCodeAt(0), 16777619);
  const random = (x, y, channel = 0) => {
    let value = salt ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(channel, 1274126177);
    value = Math.imul(value ^ value >>> 13, 1274126177);
    return ((value ^ value >>> 16) >>> 0) / 4294967296;
  };
  const noise = (x, y, size) => {
    x /= size; y /= size;
    const left = Math.floor(x), top = Math.floor(y), u = x - left, v = y - top;
    // Linear joins give unequal angular shoulders, rather than rounded waves.
    return (random(left, top) * (1 - u) + random(left + 1, top) * u) * (1 - v) +
      (random(left, top + 1) * (1 - u) + random(left + 1, top + 1) * u) * v;
  };
  return { random, noise };
}

function weatherCliffFoot(cliff, waterMask, width, height, scale, seed) {
  const { random, noise } = coastNoise(seed);
  const feet = [], clusters = new Map(), margin = 32;
  const bucketSize = 88 * scale;
  // Read narrow bands instead of retaining another full-resolution RGBA image.
  // Collect all boundaries before adding projections, so new rock cannot grow
  // another foot or change the result according to scan order.
  for (let band = 2; band < height - 1; band += 64) {
    const end = Math.min(height - 1, band + 64), start = band - 2;
    const pixels = cliff.getImageData(0, start, width, end - start + 1).data;
    for (let y = band; y < end; y++) for (let x = margin; x < width - margin; x++) {
      const index = ((y - start) * width + x) * 4 + 3;
      if (pixels[index] < 128 || pixels[index + width * 4] >= 128 ||
          pixels[index - width * 8] < 128 || y < margin || y >= height - margin) continue;
      const projection = (2 + 3.6 * noise(x / scale, y / scale, 37) +
        1.4 * noise(x / scale, y / scale, 11)) * scale;
      const foot = { x, y: y + 1, projection };
      feet.push(foot);
      const bx = Math.floor(x / bucketSize), by = Math.floor(y / bucketSize), key = `${bx}:${by}`;
      const targetX = (bx + random(bx, by, 1)) * bucketSize;
      const targetY = (by + random(bx, by, 2)) * bucketSize;
      const score = (x - targetX) ** 2 + (y - targetY) ** 2;
      if (!clusters.has(key) || score < clusters.get(key).score) clusters.set(key, { ...foot, bx, by, score });
    }
  }
  cliff.fillStyle = "white";
  for (const { x, y, projection } of feet) cliff.fillRect(x, y - 1, 1, projection + 1);
  maskSurface(cliff, waterMask);

  const water = waterMask.getContext("2d"), looseRocks = [];
  for (const { x, y, projection, bx, by } of clusters.values()) {
    if (random(bx, by, 3) > 0.34) continue;
    const count = 1 + (random(bx, by, 4) > 0.52 ? 1 : 0) + (random(bx, by, 5) > 0.9 ? 1 : 0);
    for (let stone = 0; stone < count; stone++) {
      const roll = channel => random(bx, by, 10 + stone * 10 + channel);
      const size = (roll(0) > 0.96 ? 6 : 2 + roll(1) * 3) * scale;
      const radiusX = size / 2, radiusY = radiusX * (0.65 + roll(2) * 0.25);
      const cx = x + (roll(3) - 0.5) * 18 * scale;
      const cy = y + projection + (2 + roll(4) * 5) * scale + radiusY;
      const left = Math.floor(cx - radiusX) - 1, top = Math.floor(cy - radiusY) - 1;
      const boxWidth = Math.ceil(cx + radiusX) - left + 1;
      const boxHeight = Math.ceil(cy + radiusY) - top + 1;
      if (left < margin || top < margin || left + boxWidth > width - margin || top + boxHeight > height - margin) continue;
      const wet = water.getImageData(left, top, boxWidth, boxHeight).data;
      const occupied = cliff.getImageData(left, top, boxWidth, boxHeight).data;
      let clear = true;
      for (let i = 3; i < wet.length; i += 4) if (wet[i] < 255 || occupied[i] > 0) { clear = false; break; }
      if (!clear) continue;
      // A few tiny unequal polygons share the cliff's painted material. They
      // sit wholly in open water, with a gap from both the bank and other rocks.
      cliff.beginPath();
      const rotation = roll(5) * Math.PI * 2;
      for (let vertex = 0; vertex < 6; vertex++) {
        const angle = rotation + vertex * Math.PI / 3;
        const radius = 0.72 + random(bx, by, 100 + stone * 6 + vertex) * 0.28;
        const px = cx + Math.cos(angle) * radiusX * radius;
        const py = cy + Math.sin(angle) * radiusY * radius;
        if (vertex) cliff.lineTo(px, py); else cliff.moveTo(px, py);
      }
      cliff.closePath(); cliff.fill();
      looseRocks.push({ x: cx, y: cy, width: size, height: radiusY * 2 });
    }
  }
  return { looseRocks, looseRockCount: looseRocks.length, maxFootProjection: 7 * scale,
    maxOffshoreReach: 20 * scale };
}

/**
 * Lower water artwork beneath unchanged land and region borders. Call after
 * biome bases, before borders, scenery and markers. Node supplies createCanvas;
 * browser rendering uses OffscreenCanvas or the canvas's owning document.
 */
export function drawRecessedWater(ctx, drawnCells = [], config = {}) {
  const width = Math.ceil(config.width ?? ctx.canvas?.width);
  const height = Math.ceil(config.height ?? ctx.canvas?.height);
  const asset = config.sceneryTextures?.waterCliff;
  const image = asset?.image ?? asset;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      !(image?.naturalWidth || image?.width) || !(image?.naturalHeight || image?.height)) return;

  const regions = drawnCells.filter(validRegion);
  const water = regions.filter(item => item.cell.biome === "sea")
    .sort((a, b) => String(a.cell.id).localeCompare(String(b.cell.id)));
  const land = regions.filter(item => item.cell.biome !== "sea");
  if (!water.length || !land.length) return;

  const scale = Math.min(width / 1400, height / 900);
  const depth = 36 * scale;
  const waterMask = createSurface(ctx, config, width, height);
  const cliffMask = createSurface(ctx, config, width, height);
  const waterSurface = createSurface(ctx, config, width, height);
  const cliffSurface = createSurface(ctx, config, width, height);
  if (!waterMask || !cliffMask || !waterSurface || !cliffSurface) return;

  paintUnion(waterMask.getContext("2d"), water);
  const cliffAlpha = cliffMask.getContext("2d");
  // Only actual land above the recessed water creates a face. This excludes
  // the outer map frame and every internal water-to-water boundary.
  sweepLandDown(cliffAlpha, land, depth);
  maskSurface(cliffAlpha, waterMask);
  roundCliffShoulders(cliffAlpha, waterMask, width, height, scale, depth);
  const weathering = weatherCliffFoot(cliffAlpha, waterMask, width, height, scale, config.seed);

  const lowered = waterSurface.getContext("2d");
  lowered.save();
  lowered.translate(0, depth);
  for (const { cell, poly } of water) {
    drawBiomeBase(lowered, cell, poly, config.seed,
      config.biomeTextures, config.biomeTextureZooms);
  }
  lowered.restore();
  maskSurface(lowered, waterMask);

  const rock = cliffSurface.getContext("2d");
  paintRock(rock, image, width, height, scale);
  maskSurface(rock, cliffMask);
  shadeCliffRelief(rock, cliffAlpha, width, height, scale);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.filter = "none";
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(waterSurface, 0, 0);
  // The painted rock supplies the contact shading. A separate bottom stroke
  // would read as another region border, so the face meets the water directly.
  ctx.drawImage(cliffSurface, 0, 0);
  ctx.restore();
  // Downstream scenery can follow the exact rendered rim and weathered foot,
  // instead of estimating a separate shoreline that may drift onto the land.
  return { depth, waterRegions: water.length, ...weathering, waterMask, cliffMask };
}
