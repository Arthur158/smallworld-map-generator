import { hash01 } from "../rng.js";

const FRAME_MARGIN = 32;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const pointKey = point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
const validPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const validRect = rect => rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
const overlaps = (a, b, gap = 0) => a.x < b.x + b.width + gap && a.x + a.width > b.x - gap &&
  a.y < b.y + b.height + gap && a.y + a.height > b.y - gap;

function pointInPolygon(point, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function boundsOf(points) {
  const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y));
  return { x, y, width: Math.max(...points.map(point => point.x)) - x,
    height: Math.max(...points.map(point => point.y)) - y };
}

function sharedCoasts(drawnCells) {
  const segments = new Map(), shores = new Map();
  for (const item of drawnCells) {
    if (!item?.cell || !Array.isArray(item.poly) || item.poly.length < 3 || !item.poly.every(validPoint)) continue;
    for (let i = 0; i < item.poly.length; i++) {
      let a = item.poly[i], b = item.poly[(i + 1) % item.poly.length];
      let ak = pointKey(a), bk = pointKey(b);
      if (ak === bk) continue;
      if (ak > bk) { [a, b] = [b, a]; [ak, bk] = [bk, ak]; }
      const key = `${ak}|${bk}`;
      const segment = segments.get(key) ?? { key, a, b, ak, bk, cells: [] };
      if (!segment.cells.includes(item)) segment.cells.push(item);
      segments.set(key, segment);
    }
  }
  for (const segment of [...segments.values()].sort((a, b) => compare(a.key, b.key))) {
    if (segment.cells.length !== 2) continue;
    const water = segment.cells.find(item => item.cell.biome === "sea");
    const land = segment.cells.find(item => item.cell.biome !== "sea");
    if (!water || !land) continue;
    const key = `${water.cell.id}|${land.cell.id}`;
    const shore = shores.get(key) ?? { key, water, land, segments: [] };
    shore.segments.push(segment);
    shores.set(key, shore);
  }
  return [...shores.values()].sort((a, b) => compare(a.key, b.key));
}

const endsKey = points => [pointKey(points[0]), pointKey(points.at(-1))].sort(compare).join('|');

function alignBorderDirection(chains, borderEdgePaths) {
  const paths = new Map((Array.isArray(borderEdgePaths) ? borderEdgePaths : [])
    .filter(points => Array.isArray(points) && points.length >= 2 && points.every(validPoint))
    .map(points => [endsKey(points), points]));
  return chains.map(chain => {
    const authoritative = paths.get(endsKey(chain.points));
    return authoritative ? { ...chain, points: authoritative } : chain;
  });
}

function coastChains(shore) {
  const vertices = new Map(), remaining = new Set(shore.segments);
  for (const segment of shore.segments) for (const key of [segment.ak, segment.bk]) {
    const edges = vertices.get(key) ?? [];
    edges.push(segment);
    vertices.set(key, edges);
  }
  // Shared borders are quadratic paths, each ending at an original Voronoi
  // vertex. Keep those endpoints when several sides touch the same water cell.
  const originalVertices = new Set((shore.land.cell.polygon ?? []).filter(validPoint).map(pointKey));
  const chains = [];
  while (remaining.size) {
    const keys = [...vertices.keys()].filter(key => vertices.get(key).some(edge => remaining.has(edge))).sort(compare);
    const start = keys.find(key => vertices.get(key).filter(edge => remaining.has(edge)).length === 1) ??
      keys.find(key => originalVertices.has(key)) ?? keys[0];
    let key = start;
    const points = [];
    while (true) {
      const edge = vertices.get(key).find(candidate => remaining.has(candidate));
      if (!edge) break;
      remaining.delete(edge);
      const forward = edge.ak === key;
      if (!points.length) points.push(forward ? edge.a : edge.b);
      points.push(forward ? edge.b : edge.a);
      key = forward ? edge.bk : edge.ak;
      if (key === start || originalVertices.has(key)) break;
    }
    if (points.length >= 2) chains.push({ ...shore, points, key: `${shore.key}|${pointKey(points[0])}|${pointKey(points.at(-1))}` });
  }
  return chains;
}

