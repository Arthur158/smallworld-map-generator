import { hash01 } from "../rng.js";
import { traceSmoothClosedPath } from "../geometry/polygon.js";

function surface(ctx, config, width, height) {
  if (config.createCanvas) return config.createCanvas(width, height);
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = ctx.canvas.ownerDocument.createElement("canvas");
  canvas.width = width; canvas.height = height;
  return canvas;
}

export function riverRibbon(route, config) {
  const points = route.points ?? [];
  if (points.length < 2) return [];
  const scale = Math.min(config.width / 1400, config.height / 900);
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] +
    Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const length = distances.at(-1);
  if (!length) return [];
  const width = (13 + hash01(config.seed, "river-width", route.id) * 4) * 1.6 * scale;
  const phase = hash01(config.seed, "river-bank-phase", route.id) * Math.PI * 2;
  return points.map((point, i) => {
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
    const dx = after.x - before.x, dy = after.y - before.y, segment = Math.hypot(dx, dy) || 1;
    const progress = distances[i] / length;
    const growth = route.source.kind === "mountain" ? 0.42 + 0.58 * Math.sqrt(progress) : 0.72 + 0.28 * progress;
    const variation = 1 + Math.sin(distances[i] / (31 * scale) + phase) * 0.12 +
      Math.sin(distances[i] / (9 * scale) + phase * 1.7) * 0.055;
    return { ...point, nx: -dy / segment, ny: dx / segment,
      halfWidth: width * growth * variation / 2, distance: distances[i], progress };
  });
}

