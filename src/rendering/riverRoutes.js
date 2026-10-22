import { hash01 } from "../rng.js";

const WATER = "sea";
const idKey = id => `${typeof id}:${id}`;
const pointKey = p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const quadratic = (a, b, c, t) => mix(mix(a, b, t), mix(b, c, t), t);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return distance(p, { x: a.x + dx * t, y: a.y + dy * t });
}

// This is the same quadratic boundary traced by traceSmoothClosedPath, rather
// than the unsmoothed Voronoi polygon used to discover neighboring tiles.
function flatten(poly, step) {
  const points = [];
  for (let i = 0; i < poly.length; i++) {
    const a = mix(poly[(i + poly.length - 1) % poly.length], poly[i], 0.5);
    const b = poly[i], c = mix(b, poly[(i + 1) % poly.length], 0.5);
    const count = Math.max(2, Math.ceil((distance(a, b) + distance(b, c)) / step));
    for (let j = 0; j < count; j++) points.push(quadratic(a, b, c, j / count));
  }
  return points;
}

function inside(p, poly, tolerance = 0) {
  let result = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (tolerance && segmentDistance(p, a, b) <= tolerance) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

function boundaryDistance(point, poly) {
  let nearest = Infinity;
  for (let i = 0; i < poly.length; i++) nearest = Math.min(nearest,
    segmentDistance(point, poly[i], poly[(i + 1) % poly.length]));
  return nearest;
}

function edgeControls(poly, a, b) {
  const nodes = distance(poly[0], poly.at(-1)) < 0.01 ? poly.slice(0, -1) : poly;
  const start = nodes.findIndex(p => pointKey(p) === pointKey(a));
  if (start < 0) return null;
  const alternatives = [1, -1].map(direction => {
    const chain = [nodes[start]];
    for (let i = 1; i < nodes.length; i++) {
      const p = nodes[(start + direction * i + nodes.length) % nodes.length];
      chain.push(p);
      if (pointKey(p) === pointKey(b)) return chain;
    }
    return null;
  }).filter(Boolean).sort((x, y) => x.length - y.length);
  return alternatives[0] ?? null;
}

function portal(edge, seed) {
  const chain = edgeControls(edge.owners[0].poly, edge.a, edge.b);
  if (!chain || chain.length < 3) return null;
  // Keep away from rounded triple junctions. Interior quadratics are identical
  // in both owners and in the visible border network, including reversed edges.
  const position = (0.35 + hash01(seed, "river-crossing", edge.key) * 0.3) * (chain.length - 1);
  const index = Math.max(1, Math.min(chain.length - 2, Math.floor(position + 0.5)));
  const t = Math.max(0.05, Math.min(0.95, position - index + 0.5));
  const a = mix(chain[index - 1], chain[index], 0.5);
  const b = chain[index], c = mix(b, chain[index + 1], 0.5);
  const point = quadratic(a, b, c, t);
  const dx = (b.x - a.x) * (1 - t) + (c.x - b.x) * t;
  const dy = (b.y - a.y) * (1 - t) + (c.y - b.y) * t;
  const length = Math.hypot(dx, dy) || 1;
  return { point, normal: { x: -dy / length, y: dx / length } };
}

function reservations(record, objects, scale) {
  const hard = [];
  const padding = 17 * scale;
  for (const object of objects) {
    if (idKey(object.cellId) !== record.key || object.kind !== "building") continue;
    const ground = object.ground;
    const bounds = object.bounds;
    // Reserve the visible building as well as its foot; tiny grazing animals
    // need only their ground. Trees are thinned by the renderer afterwards.
    if (bounds && !object.animal) hard.push({ x: bounds.x - padding, y: bounds.y - padding,
      width: bounds.width + padding * 2, height: bounds.height + padding * 2 });
    else if (ground) hard.push({ x: ground.x - ground.rx - padding, y: ground.y - ground.ry - padding,
      width: (ground.rx + padding) * 2, height: (ground.ry + padding) * 2 });
  }
  const icon = record.layout?.featureIcon;
  if (icon) hard.push({ x: icon.x - icon.size / 2 - padding, y: icon.y - icon.size / 2 - padding,
    width: icon.size + padding * 2, height: icon.size + padding * 2 });
  hard.sort((a, b) => a.x - b.x || a.y - b.y || a.width - b.width || a.height - b.height);
  return { hard, stack: record.layout?.stack?.rect ?? null };
}

function inRect(p, rect, margin = 0) {
  return p.x >= rect.x - margin && p.x <= rect.x + rect.width + margin &&
    p.y >= rect.y - margin && p.y <= rect.y + rect.height + margin;
}

function addLine(points, a, b, step) {
  const count = Math.max(1, Math.ceil(distance(a, b) / step));
  for (let i = 1; i <= count; i++) points.push(mix(a, b, i / count));
}

function roundedPath(polyline, record, scale) {
  const points = [{ ...polyline[0] }], step = 4 * scale;
  for (let i = 1; i < polyline.length - 1; i++) {
    const before = polyline[i - 1], current = polyline[i], after = polyline[i + 1];
    const radius = Math.min(distance(before, current) * 0.48, distance(current, after) * 0.48, 80 * scale);
    let rounded = false;
    for (const factor of [1, 0.7, 0.45]) {
      const a = mix(current, before, radius * factor / (distance(current, before) || 1));
      const c = mix(current, after, radius * factor / (distance(current, after) || 1));
      const curve = [], count = Math.max(2, Math.ceil((distance(a, current) + distance(current, c)) / step));
      for (let j = 0; j <= count; j++) curve.push(quadratic(a, current, c, j / count));
      if (!curve.every(p => inside(p, record.flat, 0.15) && !record.hard.some(rect => inRect(p, rect)))) continue;
      addLine(points, points.at(-1), a, step);
      points.push(...curve.slice(1)); rounded = true; break;
    }
    if (!rounded) return null;
  }
  addLine(points, points.at(-1), polyline.at(-1), step);
  return points;
}

function innerPoint(record, gate, scale, inset = 36) {
  if (!gate.normal) return gate.point;
  const n = gate.normal;
  const sign = (record.center.x - gate.point.x) * n.x + (record.center.y - gate.point.y) * n.y >= 0 ? 1 : -1;
  for (const amount of [inset, inset * 0.67, inset * 0.33, 3]) {
    const p = { x: gate.point.x + n.x * sign * amount * scale, y: gate.point.y + n.y * sign * amount * scale };
    if (inside(p, record.flat)) return p;
  }
  return gate.point;
}

function routeThroughCell(record, start, end, seed, scale) {
  if (distance(start.point, end.point) < 0.01) return [{ ...start.point }];
  // Prefer one broad, tangent-continuous bend. In a small tile, connecting two
  // short normal stubs with another segment can create a backwards hook even
  // though every individual point is inside the tile.
  const span = distance(start.point, end.point);
  const handle = Math.min(span * (0.4 + hash01(seed, "river-handle", record.key) * 0.12), 105 * scale);
  function control(gate, other) {
    if (gate.normal) return innerPoint(record, gate, scale, handle / scale);
    return mix(gate.point, other.point, Math.min(0.45, handle / span));
  }
  const c1 = control(start, end), c2 = control(end, start), direct = [];
  const samples = Math.max(3, Math.ceil(3 * Math.max(distance(start.point, c1), distance(c1, c2),
    distance(c2, end.point)) / (4 * scale)));
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    direct.push(mix(quadratic(start.point, c1, c2, t), quadratic(c1, c2, end.point, t), t));
  }
  if (direct.every(p => inside(p, record.flat, 0.2) && !record.hard.some(rect => inRect(p, rect)) &&
    (distance(p, start.point) < 24 * scale || distance(p, end.point) < 24 * scale || boundaryDistance(p, record.flat) >= 10 * scale)) &&
    !hasTightTurn(direct, scale)) return direct;
  // Close portals cannot each extend a full 36px into a small tile: their
  // inward handles would pass one another and make a narrow backwards hook.
  const inset = Math.min(54, span * 0.28 / scale);
  const a = innerPoint(record, start, scale, inset), b = innerPoint(record, end, scale, inset);
  const nodes = [a, b, record.center];
  const add = p => { if (inside(p, record.flat) && !record.hard.some(rect => inRect(p, rect))) nodes.push(p); };
  for (let i = 0; i < record.cell.polygon.length; i++) {
    const corner = record.cell.polygon[i], next = record.cell.polygon[(i + 1) % record.cell.polygon.length];
    add(mix(mix(corner, next, 0.5), record.center, 0.22));
    add(mix(corner, record.center, 0.4));
  }
  for (const rect of [...record.hard, ...(record.stack ? [record.stack] : [])]) {
    const gap = 26 * scale;
    for (const x of [rect.x - gap, rect.x + rect.width + gap]) {
      for (const y of [rect.y - gap, rect.y + rect.height + gap]) add({ x, y });
    }
  }
  // A tiny visibility graph lets the stream go around an actual house/icon,
  // rather than merely shifting a straight line through its center.
  const cache = new Map();
  function cost(i, j) {
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    if (cache.has(key)) return cache.get(key);
    const from = nodes[i], to = nodes[j], length = distance(from, to);
    const count = Math.max(1, Math.ceil(length / (6 * scale)));
    let stackSamples = 0, borderPenalty = 0, valid = true;
    for (let k = 0; k <= count; k++) {
      const p = mix(from, to, k / count);
      if (!inside(p, record.flat, 0.15) || record.hard.some(rect => inRect(p, rect))) { valid = false; break; }
      if (record.stack && inRect(p, record.stack, 8 * scale)) stackSamples++;
      if (distance(p, start.point) > 24 * scale && distance(p, end.point) > 24 * scale) {
        borderPenalty += Math.max(0, 1 - boundaryDistance(p, record.flat) / (10 * scale));
      }
    }
    const value = valid ? length * (1 + (0.8 * stackSamples + borderPenalty * 4) / (count + 1)) : Infinity;
    cache.set(key, value);
    return value;
  }
  const costs = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set();
  costs[0] = 0;
  for (let round = 0; round < nodes.length; round++) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (current < 0 || costs[i] < costs[current])) current = i;
    if (current < 0 || !Number.isFinite(costs[current])) return null;
    if (current === 1) break;
    visited.add(current);
    for (let j = 0; j < nodes.length; j++) {
      if (visited.has(j)) continue;
      const next = costs[current] + cost(current, j);
      if (next < costs[j]) { costs[j] = next; previous[j] = current; }
    }
  }
  if (!Number.isFinite(costs[1])) return null;
  const path = [];
  for (let i = 1; i >= 0; i = previous[i]) { path.unshift(nodes[i]); if (i === 0) break; }
  // Even an unobstructed course gets a gentle, seeded bend. It remains inside
  // the same tile; there is no random walk or extra tile crossing.
  if (path.length === 2 && distance(a, b) > 55 * scale) {
    const mid = mix(a, b, 0.5), length = distance(a, b);
    const bend = (hash01(seed, "river-bend", record.key, pointKey(a), pointKey(b)) - 0.5) * Math.min(length * 0.25, 36 * scale);
    const candidate = { x: mid.x - (b.y - a.y) / length * bend, y: mid.y + (b.x - a.x) / length * bend };
    nodes.push(candidate);
    if (cost(0, nodes.length - 1) + cost(nodes.length - 1, 1) < costs[1] * 1.35) path.splice(1, 0, candidate);
  }
  const polyline = [start.point, ...path, end.point].filter((p, i, all) => i === 0 || distance(p, all[i - 1]) > 0.01);
  const length = polyline.slice(1).reduce((sum, p, i) => sum + distance(polyline[i], p), 0);
  if (span > 45 * scale && length > span * 2.1) return null;
  const points = roundedPath(polyline, record, scale);
  if (!points || !points.every(p => inside(p, record.flat, 0.2) && !record.hard.some(rect => inRect(p, rect)))) return null;
  return points;
}