function waterSide(chain) {
  for (let i = 1; i < chain.points.length; i++) {
    const a = chain.points[i - 1], b = chain.points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-5) continue;
    const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
    for (const distance of [1, 3, 7]) for (const sign of [1, -1]) {
      const water = { x: (a.x + b.x) / 2 + nx * distance * sign, y: (a.y + b.y) / 2 + ny * distance * sign };
      const land = { x: (a.x + b.x) / 2 - nx * distance * sign, y: (a.y + b.y) / 2 - ny * distance * sign };
      if (pointInPolygon(water, chain.water.poly) && pointInPolygon(land, chain.land.poly)) return sign;
    }
  }
  return 0;
}

/** Sample the identical quadratic segments used by traceSmoothOpenPath. */
function sampleBorder(chain) {
  const points = chain.points, side = waterSide(chain);
  if (!side) return [];
  const output = [];
  function quadratic(a, control, b) {
    const steps = Math.max(2, Math.ceil((Math.hypot(control.x - a.x, control.y - a.y) +
      Math.hypot(b.x - control.x, b.y - control.y)) / 2));
    for (let step = output.length ? 1 : 0; step <= steps; step++) {
      const t = step / steps, s = 1 - t;
      const dx = 2 * (s * (control.x - a.x) + t * (b.x - control.x));
      const dy = 2 * (s * (control.y - a.y) + t * (b.y - control.y));
      const length = Math.hypot(dx, dy) || 1;
      output.push({ x: s * s * a.x + 2 * s * t * control.x + t * t * b.x,
        y: s * s * a.y + 2 * s * t * control.y + t * t * b.y,
        nx: -dy / length * side, ny: dx / length * side });
    }
  }
  if (points.length === 2) {
    quadratic(points[0], { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, points[1]);
  } else {
    let start = points[0];
    for (let i = 1; i < points.length - 1; i++) {
      const end = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
      quadratic(start, points[i], end);
      start = end;
    }
    // The final border quadratic is collinear and briefly retraces the line.
    // Sample the same visible edge once so texture triangles do not fold over.
    const end = points.at(-1);
    quadratic(start, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, end);
  }
  let length = 0;
  return output.map((point, index) => {
    if (index) length += Math.hypot(point.x - output[index - 1].x, point.y - output[index - 1].y);
    return { ...point, distance: length };
  });
}

function interpolate(points, distance) {
  const index = points.findIndex(point => point.distance >= distance);
  const b = points[index < 0 ? points.length - 1 : index], a = points[Math.max(0, index - 1)];
  const t = b.distance === a.distance ? 0 : (distance - a.distance) / (b.distance - a.distance);
  const nx = a.nx + (b.nx - a.nx) * t, ny = a.ny + (b.ny - a.ny) * t;
  const length = Math.hypot(nx, ny) || 1;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: nx / length, ny: ny / length };
}

function reservations(layouts) {
  const rectangles = [], circles = [];
  for (const layout of layouts) {
    const stack = layout?.stack;
    const rect = stack?.rect ?? (stack ? { x: stack.x, y: stack.y - stack.size, width: stack.size, height: stack.size } : null);
    if (validRect(rect)) rectangles.push(rect);
    for (const icon of Array.isArray(layout?.featureIcons) ? layout.featureIcons : layout?.featureIcon ? [layout.featureIcon] : []) {
      if ([icon.x, icon.y, icon.size].every(Number.isFinite) && icon.size > 0) circles.push({ x: icon.x, y: icon.y, radius: icon.size / 2 + 6 });
    }
  }
  return { rectangles, circles };
}

function segmentsCross(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function clearsMarkers(bounds, polygons, reserved) {
  for (const original of reserved.rectangles) {
    if (!overlaps(bounds, original, 8)) continue;
    const rect = { x: original.x - 8, y: original.y - 8, width: original.width + 16, height: original.height + 16 };
    const corners = [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }];
    for (const poly of polygons) {
      if (poly.some(point => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) ||
          corners.some(point => pointInPolygon(point, poly))) return false;
      for (let i = 0; i < poly.length; i++) for (let j = 0; j < 4; j++) {
        if (segmentsCross(poly[i], poly[(i + 1) % poly.length], corners[j], corners[(j + 1) % 4])) return false;
      }
    }
  }
  for (const circle of reserved.circles) for (const poly of polygons) {
    if (pointInPolygon(circle, poly)) return false;
    for (let i = 0; i < poly.length; i++) {
      if (distanceToSegment(circle, poly[i], poly[(i + 1) % poly.length]) <= circle.radius) return false;
    }
  }
  return true;
}

