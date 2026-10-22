import { hash01 } from "../rng.js";
import { traceSmoothClosedPath } from "../geometry/polygon.js";
import { getCascadeProfiles } from "./cascadeGeometry.js";
import { createRiverWaterStrip } from "./riverRenderer.js";

function surface(ctx, config, width, height) {
  if (typeof config.createCanvas === "function") return config.createCanvas(width, height);
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const document = ctx.canvas?.ownerDocument ?? globalThis.document;
  if (!document?.createElement) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  return canvas;
}

function sheet(profile, route, scale) {
  const columns = profile.columns, first = columns[0], last = columns.at(-1);
  const previous = route.points[Math.max(0, route.points.length - 4)], end = route.points.at(-1);
  const length = Math.hypot(end.x - previous.x, end.y - previous.y) || 1;
  const flow = { x: (end.x - previous.x) / length, y: Math.max(0.3, (end.y - previous.y) / length) };
  const center = (first.x + last.x + 1) / 2, width = last.x - first.x + 1;
  const point = (u, t) => {
    const index = u * (columns.length - 1), a = columns[Math.floor(index)], b = columns[Math.ceil(index)];
    const f = index % 1, top = a.top + (b.top - a.top) * f, bottom = a.bottom + (b.bottom - a.bottom) * f;
    // The current carries the sheet out over the rim. Gravity then pulls it
    // down: a rounded lip, a narrower free-falling waist, and a spreading foot.
    const throwDistance = (6.5 * (1 - Math.exp(-4 * t)) + 2 * t * t) * scale;
    const waist = 1 - 0.25 * Math.sin(Math.PI * t) + 0.10 * Math.sin(Math.min(1, t * 4) * Math.PI) + 0.08 * t ** 5;
    const fringe = (Math.sin(u * 17 + 0.7) * 1.4 + Math.sin(u * 33 + 1.2) * 0.7) * scale * t ** 7;
    return { x: center + (u - 0.5) * width * waist + flow.x * throwDistance,
      y: top - 1.2 * scale + (bottom - top + 1.2 * scale) * t + flow.y * throwDistance + fringe };
  };
  const rows = Array.from({ length: 21 }, (_, row) => Array.from({ length: 17 }, (_, col) => point(col / 16, row / 20)));
  const points = rows.flat();
  return { point, rows, width, left: Math.floor(Math.min(...points.map(p => p.x)) - 10 * scale),
    top: Math.floor(Math.min(...points.map(p => p.y)) - 5 * scale),
    right: Math.ceil(Math.max(...points.map(p => p.x)) + 10 * scale),
    bottom: Math.ceil(Math.max(...points.map(p => p.y)) + 12 * scale) };
}

function outline(ctx, rows) {
  ctx.beginPath();
  rows[0].forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  for (const row of rows.slice(1)) ctx.lineTo(row.at(-1).x, row.at(-1).y);
  for (const point of rows.at(-1).slice(0, -1).reverse()) ctx.lineTo(point.x, point.y);
  for (const row of rows.slice(1, -1).reverse()) ctx.lineTo(row[0].x, row[0].y);
  ctx.closePath();
}

function curve(ctx, geometry, u, from = 0, to = 1) {
  ctx.beginPath();
  for (let step = 0; step <= 24; step++) {
    const point = geometry.point(u, from + (to - from) * step / 24);
    if (step) ctx.lineTo(point.x, point.y); else ctx.moveTo(point.x, point.y);
  }
}

