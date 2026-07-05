import {
  buildSharedCurvedGeometry,
  polygonCentroid,
} from "../geometry/polygon.js";

export const STACK_SIZE = 72;
export const FEATURE_ICON_SIZE = 44;

const SERVER_BIOME_BY_GENERATOR_BIOME = {
  field: "Field",
  grass: "Hill",
  forest: "Forest",
  mountain: "Mountain",
  swamp: "Swamp",
  sea: "Water",
};

const SERVER_ATTRIBUTE_BY_FEATURE = {
  magic: "Magic",
  mine: "Mine",
  cave: "Cave",
};

function sortIds(ids) {
  return [...ids].sort((a, b) => Number(a) - Number(b));
}

function vertexKey(point, precision = 2) {
  return `${point.x.toFixed(precision)},${point.y.toFixed(precision)}`;
}

function edgeKey(a, b) {
  const ak = vertexKey(a);
  const bk = vertexKey(b);

  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function flattenCoords(poly) {
  return poly.flatMap((point) => [Math.round(point.x), Math.round(point.y)]);
}

function pointInPolygon(point, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];

    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;

    if (intersects) inside = !inside;
  }

  return inside;
}

function circleOverlapsRect(circle, rect) {
  const closestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.height));

  const dx = circle.x - closestX;
  const dy = circle.y - closestY;

  return dx * dx + dy * dy < circle.radius * circle.radius;
}

function getDistanceFromRect(point, rect) {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  return Math.hypot(point.x - centerX, point.y - centerY);
}

function distancePointToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (!lengthSquared) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
    ),
  );

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return Math.hypot(point.x - projX, point.y - projY);
}

function getMinDistanceToPolygonEdges(point, polygon) {
  let minDistance = Infinity;

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    minDistance = Math.min(minDistance, distancePointToSegment(point, a, b));
  }

  return minDistance;
}

function isCircleSafelyInsidePolygon(circle, polygon, borderMargin = 0) {
  if (!pointInPolygon(circle, polygon)) return false;

  const minEdgeDistance = getMinDistanceToPolygonEdges(circle, polygon);
  return minEdgeDistance >= circle.radius + borderMargin;
}

function getStackRect(stackX, stackY) {
  // StackX/StackY are exported as the bottom-left anchor of a square stack image.
  return {
    x: stackX,
    y: stackY - STACK_SIZE,
    width: STACK_SIZE,
    height: STACK_SIZE,
  };
}

export function computeTileLayout(poly, cell) {
  const centroid = polygonCentroid(poly);

  // Stack anchor is intentionally a bit left and below the visual center.
  // This matches the old handwritten metadata style while leaving room for icons.
  const stackX = Math.round(centroid.x - STACK_SIZE * 0.58);
  const stackY = Math.round(centroid.y + STACK_SIZE * 0.34);
  const stackRect = getStackRect(stackX, stackY);

  const layout = {
    centroid: {
      x: Math.round(centroid.x),
      y: Math.round(centroid.y),
    },
    stack: {
      x: stackX,
      y: stackY,
      size: STACK_SIZE,
      anchor: "bottom-left",
      rect: stackRect,
    },
    featureIcon: null,
  };

  if (!cell.feature) return layout;

  const iconRadius = FEATURE_ICON_SIZE / 2;
  const borderMargin = 6;
  const gap = 14;

  function isValidFeatureCandidate(candidate) {
    const circle = {
      x: candidate.x,
      y: candidate.y,
      radius: iconRadius,
    };

    return (
      isCircleSafelyInsidePolygon(circle, poly, borderMargin) &&
      !circleOverlapsRect(circle, stackRect)
    );
  }

  const candidates = [
    // Prefer right/left of the stack first, so the feature sits "to the side".
    {
      x: stackRect.x + stackRect.width + iconRadius + gap,
      y: stackRect.y + stackRect.height / 2,
    },
    {
      x: stackRect.x - iconRadius - gap,
      y: stackRect.y + stackRect.height / 2,
    },
    {
      x: stackRect.x + stackRect.width / 2,
      y: stackRect.y - iconRadius - gap,
    },
    {
      x: stackRect.x + stackRect.width / 2,
      y: stackRect.y + stackRect.height + iconRadius + gap,
    },
    {
      x: centroid.x + STACK_SIZE * 0.52,
      y: centroid.y + STACK_SIZE * 0.18,
    },
    {
      x: centroid.x - STACK_SIZE * 0.72,
      y: centroid.y + STACK_SIZE * 0.18,
    },
    {
      x: centroid.x + STACK_SIZE * 0.20,
      y: centroid.y - STACK_SIZE * 0.58,
    },
    {
      x: centroid.x,
      y: centroid.y - STACK_SIZE * 0.52,
    },
    {
      x: centroid.x + STACK_SIZE * 0.38,
      y: centroid.y + STACK_SIZE * 0.38,
    },
    {
      x: centroid.x - STACK_SIZE * 0.38,
      y: centroid.y - STACK_SIZE * 0.28,
    },
  ];

  let chosen = candidates.find(isValidFeatureCandidate) ?? null;

  if (!chosen) {
    // Fallback search: probe a small grid around the centroid and keep only
    // positions that remain fully inside the tile and away from the stack.
    const searchPoints = [];
    const searchRadius = Math.max(28, Math.min(STACK_SIZE * 0.9, 56));

    for (let ring = 0; ring <= 4; ring++) {
      const radius = (searchRadius * ring) / 4;
      const steps = ring === 0 ? 1 : 12 + ring * 4;

      for (let i = 0; i < steps; i++) {
        const angle = (Math.PI * 2 * i) / steps;
        searchPoints.push({
          x: centroid.x + Math.cos(angle) * radius,
          y: centroid.y + Math.sin(angle) * radius,
        });
      }
    }

    const validSearchPoints = searchPoints.filter(isValidFeatureCandidate);

    chosen =
      validSearchPoints.sort(
        (a, b) =>
          getDistanceFromRect(b, stackRect) - getDistanceFromRect(a, stackRect),
      )[0] ?? null;
  }

  if (!chosen) {
    // Last fallback: keep it inside the polygon and away from the border even
    // if the tile is cramped. This still prefers the safest point near the
    // centroid instead of allowing the icon to spill over the edge.
    const fallbackCandidates = [
      { x: centroid.x, y: centroid.y },
      { x: centroid.x + 18, y: centroid.y },
      { x: centroid.x - 18, y: centroid.y },
      { x: centroid.x, y: centroid.y + 18 },
      { x: centroid.x, y: centroid.y - 18 },
    ].filter((candidate) => {
      const circle = {
        x: candidate.x,
        y: candidate.y,
        radius: iconRadius,
      };

      return (
        pointInPolygon(candidate, poly) &&
        !circleOverlapsRect(circle, stackRect)
      );
    });

    chosen =
      fallbackCandidates.sort(
        (a, b) =>
          getMinDistanceToPolygonEdges(b, poly) - getMinDistanceToPolygonEdges(a, poly),
      )[0] ?? { x: centroid.x, y: centroid.y };
  }

  layout.featureIcon = {
    type: cell.feature,
    serverType: SERVER_ATTRIBUTE_BY_FEATURE[cell.feature] ?? cell.feature,
    x: Math.round(chosen.x),
    y: Math.round(chosen.y),
    size: FEATURE_ICON_SIZE,
  };

  return layout;
}