const offsetPoint = (point, distance) => ({ x: point.x + point.nx * distance, y: point.y + point.ny * distance });

const smoothstep = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

function coveProfile(distance, cove) {
  if (distance <= cove.start || distance >= cove.end) return 0;
  if (cove.longBeach) {
    const length = cove.end - cove.start;
    return smoothstep((distance - cove.start) / Math.min(28, length * 0.16)) *
      smoothstep((cove.end - distance) / Math.min(34, length * 0.2));
  }
  const peak = cove.start + (cove.end - cove.start) * cove.peak;
  return distance < peak ? smoothstep((distance - cove.start) / (peak - cove.start)) :
    smoothstep((cove.end - distance) / (cove.end - peak));
}

function valueNoise(distance, scale, roll, key) {
  const station = distance / scale, left = Math.floor(station), mix = smoothstep(station - left);
  return roll(`${key}-${left}`) * (1 - mix) + roll(`${key}-${left + 1}`) * mix;
}

function appendGroundPatches(items, chain, sampled, start, end, widthAt, material, roll, reserved, config, label, outsetAt) {
  if (end - start < 22) return;
  const cove = label.startsWith('cove-'), waterOnly = label === 'bank';
  const steps = Math.max(10, Math.ceil((end - start) / 4));
  const stations = Array.from({ length: steps + 1 }, (_, i) => {
    const distance = start + (end - start) * i / steps, shore = interpolate(sampled, distance);
    const width = Math.max(0, widthAt(distance));
    // Cliffs start at the shoreline and extend only into the sea. Beaches
    // retain a shallow landward blend and a separately sized waterward edge.
    const depth = waterOnly ? 0 : width;
    const outset = cove ? Math.min(28, Math.max(0, outsetAt ? outsetAt(distance) : depth * 0.66)) :
      (12 + valueNoise(distance, 43, roll, 'bank-water-edge') * 7) * Math.min(1, width / 14);
    return { shore, distance, depth, outset, inner: offsetPoint(shore, -depth), outer: offsetPoint(shore, outset) };
  });
  const runs = []; let run = [];
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1], b = stations[i];
    const quad = [a.outer, b.outer, b.inner, a.inner], bounds = boundsOf(quad);
    const clear = bounds.x >= FRAME_MARGIN && bounds.y >= FRAME_MARGIN &&
      bounds.x + bounds.width <= config.width - FRAME_MARGIN && bounds.y + bounds.height <= config.height - FRAME_MARGIN &&
      clearsMarkers(bounds, [quad], reserved);
    if (clear) { if (!run.length) run.push(a); run.push(b); }
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  for (const [index, part] of runs.entries()) {
    const span = part.at(-1).distance - part[0].distance;
    if (span < 22 || Math.max(...part.map(station => station.depth + station.outset)) < 7) continue;
    // Obstacles can shorten an otherwise long beach. Slim that surviving
    // stretch proportionally instead of leaving a wide, rounded fragment.
    const beachScale = cove && chain.water.cell.waterKind === 'lake' ?
      Math.min(1, span * 0.30 / Math.max(...part.map(station => station.depth + station.outset))) : 1;
    const taper = part.map(station => Math.min(1,
      (station.distance - part[0].distance) / 9, (part.at(-1).distance - station.distance) / 13));
    const depths = part.map((station, i) => station.depth * taper[i] * beachScale);
    const outsets = part.map((station, i) => station.outset * taper[i] * beachScale);
    const shorePoints = part.map(station => station.shore);
    const inlandPoints = shorePoints.map((point, i) => offsetPoint(point, -depths[i]));
    const waterPoints = shorePoints.map((point, i) => offsetPoint(point, outsets[i]));
    const groundPoly = [...waterPoints, ...inlandPoints.slice().reverse()];
    items.push({ kind: 'coastline', coastType: 'shore-ground', waterOnly,
      id: `shore-ground-${chain.key}-${label}-${index}`, material, waterKind: chain.water.cell.waterKind ?? 'sea',
      waterCellId: chain.water.cell.id, landCellId: chain.land.cell.id, landBiome: chain.land.cell.biome,
      shorePoints, shoreControlPoints: chain.points, inlandPoints, depths, waterPoints, outsets, groundPoly, bounds: boundsOf(groundPoly),
      landClip: chain.land.poly, waterClip: chain.water.poly,
      startDistance: part[0].distance, endDistance: part.at(-1).distance,
      textureOffset: { x: roll('material-x') * 164, y: roll('material-y') * 164 },
      opacity: material === 'gravel' ? 0.79 : material === 'sand' ? 0.94 : 0.92,
      tileSize: 164, z: 0 });
  }
}

