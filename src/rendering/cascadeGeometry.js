import { traceSmoothClosedPath } from "../geometry/polygon.js";
import { riverRibbon } from "./riverRenderer.js";
import { getSideCascadeProfile } from "./cascadeOutletFallback.js";

function surface(reference, config, width, height) {
  if (typeof config.createCanvas === "function") return config.createCanvas(width, height);
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const document = reference.ownerDocument ?? globalThis.document;
  if (!document?.createElement) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  return canvas;
}

function terminalFootprint(ctx, samples, scale) {
  const end = samples.at(-1);
  const tail = samples.filter(point => end.distance - point.distance <= end.halfWidth * 4);
  if (tail.length < 2) return;
  // The rendered channel stops at the mathematical rim; extend its cap only
  // across the antialiased edge so the lip can meet the first solid rock pixel.
  tail.push({ ...end, x: end.x + end.ny * 2 * scale, y: end.y - end.nx * 2 * scale });
  ctx.beginPath();
  tail.forEach((point, index) => {
    const x = point.x + point.nx * point.halfWidth, y = point.y + point.ny * point.halfWidth;
    if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  for (let index = tail.length - 1; index >= 0; index--) {
    const point = tail[index];
    ctx.lineTo(point.x - point.nx * point.halfWidth, point.y - point.ny * point.halfWidth);
  }
  ctx.closePath(); ctx.fillStyle = "white"; ctx.fill();
}

/**
 * Find visible vertical falls from the exact weathered cliff alpha. A rear
 * bank has no rooted face in this view, so it deliberately yields no cascade.
 * All reads and temporary masks stay local to each mouth, even on large maps.
 */
export function getCascadeProfiles(routes = [], drawnCells = [], config = {}, relief) {
  if (!relief?.waterMask || !relief?.cliffMask || !(relief.depth > 0)) return [];
  const { width, height } = relief.waterMask;
  const scale = Math.min(width / 1400, height / 900);
  if (!(scale > 0)) return [];
  const wet = relief.waterMask.getContext("2d"), rock = relief.cliffMask.getContext("2d");
  const profiles = [];
  for (const route of routes) {
    if (route?.mouth?.kind !== "water" || !route.points?.length) continue;
    const destination = drawnCells.find(({ cell }) => cell.biome === "sea" && cell.id === route.mouth.cellId);
    if (!destination?.poly?.length) continue;
    const samples = riverRibbon(route, { ...config, width, height }), end = samples.at(-1);
    if (!end || !Number.isFinite(end.halfWidth) || end.halfWidth <= 0) continue;
    const mouth = route.mouth.point;
    if (!Number.isFinite(mouth?.x) || !Number.isFinite(mouth?.y)) continue;
    const radius = end.halfWidth * 1.6 + 3 * scale;
    const left = Math.max(0, Math.floor(mouth.x - radius));
    const top = Math.max(0, Math.floor(mouth.y - radius - 2));
    const right = Math.min(width, Math.ceil(mouth.x + radius + 1));
    const bottom = Math.min(height, Math.ceil(mouth.y + radius + relief.depth +
      (relief.maxFootProjection ?? 7 * scale) + 3));
    const boxWidth = right - left, boxHeight = bottom - top;
    if (boxWidth < 1 || boxHeight < 1) continue;
    const local = surface(relief.waterMask, config, boxWidth, boxHeight);
    if (!local) continue;
    const paint = local.getContext("2d");
    paint.translate(-left, -top);
    traceSmoothClosedPath(paint, destination.poly); paint.fillStyle = "white"; paint.fill();
    const destinationPixels = paint.getImageData(0, 0, boxWidth, boxHeight).data;
    paint.clearRect(left, top, boxWidth, boxHeight);
    terminalFootprint(paint, samples, scale);
    const channelPixels = paint.getImageData(0, 0, boxWidth, boxHeight).data;
    const waterPixels = wet.getImageData(left, top, boxWidth, boxHeight).data;
    const rockPixels = rock.getImageData(left, top, boxWidth, boxHeight).data;
    const alpha = (pixels, x, y) => y >= top && y < bottom && x >= left && x < right
      ? pixels[((y - top) * boxWidth + x - left) * 4 + 3] : 0;
    const columns = [];
    for (let x = left; x < right; x++) {
      let candidate;
      const lastTop = Math.min(bottom - 1, Math.ceil(mouth.y + radius));
      for (let y = top + 1; y < lastTop; y++) {
        if (alpha(rockPixels, x, y) < 128 || alpha(rockPixels, x, y - 1) >= 128 ||
            alpha(destinationPixels, x, y) < 128 ||
            Math.hypot(x + 0.5 - mouth.x, y - mouth.y) > radius) continue;
        // At a sloping antialiased rim, solid cliff starts a pixel or two below
        // the mathematical shoreline. Look only across that tiny fringe for
        // land connected to the channel, never across an open-water gap.
        let rooted = false;
        for (let rim = y; rim >= Math.max(top, y - Math.ceil(3 * scale + 1)); rim--) {
          if (alpha(waterPixels, x, rim) < 128 && alpha(channelPixels, x, rim) >= 128) {
            rooted = true; break;
          }
        }
        if (!rooted) continue;
        let foot = y;
        while (foot < bottom && alpha(rockPixels, x, foot) >= 128 &&
          alpha(destinationPixels, x, foot) >= 128) foot++;
        // A meaningful connected face must end in this same water region;
        // detached offshore stones cannot be mistaken for a continuation.
        if (foot - y < 6 * scale || alpha(destinationPixels, x, foot) < 128 ||
            alpha(waterPixels, x, foot) < 128) continue;
        const score = Math.hypot(x + 0.5 - mouth.x, y - mouth.y);
        if (!candidate || score < candidate.score) candidate = { x, top: y, bottom: foot, score };
      }
      if (candidate) columns.push(candidate);
    }
    // A narrow headland may expose a second face nearby. Keep only the lip
    // connected to this outlet instead of drawing two unrelated waterfalls.
    const groups = [];
    for (const column of columns) {
      const group = groups.at(-1), previous = group?.at(-1);
      if (previous && column.x === previous.x + 1 &&
          Math.abs(column.top - previous.top) <= Math.max(3, 4 * scale)) group.push(column);
      else groups.push([column]);
    }
    groups.sort((a, b) => Math.min(...a.map(column => column.score)) -
      Math.min(...b.map(column => column.score)) || b.length - a.length);
    const connected = groups[0];
    if (!connected || connected.length < Math.max(2, 3 * scale)) {
      // A side-on lip can be nearly vertical in screen space. Follow the
      // curved shoreline itself instead of requiring several horizontal pixels.
      const side = getSideCascadeProfile(route, drawnCells, config, relief);
      if (side) profiles.push(side);
      continue;
    }
    const cleanColumns = connected.map(({ x, top, bottom }) => ({ x, top, bottom }));
    profiles.push({ id: route.id, waterCellId: destination.cell.id, mouth: { ...mouth },
      width: end.halfWidth * 2, columns: cleanColumns,
      landing: { x: connected.reduce((sum, column) => sum + column.x + 0.5, 0) / connected.length,
        y: connected.reduce((sum, column) => sum + column.bottom, 0) / connected.length } });
  }
  return profiles;
}