export function computeAdjacency(cells) {
  const edgeOwners = new Map();
  const adjacency = Object.fromEntries(cells.map((cell) => [cell.id, new Set()]));

  for (const cell of cells) {
    const poly = cell.polygon;

    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const key = edgeKey(a, b);

      if (!edgeOwners.has(key)) {
        edgeOwners.set(key, []);
      }

      edgeOwners.get(key).push(cell.id);
    }
  }

  for (const owners of edgeOwners.values()) {
    if (owners.length !== 2) continue;

    const [a, b] = owners;

    adjacency[a].add(b);
    adjacency[b].add(a);
  }

  return Object.fromEntries(
    Object.entries(adjacency).map(([id, neighbours]) => [
      id,
      sortIds([...neighbours]),
    ]),
  );
}

function isEdgeTile(cell, config) {
  if (cell.biome === "sea") return true;

  const boundsPadding = 20;
  const epsilon = 2;

  return cell.polygon.some(
    (point) =>
      point.x <= boundsPadding + epsilon ||
      point.y <= boundsPadding + epsilon ||
      point.x >= config.width - boundsPadding - epsilon ||
      point.y >= config.height - boundsPadding - epsilon,
  );
}

function makeServerTile(cell, config, adjacency) {
  const biome = SERVER_BIOME_BY_GENERATOR_BIOME[cell.biome] ?? cell.biome;

  const attributes = cell.feature
    ? [SERVER_ATTRIBUTE_BY_FEATURE[cell.feature] ?? cell.feature]
    : [];

  return {
    id: String(cell.id),
    biome,
    attributes,
    isEdge: isEdgeTile(cell, config),
    adjacentIds: adjacency[cell.id] ?? [],
  };
}

function makeGraphicsTile(item, layout) {
  const coords = flattenCoords(item.poly);

  return {
    ID: String(item.cell.id),
    Polygon: {
      Coords: coords,
      StackX: layout.stack.x,
      StackY: layout.stack.y,
      StackAnchor: layout.stack.anchor,
      StackSize: layout.stack.size,
      FeatureIcon: layout.featureIcon
        ? {
            Type: layout.featureIcon.serverType,
            X: layout.featureIcon.x,
            Y: layout.featureIcon.y,
            Size: layout.featureIcon.size,
          }
        : null,
    },
  };
}