function sceneryBounds(objects) {
  return (Array.isArray(objects) ? objects : []).map(item => {
    if (validRect(item?.bounds)) return { ...item.bounds, solid: item.kind !== 'cloud' };
    if (![item?.x, item?.y, item?.width, item?.height].every(Number.isFinite) || item.width <= 0 || item.height <= 0) return null;
    return { x: item.x - item.width / 2, y: item.y - item.height * 0.86,
      width: item.width, height: item.height, solid: false };
  }).filter(Boolean);
}

function exposedGround(item, objects) {
  const nearby = objects.filter(bounds => overlaps(bounds, item.bounds));
  let area = 0, exposed = 0;
  for (let i = 1; i < item.shorePoints.length; i++) {
    const a = item.shorePoints[i - 1], b = item.shorePoints[i];
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const depth = (item.depths[i - 1] + item.depths[i]) / 2;
    const outset = (item.outsets[i - 1] + item.outsets[i]) / 2;
    if (depth + outset < 9) continue;
    // Score exposed ground on both sides, skipping the border. Clouds and
    // scenery can cover the waterward lip as well as the inland part.
    for (let offset = -outset + 2; offset < depth * 0.86; offset += 3) {
      if (Math.abs(offset) < 7) continue;
      const point = { x: (a.x + b.x) / 2 - (a.nx + b.nx) / 2 * offset,
        y: (a.y + b.y) / 2 - (a.ny + b.ny) / 2 * offset };
      const weight = distance * 3;
      area += weight;
      if ((pointInPolygon(point, item.landClip) || pointInPolygon(point, item.waterClip)) && !nearby.some(bounds =>
        point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
        point.y >= bounds.y && point.y <= bounds.y + bounds.height)) exposed += weight;
    }
  }
  return { area: exposed, ratio: area ? exposed / area : 0 };
}

