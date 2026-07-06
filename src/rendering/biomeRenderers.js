import { hash01 } from "../rng.js";
import { polygonCentroid, traceSmoothClosedPath } from "../geometry/polygon.js";

const DEFAULT_TEXTURE_CROP_SIZE = 384;
const MIN_TEXTURE_CROP_SIZE = 48;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getBiomeTextureZoom(cell, biomeTextureZooms) {
  const zoomPercent = Number(biomeTextureZooms?.[cell.biome] ?? 100);

  if (!Number.isFinite(zoomPercent)) return 1;

  // 100 means default crop size.
  // 200 means 2x zoom: crop half as much of the source image.
  // 50 means 0.5x zoom: crop twice as much of the source image.
  return clamp(zoomPercent, 25, 400) / 100;
}

export function polygonBounds(poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of poly) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    minX,
    minY,
    maxX,
    maxY,
  };
}

function clipToTile(ctx, poly) {
  ctx.save();
  traceSmoothClosedPath(ctx, poly);
  ctx.clip();
}

function fillAndClip(ctx, poly, fill) {
  traceSmoothClosedPath(ctx, poly);
  ctx.fillStyle = fill;
  ctx.fill();

  clipToTile(ctx, poly);
}

function getImageDimensions(image) {
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  };
}

function drawImageTexture(ctx, cell, poly, seed, biomeTextures, biomeTextureZooms) {
  const images = biomeTextures?.[cell.biome] ?? [];

  if (!images.length) {
    return false;
  }

  const imageIndex = Math.floor(
    hash01(seed, "texture-image", cell.biome, cell.id) * images.length,
  );

  const asset = images[Math.min(imageIndex, images.length - 1)];
  const image = asset?.image ?? asset;

  if (!image) return false;

  const { width: imageWidth, height: imageHeight } = getImageDimensions(image);

  if (!imageWidth || !imageHeight) return false;

  const zoom = getBiomeTextureZoom(cell, biomeTextureZooms);
  const desiredCropSize = DEFAULT_TEXTURE_CROP_SIZE / zoom;
  const cropSize = clamp(
    desiredCropSize,
    Math.min(MIN_TEXTURE_CROP_SIZE, imageWidth, imageHeight),
    Math.min(imageWidth, imageHeight),
  );

  const maxSx = Math.max(0, imageWidth - cropSize);
  const maxSy = Math.max(0, imageHeight - cropSize);

  const sx = Math.floor(hash01(seed, "texture-sx", cell.biome, cell.id) * maxSx);
  const sy = Math.floor(hash01(seed, "texture-sy", cell.biome, cell.id) * maxSy);

  const bounds = polygonBounds(poly);
  const pad = 10;

  clipToTile(ctx, poly);

  ctx.drawImage(
    image,
    sx,
    sy,
    cropSize,
    cropSize,
    bounds.x - pad,
    bounds.y - pad,
    bounds.width + pad * 2,
    bounds.height + pad * 2,
  );

  ctx.restore();

  return true;
}

export function drawField(ctx, cell, poly, seed) {
  fillAndClip(ctx, poly, "#e7ab2e");

  const c = polygonCentroid(poly);

  for (let i = 0; i < 10; i++) {
    ctx.strokeStyle = "rgba(132, 79, 0, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();

    const y = c.y - 80 + i * 18 + hash01(seed, cell.id, "field", i) * 8;

    ctx.moveTo(c.x - 160, y);
    ctx.lineTo(c.x + 160, y + 30 * Math.sin(i));
    ctx.stroke();
  }

  ctx.restore();
}

export function drawGrass(ctx, cell, poly, seed) {
  fillAndClip(ctx, poly, "#6fc24a");

  const c = polygonCentroid(poly);

  for (let i = 0; i < 11; i++) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();

    const x = c.x - 120 + i * 28;
    const y = c.y + (hash01(seed, cell.id, "hill", i) - 0.5) * 90;

    ctx.arc(x, y, 40, 0.1, Math.PI - 0.1);
    ctx.stroke();
  }

  ctx.restore();
}