function mountainStart(record, exit, objects, scale) {
  const feet = objects.filter(object => idKey(object.cellId) === record.key &&
    (object.kind === "scenery-image" || object.kind === "fallback-mountain") && !object.forestGroup)
    .map(object => ({ x: object.ground?.x ?? object.x, y: object.ground?.y ?? object.y }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && inside(p, record.flat) && distance(p, exit.point) > 12 * scale)
    .sort((a, b) => distance(a, exit.point) - distance(b, exit.point) || a.x - b.x || a.y - b.y);
  return { point: feet[0] ?? exit.point };
}

function outsidePoint(record, gate, edge, config, scale) {
  // Original frame edges are axis aligned even when their painted curve bends.
  const vertical = Math.abs(edge.a.x - edge.b.x) < Math.abs(edge.a.y - edge.b.y);
  if (vertical) return { x: gate.point.x < record.center.x ? -5 * scale : (config.width || 1400) + 5 * scale, y: gate.point.y };
  return { x: gate.point.x, y: gate.point.y < record.center.y ? -5 * scale : (config.height || 900) + 5 * scale };
}

function hasTightTurn(points, scale) {
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const ab = distance(a, b), bc = distance(b, c), ac = distance(a, c);
    if (ab < 0.05 || bc < 0.05) continue;
    const cross = Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
    const dot = ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (ab * bc);
    if (dot < 0 || (cross > 0.001 && ab * bc * ac / (2 * cross) < 18 * scale)) return true;
  }
  return false;
}