function paintedCurtain(ctx, geometry, strip, profile, config, scale) {
  const { rows, point } = geometry;
  ctx.save(); outline(ctx, rows); ctx.clip();
  const left = point(0, 0.4), right = point(1, 0.4);
  const volume = ctx.createLinearGradient(left.x, left.y, right.x, right.y);
  volume.addColorStop(0, "#286c87"); volume.addColorStop(0.2, "#73c2d0");
  volume.addColorStop(0.45, "#a0d9df"); volume.addColorStop(0.72, "#79c7d5"); volume.addColorStop(1, "#277799");
  ctx.fillStyle = volume; ctx.fill();

  // Deform the river's painted material around the falling sheet, rather than
  // stamping it onto the rock. Each strip follows its own projected surface.
  ctx.globalAlpha = 0.4;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1][0], b = rows[i - 1].at(-1), c = rows[i][0], d = rows[i].at(-1);
    const along = Math.hypot(c.x - a.x, c.y - a.y), across = Math.hypot(b.x - a.x, b.y - a.y);
    if (along < 0.01 || across < 0.01) continue;
    ctx.save(); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.lineTo(d.x, d.y); ctx.lineTo(c.x, c.y); ctx.closePath(); ctx.clip();
    ctx.transform((c.x - a.x) / along, (c.y - a.y) / along,
      (b.x - a.x) / across, (b.y - a.y) / across, a.x, a.y);
    ctx.drawImage(strip, (i * 11) % 512, 0, 16, 64, -0.4 * scale, 0, along + 0.8 * scale, across * 1.03);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  const crown = point(0.5, 0), foot = point(0.5, 1);
  const depth = ctx.createLinearGradient(crown.x, crown.y, foot.x, foot.y);
  depth.addColorStop(0, "rgba(76,159,181,0.35)");
  depth.addColorStop(0.10, "rgba(227,250,239,0.48)");
  depth.addColorStop(0.26, "rgba(210,246,239,0.07)");
  depth.addColorStop(0.65, "rgba(13,72,110,0.08)");
  depth.addColorStop(1, "rgba(224,248,238,0.48)");
  ctx.fillStyle = depth; outline(ctx, rows); ctx.fill();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const count = Math.max(5, Math.round(geometry.width / (2.7 * scale)));
  for (let i = 0; i < count; i++) {
    const roll = salt => hash01(config.seed, "cascade-filament", profile.id, i, salt);
    const u = 0.1 + (i + roll(0) * 0.55) / count * 0.8;
    const from = roll(1) * 0.32, to = 0.58 + roll(2) * 0.42;
    curve(ctx, geometry, u, from, to);
    ctx.lineWidth = (0.5 + roll(3) * 0.8) * scale;
    ctx.strokeStyle = `rgba(235,252,242,${0.36 + roll(4) * 0.37})`; ctx.stroke();
    if (i % 2 === 0) {
      curve(ctx, geometry, Math.min(0.95, u + 0.045), 0.3, 0.9);
      ctx.lineWidth = 0.7 * scale; ctx.strokeStyle = "rgba(25,104,135,0.22)"; ctx.stroke();
    }
  }
  // Let the last part of the sheet dissolve into aerated water. Its lower
  // contour is irregular, and the sea remains visible through the fine fringe.
  ctx.globalCompositeOperation = "destination-out";
  for (let row = 17; row < rows.length - 1; row++) {
    ctx.beginPath();
    rows[row].forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    for (const p of [...rows[row + 1]].reverse()) ctx.lineTo(p.x, p.y);
    ctx.closePath(); ctx.fillStyle = `rgba(0,0,0,${0.13 + (row - 17) * 0.18})`; ctx.fill();
  }
  ctx.restore();
  // A thin lit edge and shaded opposite edge make the sheet read as water
  // with thickness, while leaving the dark rock visible behind its silhouette.
  for (const [u, color, lineWidth] of [[0.035, "rgba(223,248,234,0.63)", 1.0], [0.97, "rgba(26,77,100,0.56)", 1.2]]) {
    curve(ctx, geometry, u, 0.07, 0.9); ctx.strokeStyle = color; ctx.lineWidth = lineWidth * scale; ctx.stroke();
  }
}

