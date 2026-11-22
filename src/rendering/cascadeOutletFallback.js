import { traceSmoothClosedPath } from "../geometry/polygon.js";
import { riverRibbon } from "./riverRenderer.js";

export function cascadeFlow(route) {
  const previous = route.points[Math.max(0, route.points.length - 4)], end = route.points.at(-1);
  const length = Math.hypot(end.x - previous.x, end.y - previous.y) || 1;
  return { x: (end.x - previous.x) / length, y: Math.max(0.3, (end.y - previous.y) / length) };
}

export function cascadeThrow(t, scale) {
  return (6.5 * (1 - Math.exp(-4 * t)) + 2 * t * t) * scale;
}

function surface(reference, config, width, height) {
  if (typeof config.createCanvas === "function") return config.createCanvas(width, height);
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const document = reference.ownerDocument ?? globalThis.document;
  if (!document?.createElement) return null;
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  return canvas;
}

function shoreline(poly, spacing) {
  const points = [];
  for (let i = 1; i <= poly.length; i++) {
    const previous = poly[(i - 1) % poly.length], control = poly[i % poly.length], next = poly[(i + 1) % poly.length];
    const a = { x: (previous.x + control.x) / 2, y: (previous.y + control.y) / 2 };
    const b = { x: (next.x + control.x) / 2, y: (next.y + control.y) / 2 };
    const steps = Math.max(1, Math.ceil((Math.hypot(control.x - a.x, control.y - a.y) + Math.hypot(b.x - control.x, b.y - control.y)) / spacing));
    for (let j = 0; j < steps; j++) {
      const t = j / steps, v = 1 - t;
      const dx = 2 * (v * (control.x - a.x) + t * (b.x - control.x));
      const dy = 2 * (v * (control.y - a.y) + t * (b.y - control.y)), length = Math.hypot(dx, dy) || 1;
      points.push({ x: v * v * a.x + 2 * v * t * control.x + t * t * b.x,
        y: v * v * a.y + 2 * v * t * control.y + t * t * b.y, nx: -dy / length, ny: dx / length });
    }
  }
  return points;
}

function inChannel(point, samples) {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t) <= a.halfWidth + (b.halfWidth - a.halfWidth) * t) return true;
  }
  return false;
}