export function drawForest(ctx, cell, poly, seed) {
  fillAndClip(ctx, poly, "#1e6b35");

  const c = polygonCentroid(poly);

  for (let i = 0; i < 38; i++) {
    const angle = hash01(seed, cell.id, "treeA", i) * Math.PI * 2;
    const radius = Math.sqrt(hash01(seed, cell.id, "treeR", i)) * 130;
    const x = c.x + Math.cos(angle) * radius;
    const y = c.y + Math.sin(angle) * radius;

    ctx.fillStyle = i % 3 === 0 ? "#0d4022" : "#14552b";
    ctx.beginPath();
    ctx.arc(x, y, 10 + hash01(seed, cell.id, "treeSize", i) * 8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawMountain(ctx, cell, poly, seed) {
  fillAndClip(ctx, poly, "#80889a");

  const c = polygonCentroid(poly);

  for (let i = 0; i < 6; i++) {
    const x = c.x - 90 + i * 38 + (hash01(seed, cell.id, "mx", i) - 0.5) * 24;
    const y = c.y + 55 - hash01(seed, cell.id, "my", i) * 85;
    const size = 55 + hash01(seed, cell.id, "ms", i) * 42;

    ctx.fillStyle = i % 2 ? "#6f7480" : "#9aa2ae";
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x - size * 0.65, y + size * 0.55);
    ctx.lineTo(x + size * 0.75, y + size * 0.55);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x - size * 0.25, y - size * 0.35);
    ctx.lineTo(x + size * 0.15, y - size * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

export function drawSwamp(ctx, cell, poly, seed) {
  fillAndClip(ctx, poly, "#8b6428");

  const c = polygonCentroid(poly);

  for (let i = 0; i < 11; i++) {
    ctx.fillStyle = i % 2 ? "rgba(41, 102, 93, 0.65)" : "rgba(32, 72, 82, 0.65)";
    ctx.beginPath();

    const x = c.x - 105 + hash01(seed, cell.id, "sx", i) * 210;
    const y = c.y - 85 + hash01(seed, cell.id, "sy", i) * 170;

    ctx.ellipse(
      x,
      y,
      28 + hash01(seed, cell.id, "sw", i) * 40,
      8 + hash01(seed, cell.id, "sh", i) * 17,
      hash01(seed, cell.id, "sr", i) * Math.PI,
      0,
      Math.PI * 2,
    );

    ctx.fill();
  }

  ctx.restore();
}

export function drawSea(ctx, cell, poly, seed) {
  fillAndClip(ctx, poly, "#41aee8");

  const c = polygonCentroid(poly);

  for (let i = 0; i < 10; i++) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.38)";
    ctx.lineWidth = 2;
    ctx.beginPath();

    const y = c.y - 85 + i * 20;

    ctx.moveTo(c.x - 135, y);

    for (let x = c.x - 135; x < c.x + 135; x += 18) {
      ctx.quadraticCurveTo(x + 9, y - 9, x + 18, y);
    }

    ctx.stroke();
  }

  ctx.restore();
}

function drawHillBase(ctx, cell, poly, seed, biomeTextures, biomeTextureZooms) {
  const hillCell = { ...cell, biome: "grass" };

  if (drawImageTexture(ctx, hillCell, poly, seed, biomeTextures, biomeTextureZooms)) {
    return;
  }

  drawGrass(ctx, hillCell, poly, seed);
}

export function drawBiomeBase(ctx, cell, poly, seed, biomeTextures, biomeTextureZooms) {
  // Forest keeps the readable hill/grass base while the trees are drawn later.
  if (cell.biome === "forest") {
    drawHillBase(ctx, cell, poly, seed, biomeTextures, biomeTextureZooms);
    return;
  }

  // Mountains go back to using the original mountain biome background.
  // The layered mountain sprites are drawn afterwards on top of that base.
  if (cell.biome === "mountain") {
    if (drawImageTexture(ctx, cell, poly, seed, biomeTextures, biomeTextureZooms)) {
      return;
    }

    drawMountain(ctx, cell, poly, seed);
    return;
  }

  // Preferred path: use an image from src/assets/images/<biome>/.
  // A deterministic random crop is selected per tile.
  if (drawImageTexture(ctx, cell, poly, seed, biomeTextures, biomeTextureZooms)) {
    return;
  }

  // Fallback path: procedural placeholder drawing if no image exists.
  if (cell.biome === "field") drawField(ctx, cell, poly, seed);
  if (cell.biome === "grass") drawGrass(ctx, cell, poly, seed);
  if (cell.biome === "forest") drawForest(ctx, cell, poly, seed);
  if (cell.biome === "mountain") drawMountain(ctx, cell, poly, seed);
  if (cell.biome === "swamp") drawSwamp(ctx, cell, poly, seed);
  if (cell.biome === "sea") drawSea(ctx, cell, poly, seed);
}

// Kept for older imports.
export function drawBiome(ctx, cell, poly, seed, biomeTextures, biomeTextureZooms) {
  drawBiomeBase(ctx, cell, poly, seed, biomeTextures, biomeTextureZooms);
}