/** Pure scenery planning. No generated tile, layout, object or RNG is changed. */
export function getRiverRoutes(drawnCells, layouts = [], objectItems = [], config = {}) {
  const requested = Number(config.scenerySettings?.riverCount ?? 2);
  const count = Number.isFinite(requested) ? Math.max(0, Math.min(6, Math.round(requested))) : 2;
  if (!count || !drawnCells?.length) return [];
  const scale = Math.max(0.2, Math.min((config.width || 1400) / 1400, (config.height || 900) / 900));
  const seed = config.seed ?? "";
  const records = drawnCells.map(({ cell, poly }, index) => {
    const center = cell.polygon.reduce((p, v) => ({ x: p.x + v.x / cell.polygon.length, y: p.y + v.y / cell.polygon.length }), { x: 0, y: 0 });
    return { cell, poly, center, key: idKey(cell.id), layout: layouts[index], flat: flatten(poly, 4 * scale), links: [], outer: [] };
  }).sort((a, b) => compare(a.key, b.key));
  if (!records.some(record => record.cell.biome === WATER)) return [];
  const edges = new Map();
  for (const record of records) {
    const polygon = record.cell.polygon;
    for (let i = 0; i < polygon.length; i++) {
      let a = polygon[i], b = polygon[(i + 1) % polygon.length];
      if (pointKey(a) > pointKey(b)) [a, b] = [b, a];
      const key = `${pointKey(a)}|${pointKey(b)}`;
      if (!edges.has(key)) edges.set(key, { key, a, b, owners: [] });
      edges.get(key).owners.push(record);
    }
    Object.assign(record, reservations(record, objectItems, scale));
  }
  for (const edge of edges.values()) {
    if (distance(edge.a, edge.b) < 28 * scale) continue;
    edge.gate = portal(edge, seed);
    if (!edge.gate) continue;
    if (edge.owners.length === 1) edge.owners[0].outer.push(edge);
    if (edge.owners.length === 2) for (let i = 0; i < 2; i++) {
      edge.owners[i].links.push({ to: edge.owners[1 - i], edge });
    }
  }
  const candidates = [];
  for (const source of records.filter(record => record.cell.biome !== WATER)) {
    const starts = source.cell.biome === "mountain" ? [{ kind: "mountain" }] :
      source.outer.map(edge => ({ kind: "edge", edge }));
    for (const start of starts) {
      function visit(path, gates) {
        const current = path.at(-1);
        const outlets = current.links.filter(link => link.to.cell.biome === WATER);
        for (const outlet of outlets) {
          if (start.edge === outlet.edge) continue;
          const key = `${start.kind}:${start.edge?.key ?? source.key}:${path.map(record => record.key).join(",")}:${outlet.to.key}`;
          const direction = (outlet.to.center.y - current.center.y) / (distance(outlet.to.center, current.center) || 1);
          const score = Math.abs(path.length - 3) * 0.9 + (path.length === 1 ? 2.5 : 0) +
            (start.kind === "edge" ? 0.5 : 0) + Math.max(0, direction) * 1.2 + hash01(seed, "river-route", key) * 2;
          candidates.push({ key, start, path: [...path], gates: [...gates], outlet, score });
        }
        // Once a course reaches the coast, do not follow it through more tiles
        // merely to manufacture a longer river.
        if (path.length >= 4 || outlets.length) return;
        for (const link of current.links) {
          if (link.to.cell.biome === WATER || link.to.cell.biome === "mountain" || path.includes(link.to)) continue;
          visit([...path, link.to], [...gates, link.edge.gate]);
        }
      }
      visit([source], []);
    }
  }
  candidates.sort((a, b) => a.score - b.score || compare(a.key, b.key));
  const routes = [], used = new Set(), attempted = new Set();
  for (const candidate of candidates) {
    if (routes.length >= count) break;
    if (candidate.path.some(record => used.has(record.key))) continue;
    const signature = candidate.key;
    if (attempted.has(signature)) continue;
    attempted.add(signature);
    const first = candidate.path[0];
    const firstExit = candidate.gates[0] ?? candidate.outlet.edge.gate;
    const sourceGate = candidate.start.kind === "mountain" ? mountainStart(first, firstExit, objectItems, scale) : candidate.start.edge.gate;
    const gates = [sourceGate, ...candidate.gates, candidate.outlet.edge.gate];
    const points = [];
    let valid = true;
    for (let i = 0; i < candidate.path.length; i++) {
      const part = routeThroughCell(candidate.path[i], gates[i], gates[i + 1], seed, scale);
      if (!part) { valid = false; break; }
      points.push(...part.slice(i ? 1 : 0));
    }
    if (!valid || points.length < 2 || hasTightTurn(points, scale)) continue;
    const totalLength = points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
    if (totalLength > Math.max(100 * scale, distance(points[0], points.at(-1)) * 2.6)) continue;
    let sourcePoint = sourceGate.point;
    if (candidate.start.kind === "edge") {
      sourcePoint = outsidePoint(first, sourceGate, candidate.start.edge, config, scale);
      const prefix = [{ ...sourcePoint }];
      addLine(prefix, sourcePoint, sourceGate.point, 4 * scale);
      points.unshift(...prefix.slice(0, -1));
    }
    const mouthPoint = candidate.outlet.edge.gate.point;
    routes.push({ id: `river-${routes.length + 1}`, points,
      cellIds: candidate.path.map(record => record.cell.id),
      source: { kind: candidate.start.kind, cellId: first.cell.id, point: { ...sourcePoint } },
      mouth: { kind: "water", cellId: candidate.outlet.to.cell.id, point: { ...mouthPoint } },
      crossings: candidate.gates.map((gate, index) => ({ fromCellId: candidate.path[index].cell.id,
        toCellId: candidate.path[index + 1].cell.id, point: { ...gate.point } })),
    });
    for (const record of candidate.path) used.add(record.key);
  }
  return routes;
}