export function createMapMetadata(cells, config) {
  const { drawnCells } = buildSharedCurvedGeometry(
    cells,
    config.wobble,
    config.seed,
  );

  const adjacency = computeAdjacency(cells);

  const layoutsById = {};
  const graphicsTiles = [];
  const serverTiles = [];

  for (const item of drawnCells) {
    const layout = computeTileLayout(item.poly, item.cell);
    layoutsById[item.cell.id] = layout;

    graphicsTiles.push(makeGraphicsTile(item, layout));
    serverTiles.push(makeServerTile(item.cell, config, adjacency));
  }

  graphicsTiles.sort((a, b) => Number(a.ID) - Number(b.ID));
  serverTiles.sort((a, b) => Number(a.id) - Number(b.id));

  return {
    version: 1,
    seed: config.seed,
    canvas: {
      width: config.width,
      height: config.height,
    },
    server: {
      tiles: serverTiles,
    },
    graphics: {
      OffsetStacks: 1 / 100,
      Xmult: 1,
      Ymult: 1,
      StackAnchor: "bottom-left",
      StackSize: STACK_SIZE,
      FeatureIconSize: FEATURE_ICON_SIZE,
      Tiles: graphicsTiles,
    },
    layoutsById,
  };
}

function formatGoAttributes(attributes) {
  if (!attributes.length) return "[]Attribute{}";

  return `[]Attribute{${attributes.join(", ")}}`;
}

function formatGoTile(tile) {
  const fields = [
    `Id: "${tile.id}"`,
    `Biome: ${tile.biome}`,
    `Attributes: ${formatGoAttributes(tile.attributes)}`,
  ];

  if (tile.isEdge) {
    fields.push("IsEdge: true");
  }

  return `        "${tile.id}": {${fields.join(", ")}},`;
}

function formatAdjacencyLine(tile) {
  const refs = tile.adjacentIds.map((id) => `tileMap["${id}"]`).join(", ");

  return `    tileMap["${tile.id}"].AdjacentTiles = []*Tile{${refs}}`;
}

export function generateGoMapFunction(metadata, functionName = "GeneratedMap") {
  const tiles = metadata.server.tiles;

  return `func ${functionName}(gs *GameState) map[string]*Tile {
    // Generated by the browser map generator.
    // This contains only map topology/metadata. Game-specific setup
    // such as Lost Tribe placement can be added after this block.

    tileMap := map[string]*Tile{
${tiles.map(formatGoTile).join("\n")}
    }

    for key := range tileMap {
        tileMap[key].ModifierDefenses = make(map[string]func(*Tile, *GameState) (int, int, int, error))
        tileMap[key].ModifierAfterConquest = make(map[string]func(*Tile, *Tribe, *GameState))
        tileMap[key].ModifierSpecialDefenses = make(map[string]func(*Tile, *GameState, *Tribe, string) (bool, error))
        tileMap[key].ModifierPoints = make(map[string]func(*Tile) int)
        tileMap[key].State = make(map[string]interface{})
    }

${tiles.map(formatAdjacencyLine).join("\n")}

    result := make(map[string]*Tile, len(tileMap))
    for id, tile := range tileMap {
        result[id] = tile
    }

    return result
}
`;
}

function jsString(value) {
  return `'${String(value).replaceAll("'", "\\'")}'`;
}

function formatJsArray(values, indent = "        ") {
  const chunks = [];
  const perLine = 12;

  for (let i = 0; i < values.length; i += perLine) {
    chunks.push(`${indent}${values.slice(i, i + perLine).join(", ")}`);
  }

  return chunks.join(",\n");
}

function formatGraphicsTile(tile) {
  const feature = tile.Polygon.FeatureIcon
    ? `{
          Type: ${jsString(tile.Polygon.FeatureIcon.Type)},
          X: ${tile.Polygon.FeatureIcon.X},
          Y: ${tile.Polygon.FeatureIcon.Y},
          Size: ${tile.Polygon.FeatureIcon.Size},
        }`
    : "null";

  return `    {
      ID: ${jsString(tile.ID)},
      Polygon: {
        Coords: [
${formatJsArray(tile.Polygon.Coords)}
        ],
        StackX: ${tile.Polygon.StackX},
        StackY: ${tile.Polygon.StackY},
        StackAnchor: ${jsString(tile.Polygon.StackAnchor)},
        StackSize: ${tile.Polygon.StackSize},
        FeatureIcon: ${feature},
      },
    },`;
}

export function generateGraphicsJsObject(metadata, constName = "generatedMapGraphics") {
  const graphics = metadata.graphics;

  return `export const ${constName} = {
  OffsetStacks: ${graphics.OffsetStacks},
  Xmult: ${graphics.Xmult},
  Ymult: ${graphics.Ymult},
  StackAnchor: ${jsString(graphics.StackAnchor)},
  StackSize: ${graphics.StackSize},
  FeatureIconSize: ${graphics.FeatureIconSize},
  Tiles: [
${graphics.Tiles.map(formatGraphicsTile).join("\n")}
  ],
};
`;
}