/** Connected shoreline ground reaches a little beyond the border into water. */
export function getCoastlineDrawItems(drawnCells = [], layouts = [], config = {}) {
  if (!Number.isFinite(config.width) || !Number.isFinite(config.height) || config.width <= 64 || config.height <= 64) return [];
  const items = [], reserved = reservations(layouts), objects = sceneryBounds(config.coastObjects);
  // Existing scenery is never moved. Buildings/animals are hard reservations;
  // large terrain artwork only affects which candidate cove is selected.
  const coveReserved = { rectangles: [...reserved.rectangles, ...objects.filter(item => item.solid)], circles: reserved.circles };
  const chains = alignBorderDirection(sharedCoasts(drawnCells).flatMap(coastChains), config.borderEdgePaths);
  const contexts = [], candidates = new Map();
  for (const chain of chains) {
    const roll = key => hash01(config.seed, 'shore-ground-v1', chain.key, key);
    const sampled = sampleBorder(chain), length = sampled.at(-1)?.distance ?? 0;
    if (length < 48) continue;
    const lake = chain.water.cell.waterKind === 'lake', biome = chain.land.cell.biome;
    const soft = ['field', 'grass'].includes(biome), cold = biome === 'mountain';
    const context = { chain, roll, sampled, length, lake, soft, cold, coves: [] }; contexts.push(context);
    // Alpine lake edges can host gravel beaches too, provided the
    // exposure and scenery checks below find enough open shoreline.
    const eligible = lake || (soft && roll('sand-cove') < 0.72);
    if (!eligible || length < 58) continue;
    for (let attempt = 0; attempt < 10; attempt++) {
      const span = Math.min(length - 12, lake ? 170 + roll(`cove-length-${attempt}`) * 90 :
        62 + roll(`cove-length-${attempt}`) * 48);
      const slot = (attempt + roll(`cove-start-${attempt}`)) / 10;
      const start = 6 + slot * Math.max(0, length - span - 12);
      const cove = { start, end: start + span, peak: 0.34 + roll(`cove-peak-${attempt}`) * 0.27,
        longBeach: lake, depth: lake ? Math.min(span * 0.065, 11 + roll(`cove-depth-${attempt}`) * 5) :
          26 + roll(`cove-depth-${attempt}`) * 10 };
      const widthAt = distance => cove.depth * coveProfile(distance, cove) *
        (0.94 + valueNoise(distance, 17, roll, 'cove-grain') * 0.06);
      const waterWidth = Math.min(28, span * 0.24, 24 + roll(`beach-width-${attempt}`) * 4);
      const outsetAt = lake ? distance => waterWidth * coveProfile(distance, cove) *
        (0.88 + valueNoise(distance, 31, roll, 'beach-water-edge') * 0.12) : undefined;
      const patches = [];
      appendGroundPatches(patches, chain, sampled, cove.start, cove.end, widthAt,
        soft || (lake && !cold) ? 'sand' : 'gravel', roll, coveReserved, config, `cove-${attempt}`, outsetAt);
      for (const patch of patches) {
        const patchLength = patch.endDistance - patch.startDistance;
        const patchWidth = Math.max(...patch.depths.map((depth, i) => depth + patch.outsets[i]));
        if (lake ? patchLength < 64 || patchLength < patchWidth * 3 :
            patchLength < 45 || Math.max(...patch.depths) < 24) continue;
        const exposure = exposedGround(patch, objects);
        if (exposure.area < (lake ? Math.min(250, patchLength * 2) : 250) || exposure.ratio < 0.46) continue;
        patch.isCove = true; patch.longBeach = lake;
        patch.exposedGroundArea = exposure.area; patch.exposedGroundRatio = exposure.ratio;
        const group = candidates.get(chain.water.cell.id) ?? [];
        group.push({ context, cove, patch, score: exposure.area * (0.65 + exposure.ratio * 0.35) *
          (soft ? 1.32 : 1) * (0.96 + roll(`cove-rank-${attempt}`) * 0.08) });
        candidates.set(chain.water.cell.id, group);
      }
    }
  }
  for (const pool of candidates.values()) {
    pool.sort((a, b) => b.score - a.score || compare(a.patch.id, b.patch.id));
    const lake = pool[0].context.lake;
    const selected = [], limit = lake ? 3 : 2;
    for (const candidate of pool) {
      if (selected.length >= limit) break;
      if (selected.some(other => other.context.chain.key === candidate.context.chain.key ||
          overlaps(other.patch.bounds, candidate.patch.bounds, lake ? 32 : 48))) continue;
      selected.push(candidate); candidate.context.coves.push(candidate.cove);
      candidate.context.coveItems ??= []; candidate.context.coveItems.push(candidate.patch);
    }
  }
  for (const { chain, sampled, length, roll, lake, soft, cold, coves, coveItems = [] } of contexts) {
    if (!lake) {
      // Long correlated changes produce outcrops, not a parallel uniform strip.
      const widthAt = distance => {
        const broad = valueNoise(distance, 68, roll, 'bank-broad');
        const detail = valueNoise(distance, 17, roll, 'bank-detail');
        const base = cold ? 20 : soft ? 13 : 17;
        const width = base + broad * (cold ? 14 : 12) + (detail - 0.5) * 5;
        const cove = Math.max(0, ...coves.map(patch => coveProfile(distance, patch)));
        return width * (1 - cove * 0.88);
      };
      appendGroundPatches(items, chain, sampled, 2, length - 2, widthAt,
        cold ? 'coldRock' : 'rock', roll, coveReserved, config, 'bank');
    }
    items.push(...coveItems);
  }
  return items;
}

function makeCanvas(ctx, width, height, textures) {
  const factory = textures.createShoreCanvas ?? textures.createCoastCanvas;
  if (factory) return factory(width, height);
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const document = ctx.canvas?.ownerDocument ?? globalThis.document;
  if (!document?.createElement) return null;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}

function traceGround(ctx, shores, inland) {
  ctx.beginPath(); ctx.moveTo(shores[0].x, shores[0].y);
  for (const point of shores.slice(1)) ctx.lineTo(point.x, point.y);
  for (const point of inland.slice().reverse()) ctx.lineTo(point.x, point.y);
  ctx.closePath();
}