/** Resolve side-facing lips along the shoreline, including nearly vertical arcs. */
export function getSideCascadeProfile(route, drawnCells, config, relief) {
  if (!relief?.waterMask || !relief?.cliffMask || !(relief.depth > 0) || route?.mouth?.kind !== "water") return;
  const destination = drawnCells.find(({ cell }) => cell.biome === "sea" && cell.id === route.mouth.cellId);
  if (!destination?.poly?.length || !route.points?.length) return;
  const { width, height } = relief.waterMask, scale = Math.min(width / 1400, height / 900);
  if (!(scale > 0)) return;
  const samples = riverRibbon(route, { ...config, width, height }), end = samples.at(-1), mouth = route.mouth.point;
  if (!end || !Number.isFinite(end.halfWidth) || !Number.isFinite(mouth?.x) || !Number.isFinite(mouth?.y)) return;
  const radius = end.halfWidth * 1.6 + 3 * scale, reach = Math.max(1, 4 * scale);
  const left = Math.max(0, Math.floor(mouth.x - radius - reach)), top = Math.max(0, Math.floor(mouth.y - radius - reach));
  const right = Math.min(width, Math.ceil(mouth.x + radius + reach));
  const bottom = Math.min(height, Math.ceil(mouth.y + radius + relief.depth + (relief.maxFootProjection ?? 7 * scale) + 12 * scale));
  if (right <= left || bottom <= top) return;
  const canvas = surface(relief.waterMask, config, right - left, bottom - top);
  if (!canvas) return;
  const ctx = canvas.getContext("2d"); ctx.translate(-left, -top);
  traceSmoothClosedPath(ctx, destination.poly); ctx.fillStyle = "white"; ctx.fill();
  const mask = ctx.getImageData(0, 0, right - left, bottom - top).data;
  const wet = relief.waterMask.getContext("2d").getImageData(left, top, right - left, bottom - top).data;
  const rock = relief.cliffMask.getContext("2d").getImageData(left, top, right - left, bottom - top).data;
  const alpha = (pixels, x, y) => x >= left && x < right && y >= top && y < bottom
    ? pixels[((Math.floor(y) - top) * (right - left) + Math.floor(x) - left) * 4 + 3] : 0;
  const tail = samples.filter(point => end.distance - point.distance <= end.halfWidth * 4);
  const flow = cascadeFlow(route), projection = cascadeThrow(1, scale), points = shoreline(destination.poly, Math.max(0.5, scale));
  const groups = []; let group = [];
  for (const [index, point] of points.entries()) {
    let candidate;
    if (Math.hypot(point.x - mouth.x, point.y - mouth.y) <= radius) {
      for (const sign of [-1, 1]) {
        const nx = point.nx * sign, ny = point.ny * sign, offset = Math.max(1.5, 2 * scale);
        const outside = { x: point.x - nx * offset, y: point.y - ny * offset };
        if (alpha(mask, point.x + nx * offset, point.y + ny * offset) < 128 ||
          alpha(wet, outside.x, outside.y) >= 128 || !inChannel(outside, tail)) continue;
        let face;
        // A steep wall can project to less than one pixel: its visible alpha
        // still matters even when there is no fully opaque interior column.
        for (let d = Math.max(0.25, 0.5 * scale); d <= Math.ceil(reach) && !face; d += Math.max(0.25, 0.5 * scale)) {
          const x = point.x + nx * d, y = point.y + ny * d;
          if (alpha(rock, x, y) >= 24 && alpha(mask, x, y) >= 24) face = { x, y };
        }
        if (!face) continue; // A rear bank has no exposed cliff immediately inside its lip.
        let foot = face.y;
        while (foot < bottom && alpha(rock, face.x, foot) >= 24 && alpha(mask, face.x, foot) >= 24) foot++;
        const landingIsWater = drop => drop >= 6 * scale && alpha(mask, point.x + flow.x * projection, point.y + drop + flow.y * projection) >= 128 &&
          alpha(wet, point.x + flow.x * projection, point.y + drop + flow.y * projection) >= 128 &&
          alpha(rock, point.x + flow.x * projection, point.y + drop + flow.y * projection) < 128;
        let drop = foot - point.y;
        if (!landingIsWater(drop)) {
          drop = relief.depth + (relief.maxFootProjection ?? 7 * scale);
          while (drop >= 6 * scale && !landingIsWater(drop)) drop -= Math.max(0.5, scale);
        }
        let occluded = false;
        if (!landingIsWater(drop)) {
          // Foreground land can hide the landing without hiding the upper
          // curtain. Admit only a continuous, visibly rooted projected face;
          // the destination mask will still occlude its lower sheet and foam.
          drop = relief.depth;
          let exposed = 0, longest = 0;
          for (let step = 0; step <= 36; step++) {
            const t = step / 36, throwDistance = cascadeThrow(t, scale);
            const x = point.x + flow.x * throwDistance, y = point.y + drop * t + flow.y * throwDistance;
            exposed = alpha(mask, x, y) >= 128 && alpha(rock, x, y) >= 24 ? exposed + drop / 36 : 0;
            longest = Math.max(longest, exposed);
          }
          if (longest < 6 * scale) continue;
          occluded = true;
        }
        candidate = { x: point.x, top: point.y, bottom: point.y + drop, index, occluded };
        break;
      }
    }
    if (candidate) group.push(candidate);
    else if (group.length) { groups.push(group); group = []; }
  }
  if (group.length) groups.push(group);
  if (groups.length > 1 && groups[0][0].index === 0 && groups.at(-1).at(-1).index === points.length - 1) groups[0] = [...groups.pop(), ...groups[0]];
  groups.sort((a, b) => Math.min(...a.map(p => Math.hypot(p.x - mouth.x, p.top - mouth.y))) - Math.min(...b.map(p => Math.hypot(p.x - mouth.x, p.top - mouth.y))));
  const connected = groups[0];
  if (!connected || connected.length < 2 || Math.hypot(connected.at(-1).x - connected[0].x, connected.at(-1).top - connected[0].top) < 3 * scale) return;
  const columns = connected.map(({ x, top, bottom }) => ({ x, top, bottom })).sort((a, b) => a.x - b.x || a.top - b.top);
  return { id: route.id, waterCellId: destination.cell.id, mouth: { ...mouth }, width: end.halfWidth * 2,
    lipPoints: true, occludedLanding: connected.some(point => point.occluded), columns,
    landing: { x: columns.reduce((sum, p) => sum + p.x, 0) / columns.length, y: columns.reduce((sum, p) => sum + p.bottom, 0) / columns.length } };
}