function ribbonPath(ctx, samples, padding = 0) {
  ctx.beginPath();
  samples.forEach((point, index) => {
    const width = point.halfWidth + padding;
    const x = point.x + point.nx * width, y = point.y + point.ny * width;
    if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  for (let i = samples.length - 1; i >= 0; i--) {
    const point = samples[i], width = point.halfWidth + padding;
    ctx.lineTo(point.x - point.nx * width, point.y - point.ny * width);
  }
  ctx.closePath();
}

export function createRiverWaterStrip(ctx, config, route) {
  const strip = surface(ctx, config, 1024, 64), paint = strip.getContext("2d");
  paint.fillStyle = "#3a99b0"; paint.fillRect(0, 0, 1024, 64);
  const assets = config.biomeTextures?.sea ?? [];
  const asset = assets[Math.floor(hash01(config.seed, "river-water", route.id) * assets.length)];
  const image = asset?.image ?? asset;
  const width = image?.naturalWidth || image?.width, height = image?.naturalHeight || image?.height;
  if (width && height) {
    const cropWidth = Math.min(width, 512), cropHeight = Math.min(height, 96);
    const sx = hash01(config.seed, "river-water-x", route.id) * (width - cropWidth);
    const sy = hash01(config.seed, "river-water-y", route.id) * (height - cropHeight);
    paint.drawImage(image, sx, sy, cropWidth, cropHeight, 0, 0, 256, 64);
    // Reflect the second half: both seams meet the same painted edge. Sampling
    // distance along the channel keeps the brushwork continuous around bends.
    paint.save(); paint.translate(512, 0); paint.scale(-1, 1);
    paint.drawImage(strip, 0, 0, 256, 64, 0, 0, 256, 64); paint.restore();
    paint.drawImage(strip, 0, 0, 512, 64, 512, 0, 512, 64);
    paint.globalCompositeOperation = "multiply";
    paint.fillStyle = "#b3c9b8"; paint.fillRect(0, 0, 1024, 64);
    paint.globalCompositeOperation = "source-over";
  }
  return strip;
}

function drawChannel(ctx, config, route, samples, strip) {
  const scale = Math.min(config.width / 1400, config.height / 900);
  ctx.save();
  ribbonPath(ctx, samples); ctx.clip();
  ctx.fillStyle = "#3a99b0"; ctx.fill();
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], length = b.distance - a.distance;
    if (length < 0.01) continue;
    const halfWidth = Math.max(a.halfWidth, b.halfWidth) + 2 * scale;
    const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
    ctx.save(); ctx.transform(dx, dy, -dy, dx, a.x, a.y);
    // Tiny overlapping slices avoid cracks; the full ribbon clips their sides.
    const sx = (a.distance * 2 / scale) % 512;
    const sourceWidth = Math.min(512, (length + 1) * 2 / scale);
    ctx.drawImage(strip, sx, 0, sourceWidth, 64, -0.5, -halfWidth, length + 1, halfWidth * 2);
    ctx.restore();
  }
  // Broken fine glints and a soft asymmetric bank shadow read as moving water,
  // without a continuous white centre line; outlet foam belongs to the cascade.
  ctx.lineCap = "round";
  for (let side of [-1, 1]) {
    ctx.beginPath();
    samples.forEach((point, index) => {
      const offset = point.halfWidth * side * 0.84;
      const x = point.x + point.nx * offset, y = point.y + point.ny * offset;
      if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.strokeStyle = side < 0 ? "rgba(18,57,57,0.22)" : "rgba(192,229,213,0.18)";
    ctx.lineWidth = 1.0 * scale; ctx.stroke();
  }
  ctx.strokeStyle = "rgba(219,245,232,0.48)"; ctx.lineWidth = 0.7 * scale;
  for (let i = 3; i < samples.length - 3; i += 7) {
    if (hash01(config.seed, "river-glint", route.id, i) > 0.52) continue;
    const a = samples[i], b = samples[Math.min(i + 2, samples.length - 1)];
    const offset = (hash01(config.seed, "river-glint-side", route.id, i) - 0.5) * a.halfWidth;
    ctx.beginPath(); ctx.moveTo(a.x + a.nx * offset, a.y + a.ny * offset);
    ctx.lineTo(b.x + b.nx * offset, b.y + b.ny * offset); ctx.stroke();
  }
  ctx.restore();
}

export function drawRivers(ctx, drawnCells, routes, config) {
  if (!routes?.length) return;
  const { width, height } = config, scale = Math.min(width / 1400, height / 900);
  const canvas = surface(ctx, config, width, height), paint = canvas.getContext("2d");
  const rivers = routes.map(route => ({ route, samples: riverRibbon(route, config) }))
    .filter(item => item.samples.length > 1);
  // All banks precede all water so a joining channel cannot dam the main river.
  for (const { samples } of rivers) {
    ribbonPath(paint, samples, 2.3 * scale);
    paint.fillStyle = "rgba(34,54,28,0.22)"; paint.fill();
    ribbonPath(paint, samples, 0.8 * scale);
    paint.fillStyle = "rgba(123,126,98,0.40)"; paint.fill();
  }
  for (const { route, samples } of rivers) drawChannel(paint, config, route, samples, createRiverWaterStrip(ctx, config, route));

  const land = surface(ctx, config, width, height), mask = land.getContext("2d");
  mask.fillStyle = "white"; mask.globalCompositeOperation = "lighter";
  for (const { cell, poly } of drawnCells) if (cell.biome !== "sea") {
    traceSmoothClosedPath(mask, poly); mask.fill();
  }
  paint.globalCompositeOperation = "destination-in"; paint.imageSmoothingEnabled = false;
  paint.drawImage(land, 0, 0);
  // End the land channel at the rim; the separate cascade renderer carries
  // visible outlets over the recessed-water face.
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(canvas, 0, 0); ctx.restore();
}

function distanceToChannel(point, samples) {
  let distance = Infinity;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    distance = Math.min(distance, Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t) - a.halfWidth);
  }
  return distance;
}

export function protectRiverChannels(items, routes, drawnCells, config) {
  if (!routes?.length) return items;
  const forests = new Set(drawnCells.filter(({ cell }) => cell.biome === "forest").map(({ cell }) => cell.id));
  const channels = routes.map(route => riverRibbon(route, config));
  return items.filter(item => {
    if (!forests.has(item.cellId) || !["scenery-image", "fallback-tree"].includes(item.kind)) return true;
    const foot = { x: item.x, y: item.y - item.height * 0.08 };
    return channels.every(channel => distanceToChannel(foot, channel) > item.width * 0.18 + 3);
  });
}