function clipShoreRegions(ctx, item) {
  // Cliffs are strictly clipped to the sea, including at region junctions.
  // Beaches share one land/water path so no gap appears with borders hidden.
  ctx.beginPath();
  for (const points of item.waterOnly ? [item.waterClip] : [item.landClip, item.waterClip]) {
    if (!points?.length) continue;
    const first = points[0], second = points[1];
    ctx.moveTo((first.x + second.x) / 2, (first.y + second.y) / 2);
    for (let i = 1; i <= points.length; i++) {
      const current = points[i % points.length], next = points[(i + 1) % points.length];
      ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
    }
    ctx.closePath();
  }
  ctx.clip();
}

/** Draw world-oriented material from the mainland into a shallow waterward lip. */
export function drawCoastlineItem(ctx, item, textures = {}) {
  const asset = textures.shoreMaterials?.[item?.material];
  if (!asset?.image || !validRect(asset.sourceRect) || !item?.landClip?.length || !item?.shorePoints?.length ||
      !item.inlandPoints?.length || !validRect(item.bounds)) return;
  const x = Math.floor(item.bounds.x) - 1, y = Math.floor(item.bounds.y) - 1;
  const width = Math.ceil(item.bounds.x + item.bounds.width) - x + 1;
  const height = Math.ceil(item.bounds.y + item.bounds.height) - y + 1;
  if (width > 4096 || height > 4096 || width * height > 4_000_000) return;
  const surface = makeCanvas(ctx, width, height, textures), mask = makeCanvas(ctx, width, height, textures);
  if (!surface || !mask) return;
  const paint = surface.getContext('2d'), alpha = mask.getContext('2d');
  paint.translate(-x, -y); alpha.translate(-x, -y);
  const tile = item.tileSize, offset = item.textureOffset, source = asset.sourceRect;
  paint.imageSmoothingEnabled = true; paint.imageSmoothingQuality = 'high';
  for (let tx = Math.floor((x - offset.x) / tile) * tile + offset.x; tx < x + width; tx += tile) {
    for (let ty = Math.floor((y - offset.y) / tile) * tile + offset.y; ty < y + height; ty += tile) {
      paint.drawImage(asset.image, source.x, source.y, source.width, source.height, tx, ty, tile, tile);
    }
  }
  if (item.material === 'rock' || item.material === 'coldRock') {
    const middle = item.shorePoints[Math.floor(item.shorePoints.length / 2)];
    const facing = Math.max(0, middle.nx * 0.35 + middle.ny * 0.8);
    // A soft dark contact inside the bank gives its material a little relief.
    // No stroke is added: the existing white boundary remains the only line.
    paint.fillStyle = `rgba(23,28,26,${0.018 + facing * 0.022})`;
    for (let step = 0; step < 7; step++) {
      const fraction = 0.29 + step * 0.065;
      const inner = item.shorePoints.map((point, i) => offsetPoint(point, -item.depths[i] * fraction));
      traceGround(paint, item.waterPoints ?? item.shorePoints, inner); paint.fill();
    }
  }
  // Strong contact across the unchanged boundary, a soft inland transition,
  // and just a 2px feather at the irregular water edge.
  // Additive nested masks avoid seams and do not blur the material's painted detail.
  alpha.globalCompositeOperation = 'lighter'; alpha.fillStyle = 'rgba(255,255,255,0.125)';
  for (let step = 0; step < 8; step++) {
    const fraction = 0.55 + step / 7 * 0.45;
    const inner = item.shorePoints.map((point, i) => offsetPoint(point, -item.depths[i] * fraction));
    const outer = item.outsets ? item.shorePoints.map((point, i) =>
      offsetPoint(point, Math.max(0, item.outsets[i] - (1 - step / 7) * 2))) : item.shorePoints;
    traceGround(alpha, outer, inner); alpha.fill();
  }
  paint.resetTransform(); paint.globalCompositeOperation = 'destination-in'; paint.drawImage(mask, 0, 0);
  ctx.save();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.filter = 'none';
  clipShoreRegions(ctx, item);
  ctx.globalAlpha *= item.opacity; ctx.drawImage(surface, x, y); ctx.restore();
}

export const drawShoreGround = drawCoastlineItem;