function splash(ctx, geometry, profile, config, scale) {
  ctx.lineCap = "round";
  const count = Math.max(14, Math.ceil(geometry.width / scale * 1.2));
  for (let i = 0; i < count; i++) {
    const roll = salt => hash01(config.seed, "cascade-foam", profile.id, i, salt);
    const u = roll(0), point = geometry.point(u, 1);
    const x = point.x + (roll(1) - 0.5) * 5 * scale;
    const y = point.y + (roll(2) - 0.2) * 5 * scale;
    const radius = (0.65 + roll(3) * 2.3) * scale;
    ctx.fillStyle = `rgba(224,249,239,${0.2 + roll(4) * 0.55})`;
    ctx.beginPath(); ctx.ellipse(x, y, radius, radius * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  }
  for (let band = 0; band < 2; band++) {
    ctx.beginPath();
    for (let step = 0; step <= 18; step++) {
      const u = 0.08 + step / 18 * 0.84, p = geometry.point(u, 1);
      const x = p.x + (u - 0.5) * (7 + band * 5) * scale;
      const y = p.y + (3 + band * 4 + Math.sin(u * Math.PI) * 2) * scale;
      if (step) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = band ? "rgba(187,232,229,0.23)" : "rgba(220,246,236,0.38)";
    ctx.lineWidth = 0.65 * scale; ctx.stroke();
  }
}

function localMask(ctx, mask, box, operation = "destination-in") {
  ctx.save(); ctx.resetTransform(); ctx.globalCompositeOperation = operation;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mask, box.left, box.top, box.right - box.left, box.bottom - box.top,
    0, 0, box.right - box.left, box.bottom - box.top);
  ctx.restore();
}

/** Paint projected falling sheets only at visible, rooted river outlets. */
export function drawRiverCascades(ctx, drawnCells, routes, config, relief) {
  if (!routes?.length || !relief?.cliffMask) return;
  const scale = Math.min(config.width / 1400, config.height / 900);
  const profiles = getCascadeProfiles(routes, drawnCells, config, relief);
  for (const profile of profiles) {
    const route = routes.find(item => item.id === profile.id);
    const destination = drawnCells.find(({ cell }) => cell.id === profile.waterCellId);
    const geometry = sheet(profile, route, scale);
    const box = { left: Math.max(0, geometry.left), top: Math.max(0, geometry.top),
      right: Math.min(config.width, geometry.right), bottom: Math.min(config.height, geometry.bottom) };
    const width = box.right - box.left, height = box.bottom - box.top;
    if (width < 1 || height < 1) continue;
    const canvas = surface(ctx, config, width, height), shadows = surface(ctx, config, width, height),
      foam = surface(ctx, config, width, height), curtain = surface(ctx, config, width, height);
    if (!canvas || !shadows || !foam || !curtain) continue;
    const paint = canvas.getContext("2d"), shade = shadows.getContext("2d"), spray = foam.getContext("2d"), falling = curtain.getContext("2d");
    for (const target of [paint, shade, spray, falling]) target.translate(-box.left, -box.top);
    // Cast shadow lies on the rock, offset behind the free-falling water. The
    // sheet itself may project beyond the cliff foot and out into open water.
    shade.save(); shade.translate(3.8 * scale, 2.1 * scale);
    outline(shade, geometry.rows); shade.fillStyle = "rgba(8,25,31,0.56)";
    shade.shadowColor = "rgba(8,25,31,0.3)"; shade.shadowBlur = 2.8 * scale;
    shade.fill(); shade.restore(); localMask(shade, relief.cliffMask, box);
    paint.drawImage(shadows, box.left, box.top);
    paintedCurtain(falling, geometry, createRiverWaterStrip(ctx, config, route), profile, config, scale);
    paint.drawImage(curtain, box.left, box.top);
    splash(spray, geometry, profile, config, scale);
    localMask(spray, relief.cliffMask, box, "destination-out");
    paint.drawImage(foam, box.left, box.top);
    localMask(paint, relief.waterMask, box);
    ctx.save(); traceSmoothClosedPath(ctx, destination.poly); ctx.clip();
    ctx.drawImage(canvas, box.left, box.top); ctx.restore();
  }
}
