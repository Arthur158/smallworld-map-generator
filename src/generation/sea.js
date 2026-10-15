import { hash01 } from "../rng.js";
import { polygonCentroid } from "../geometry/polygon.js";

const ALL_CORNERS = ["NW", "NE", "SW", "SE"];

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(max, safe));
}

function getWaterScale(config, key) {
  const value = config.waterSettings?.[key];

  // Settings are stored as percentages:
  // 100 = normal, 150 = 1.5x, 70 = 0.7x.
  return clampNumber(value, 100, 40, 240) / 100;
}

function shuffleInPlace(rng, array) {
  const copy = array.slice();

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function selectedCornersFromConfig(config) {
  return ALL_CORNERS.filter((name) => config.seaCorners?.[name]);
}

function localToCorner(corner, width, height, dx, dy) {
  const x = corner.includes("W") ? dx : width - dx;
  const y = corner.includes("N") ? dy : height - dy;

  return { x, y };
}

function buildCornerProfile(corner, seed, width, height, config) {
  const base = Math.min(width, height);

  const seaScale = getWaterScale(config, "seaSize");

  const orientation =
    hash01(seed, "sea-orientation", corner) < 0.5
      ? "horizontal"
      : "vertical";

  const randomScale = 0.9 + hash01(seed, "sea-scale", corner) * 0.38;

  const rx =
    orientation === "horizontal"
      ? base * 0.22 * randomScale * 1.35 * seaScale
      : base * 0.22 * randomScale * 0.88 * seaScale;

  const ry =
    orientation === "vertical"
      ? base * 0.22 * randomScale * 1.35 * seaScale
      : base * 0.22 * randomScale * 0.88 * seaScale;

  return {
    corner,
    orientation,
    rx,
    ry,
    seaScale,
    coastlineNoise: 0.17 + hash01(seed, "sea-noise", corner) * 0.08,
  };
}

function buildLakeProfile(seed, width, height, config) {
  const base = Math.min(width, height);
  const lakeScale = getWaterScale(config, "centerLakeSize");

  const radius = base * 0.12 * lakeScale;

  return {
    x: width * (0.5 + (hash01(seed, "lake-x") - 0.5) * 0.05),
    y: height * (0.5 + (hash01(seed, "lake-y") - 0.5) * 0.05),

    // Used to keep land sites away from the lake.
    exclusionRadius: radius,

    // Used to mark actual Voronoi cells as lake.
    waterRadius: radius * 1.05,

    lakeScale,
  };
}

export function resolveWaterPlan(config, rng, width, height) {
  const requestedCorners = selectedCornersFromConfig(config);
  const cornerCount = requestedCorners.length || 2;

  const activeCorners = config.randomizeSeaCorners
    ? shuffleInPlace(rng, ALL_CORNERS).slice(0, cornerCount)
    : requestedCorners;

  const cornerProfiles = Object.fromEntries(
    activeCorners.map((corner) => [
      corner,
      buildCornerProfile(corner, config.seed, width, height, config),
    ]),
  );

  return {
    activeCorners,
    cornerProfiles,
    centerLake: Boolean(config.centerLake),
    lakeProfile: config.centerLake
      ? buildLakeProfile(config.seed, width, height, config)
      : null,
  };
}

function cornerEllipseScore(x, y, width, height, profile) {
  const localX = profile.corner.includes("W") ? x : width - x;
  const localY = profile.corner.includes("N") ? y : height - y;

  return (localX * localX) / (profile.rx * profile.rx) +
    (localY * localY) / (profile.ry * profile.ry);
}

export function isInsideReservedSeaArea(x, y, width, height, waterPlan) {
  if (!waterPlan) return false;

  for (const corner of waterPlan.activeCorners) {
    const profile = waterPlan.cornerProfiles[corner];
    const score = cornerEllipseScore(x, y, width, height, profile);

    if (score < 1.08) return true;
  }

  return false;
}

export function isInsideReservedLakeArea(x, y, waterPlan) {
  if (!waterPlan?.centerLake || !waterPlan.lakeProfile) return false;

  const dx = x - waterPlan.lakeProfile.x;
  const dy = y - waterPlan.lakeProfile.y;

  return (
    dx * dx + dy * dy <
    waterPlan.lakeProfile.exclusionRadius *
      waterPlan.lakeProfile.exclusionRadius
  );
}

export function makeReservedWaterSites(config, width, height) {
  const waterPlan = config.waterPlan;
  const points = [];
  const seaScale = getWaterScale(config, "seaSize");

  let perCorner = config.tileCount >= 36 ? 2 : 1;

  if (seaScale >= 1.45 && config.tileCount >= 42) {
    perCorner = 3;
  }

  if (seaScale <= 0.7) {
    perCorner = 1;
  }

  // Opt-in board games count final regions, so each requested sea has one
  // reserved site. The default retains its existing multi-cell coastlines.
  if (config.preserveRegionCount === true) perCorner = 1;

  for (const corner of waterPlan.activeCorners) {
    const profile = waterPlan.cornerProfiles[corner];

    const primary = localToCorner(
      corner,
      width,
      height,
      profile.rx * 0.28,
      profile.ry * 0.28,
    );

    points.push({
      ...primary,
      kind: "sea-corner",
      waterKind: "sea",
      corner,
    });

    if (perCorner > 2) {
      const tertiary = profile.orientation === "horizontal"
        ? localToCorner(
            corner,
            width,
            height,
            profile.rx * 0.58,
            profile.ry * 0.58,
          )
        : localToCorner(
            corner,
            width,
            height,
            profile.rx * 0.58,
            profile.ry * 0.58,
          );

      points.push({
        ...tertiary,
        kind: "sea-corner",
        waterKind: "sea",
        corner,
      });
    }

    if (perCorner > 1) {
      const secondary = profile.orientation === "horizontal"
        ? localToCorner(
            corner,
            width,
            height,
            profile.rx * 0.88,
            profile.ry * 0.20,
          )
        : localToCorner(
            corner,
            width,
            height,
            profile.rx * 0.20,
            profile.ry * 0.88,
          );

      points.push({
        ...secondary,
        kind: "sea-corner",
        waterKind: "sea",
        corner,
      });
    }
  }

  if (waterPlan.centerLake && waterPlan.lakeProfile) {
    points.push({
      x: waterPlan.lakeProfile.x,
      y: waterPlan.lakeProfile.y,
      kind: "lake-center",
      waterKind: "lake",
      forceLarge: true,
    });
  }

  return points;
}

export function markSeaCells(cells, config, rng, width, height) {
  const waterPlan = config.waterPlan;

  for (const cell of cells) {
    const centroid = polygonCentroid(cell.polygon);

    if (cell.site.kind === "sea-corner") {
      cell.biome = "sea";
      cell.waterKind = "sea";
      continue;
    }

    if (cell.site.kind === "lake-center") {
      cell.biome = "sea";
      cell.waterKind = "lake";
      continue;
    }

    // In fixed-count mode water is assigned only to its reserved sites.
    // Reclassifying a land centroid would change the requested sea supply.
    if (config.preserveRegionCount === true) continue;

    if (waterPlan.centerLake && waterPlan.lakeProfile) {
      const dx = centroid.x - waterPlan.lakeProfile.x;
      const dy = centroid.y - waterPlan.lakeProfile.y;
      const radius = waterPlan.lakeProfile.waterRadius;

      if (dx * dx + dy * dy < radius * radius) {
        cell.biome = "sea";
        cell.waterKind = "lake";
        continue;
      }
    }

    let shouldBecomeSea = false;

    for (const corner of waterPlan.activeCorners) {
      const profile = waterPlan.cornerProfiles[corner];
      const ellipseScore = cornerEllipseScore(centroid.x, centroid.y, width, height, profile);
      const noise = (hash01(config.seed, "sea-cell-noise", corner, cell.id) - 0.5) * profile.coastlineNoise;

      if (ellipseScore + noise < 0.96) {
        shouldBecomeSea = true;
        break;
      }
    }

    if (shouldBecomeSea) {
      cell.biome = "sea";
      cell.waterKind = "sea";
    }
  }
}


function vertexKeyForMerge(point, precision = 2) {
  return `${point.x.toFixed(precision)},${point.y.toFixed(precision)}`;
}

function edgeKeyForMerge(a, b) {
  const ak = vertexKeyForMerge(a);
  const bk = vertexKeyForMerge(b);

  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function buildEdgeRecords(cells) {
  const records = new Map();

  for (const cell of cells) {
    const poly = cell.polygon;

    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const key = edgeKeyForMerge(a, b);

      if (!records.has(key)) {
        records.set(key, {
          key,
          ownerEdges: [],
        });
      }

      records.get(key).ownerEdges.push({
        ownerId: cell.id,
        a,
        b,
      });
    }
  }

  return records;
}

function getWaterMergeKey(cell) {
  if (cell.biome !== "sea") return null;

  // Corner seas merge with corner seas. Center lakes only merge with lake cells.
  // This keeps an optional center lake separate from corner/coast water.
  return cell.waterKind || "sea";
}

function getWaterAdjacency(cells, edgeRecords) {
  const cellsById = new Map(cells.map((cell) => [cell.id, cell]));
  const adjacency = new Map();

  for (const cell of cells) {
    if (cell.biome === "sea") adjacency.set(cell.id, new Set());
  }

  for (const record of edgeRecords.values()) {
    if (record.ownerEdges.length !== 2) continue;

    const [aEdge, bEdge] = record.ownerEdges;
    const a = cellsById.get(aEdge.ownerId);
    const b = cellsById.get(bEdge.ownerId);

    if (!a || !b) continue;
    if (getWaterMergeKey(a) === null || getWaterMergeKey(b) === null) continue;
    if (getWaterMergeKey(a) !== getWaterMergeKey(b)) continue;

    adjacency.get(a.id)?.add(b.id);
    adjacency.get(b.id)?.add(a.id);
  }

  return adjacency;
}

function getConnectedWaterComponents(cells, edgeRecords) {
  const waterCells = cells.filter((cell) => cell.biome === "sea");
  const waterCellIds = new Set(waterCells.map((cell) => cell.id));
  const adjacency = getWaterAdjacency(cells, edgeRecords);
  const visited = new Set();
  const components = [];

  for (const cell of waterCells) {
    if (visited.has(cell.id)) continue;

    const component = [];
    const stack = [cell.id];
    visited.add(cell.id);

    while (stack.length) {
      const id = stack.pop();
      component.push(id);

      for (const neighbourId of adjacency.get(id) ?? []) {
        if (!waterCellIds.has(neighbourId) || visited.has(neighbourId)) continue;

        visited.add(neighbourId);
        stack.push(neighbourId);
      }
    }

    components.push(component.sort((a, b) => Number(a) - Number(b)));
  }

  return components;
}

function getBoundaryOwnerEdges(componentIds, edgeRecords) {
  const component = new Set(componentIds);
  const boundary = [];

  for (const record of edgeRecords.values()) {
    const ownerEdgesInside = record.ownerEdges.filter((edge) =>
      component.has(edge.ownerId),
    );

    // Exactly one water cell of this component owns this edge, therefore it is
    // part of the outside outline. If two component cells own it, it is an
    // internal border and disappears from the merged tile.
    if (ownerEdgesInside.length === 1) {
      boundary.push(ownerEdgesInside[0]);
    }
  }

  return boundary;
}

function orderBoundaryPolygon(boundaryEdges) {
  if (!boundaryEdges.length) return [];

  const outgoing = new Map();
  const undirected = new Map();
  const pointsByKey = new Map();

  function addUndirected(aKey, bKey) {
    if (!undirected.has(aKey)) undirected.set(aKey, new Set());
    if (!undirected.has(bKey)) undirected.set(bKey, new Set());
    undirected.get(aKey).add(bKey);
    undirected.get(bKey).add(aKey);
  }

  for (const edge of boundaryEdges) {
    const aKey = vertexKeyForMerge(edge.a);
    const bKey = vertexKeyForMerge(edge.b);

    pointsByKey.set(aKey, edge.a);
    pointsByKey.set(bKey, edge.b);
    outgoing.set(aKey, bKey);
    addUndirected(aKey, bKey);
  }

  // First try to use polygon orientation from the original cells. For normal
  // Voronoi cells this usually chains perfectly around the union outline.
  let startKey = vertexKeyForMerge(boundaryEdges[0].a);
  let currentKey = startKey;
  const directedLoop = [];
  const seenDirected = new Set();

  for (let guard = 0; guard <= boundaryEdges.length + 2; guard++) {
    if (seenDirected.has(currentKey)) break;

    directedLoop.push(pointsByKey.get(currentKey));
    seenDirected.add(currentKey);

    const nextKey = outgoing.get(currentKey);
    if (!nextKey) break;

    currentKey = nextKey;
    if (currentKey === startKey) {
      if (directedLoop.length >= 3) return directedLoop;
      break;
    }
  }

  // Fallback: follow the undirected boundary graph. This is less strict about
  // edge orientation, but still works for a single simple outline.
  startKey = [...undirected.keys()][0];
  currentKey = startKey;
  let previousKey = null;
  const loop = [];

  for (let guard = 0; guard <= boundaryEdges.length + 2; guard++) {
    loop.push(pointsByKey.get(currentKey));

    const neighbours = [...(undirected.get(currentKey) ?? [])];
    let nextKey = neighbours.find((key) => key !== previousKey) ?? neighbours[0];

    if (!nextKey) break;

    previousKey = currentKey;
    currentKey = nextKey;

    if (currentKey === startKey) {
      if (loop.length >= 3) return loop;
      break;
    }
  }

  // Last-resort fallback: sort around the centroid. This should rarely be used,
  // but prevents the generator from failing if a weird boundary appears.
  const uniquePoints = [...pointsByKey.values()];
  const center = polygonCentroid(uniquePoints);

  return uniquePoints.sort(
    (a, b) =>
      Math.atan2(a.y - center.y, a.x - center.x) -
      Math.atan2(b.y - center.y, b.x - center.x),
  );
}

function makeMergedWaterCell(componentIds, cellsById, edgeRecords) {
  const sourceCells = componentIds.map((id) => cellsById.get(id));
  const representative = sourceCells[0];
  const boundaryEdges = getBoundaryOwnerEdges(componentIds, edgeRecords);
  const polygon = orderBoundaryPolygon(boundaryEdges);
  const site = polygonCentroid(polygon.length >= 3 ? polygon : representative.polygon);

  return {
    ...representative,
    id: representative.id,
    sourceIds: componentIds,
    site: {
      ...site,
      kind: representative.waterKind === "lake" ? "merged-lake" : "merged-sea",
      waterKind: representative.waterKind || "sea",
    },
    polygon: polygon.length >= 3 ? polygon : representative.polygon,
    biome: "sea",
    waterKind: representative.waterKind || "sea",
    feature: null,
    object: null,
    buildings: [],
    isMergedWater: componentIds.length > 1,
  };
}

function renumberCells(cells) {
  return cells.map((cell, index) => ({
    ...cell,
    originalId: cell.id,
    id: index,
  }));
}

export function mergeAdjacentWaterCells(cells) {
  const edgeRecords = buildEdgeRecords(cells);
  const components = getConnectedWaterComponents(cells, edgeRecords);

  if (!components.some((component) => component.length > 1)) {
    return renumberCells(cells);
  }

  const cellsById = new Map(cells.map((cell) => [cell.id, cell]));
  const consumed = new Set();
  const mergedWaterCells = new Map();

  for (const component of components) {
    if (component.length <= 1) continue;

    const merged = makeMergedWaterCell(component, cellsById, edgeRecords);
    mergedWaterCells.set(component[0], merged);

    for (const id of component) {
      consumed.add(id);
    }
  }

  const output = [];

  for (const cell of cells) {
    if (mergedWaterCells.has(cell.id)) {
      output.push(mergedWaterCells.get(cell.id));
      continue;
    }

    if (consumed.has(cell.id)) continue;

    output.push(cell);
  }

  output.sort((a, b) => Number(a.id) - Number(b.id));

  return renumberCells(output);
}
