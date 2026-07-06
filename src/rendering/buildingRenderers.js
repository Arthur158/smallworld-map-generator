import { hash01 } from "../rng.js";
import { polygonCentroid } from "../geometry/polygon.js";
import { getBuildingRenderSize } from "./buildingSizeRegistry.js";

const BORDER_MARGIN = 5;
const STACK_MARGIN = 6;
const BUILDING_PLACEMENT_SIZE = 24;

function pointInPolygon(point, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function rectFromCenter(position, size, margin = 0) {
  const finalSize = size + margin * 2;

  return {
    x: position.x - finalSize / 2,
    y: position.y - finalSize / 2,
    width: finalSize,
    height: finalSize,
  };
}

function rectSamplePoints(rect) {
  const { x, y, width, height } = rect;

  return [
    { x, y },
    { x: x + width, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
    { x: x + width / 2, y },
    { x: x + width / 2, y: y + height },
    { x, y: y + height / 2 },
    { x: x + width, y: y + height / 2 },
    { x: x + width / 2, y: y + height / 2 },
  ];
}

function rectInsidePolygon(position, size, polygon) {
  const rect = rectFromCenter(position, size, BORDER_MARGIN);

  return rectSamplePoints(rect).every((point) => pointInPolygon(point, polygon));
}

function circleOverlapsRect(circle, rect) {
  const closestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.width));
  const closestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.height));

  const dx = circle.x - closestX;
  const dy = circle.y - closestY;

  return dx * dx + dy * dy < circle.radius * circle.radius;
}

function overlapsReservedLayout(position, size, layout) {
  if (!layout?.featureIcon) return false;

  const buildingRect = rectFromCenter(position, size, STACK_MARGIN);

  const iconCircle = {
    x: layout.featureIcon.x,
    y: layout.featureIcon.y,
    radius: layout.featureIcon.size / 2 + STACK_MARGIN,
  };

  return circleOverlapsRect(iconCircle, buildingRect);
}

function makeCandidatePositions(centroid, size, index, total, seed, cellId) {
  const candidates = [];
  const phase =
    hash01(seed, "building-phase", cellId, index, total) * Math.PI * 2;

  // Placement offsets from tile center. Intentionally not based strongly on
  // rendered image size, otherwise large buildings get rejected everywhere.
  const rings = [30, 44, 58, 74];

  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    const radius = rings[ringIndex];
    const steps = 10 + ringIndex * 4;

    for (let i = 0; i < steps; i++) {
      const angle = phase + (Math.PI * 2 * i) / steps;

      const jitter =
        0.85 +
        hash01(seed, "building-jitter", cellId, index, ringIndex, i) * 0.3;

      candidates.push({
        x: centroid.x + Math.cos(angle) * radius * jitter,
        y: centroid.y + Math.sin(angle) * radius * 0.72 * jitter,
      });
    }
  }

  return candidates;
}

function findBuildingPlacement(
  poly,
  centroid,
  building,
  filename,
  index,
  total,
  seed,
  cellId,
  layout,
  buildingSettings = {},
) {
  const rawSizeMultiplier = Number(buildingSettings?.sizeMultiplier ?? 1);
  const sizeMultiplier = Number.isFinite(rawSizeMultiplier)
    ? Math.max(0.2, Math.min(3, rawSizeMultiplier))
    : 1;

  const renderSize =
    getBuildingRenderSize(filename, building.scale ?? 1) * sizeMultiplier;

  // Used only to decide whether the building position is valid. Keep small so
  // artwork can intentionally overlap borders and scenery.
  const placementSizes = [
    BUILDING_PLACEMENT_SIZE,
    BUILDING_PLACEMENT_SIZE * 0.85,
    BUILDING_PLACEMENT_SIZE * 0.7,
  ];

  for (const placementSize of placementSizes) {
    const minDistanceFromCenter = Math.min(28, placementSize * 0.55);

    const candidates = makeCandidatePositions(
      centroid,
      placementSize,
      index,
      total,
      seed,
      cellId,
    );

    for (const candidate of candidates) {
      const distanceFromCenter = Math.hypot(
        candidate.x - centroid.x,
        candidate.y - centroid.y,
      );

      if (distanceFromCenter < minDistanceFromCenter) continue;
      if (!rectInsidePolygon(candidate, placementSize, poly)) continue;
      if (overlapsReservedLayout(candidate, placementSize, layout)) continue;

      return {
        position: candidate,
        size: renderSize,
      };
    }
  }

  return null;
}

export function getBuildingDrawItems(
  cell,
  poly,
  seed,
  buildingTextures = {},
  layout = null,
  buildingSettings = {},
) {
  if (!cell.buildings?.length) return [];

  const images = buildingTextures[cell.biome] ?? [];
  if (!images.length) return [];

  const centroid = polygonCentroid(poly);
  const items = [];

  cell.buildings.forEach((building, index) => {
    const imageIndex = Math.floor(
      hash01(seed, "building-image", cell.id, index, cell.biome) * images.length,
    );

    const asset = images[Math.min(imageIndex, images.length - 1)];
    const image = asset?.image ?? asset;
    const filename = asset?.name;

    if (!image) return;

    const placement = findBuildingPlacement(
      poly,
      centroid,
      building,
      filename,
      index,
      cell.buildings.length,
      seed,
      cell.id,
      layout,
      buildingSettings,
    );

    if (!placement) return;

    const { position, size } = placement;

    items.push({
      kind: "building",
      cellId: cell.id,
      image,
      x: position.x,
      y: position.y,
      size,
      // Sort by visual baseline. This lets buildings sit in front of trees
      // behind them, but behind trees/mountains lower in the tile.
      z: position.y + size * 0.28,
    });
  });

  return items;
}

export function drawBuildingItem(ctx, item) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.32)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 4;
  ctx.drawImage(
    item.image,
    item.x - item.size / 2,
    item.y - item.size / 2,
    item.size,
    item.size,
  );
  ctx.restore();
}

export function drawBuildings(
  ctx,
  cell,
  poly,
  seed,
  buildingTextures = {},
  layout = null,
  buildingSettings = {},
) {
  const items = getBuildingDrawItems(
    cell,
    poly,
    seed,
    buildingTextures,
    layout,
    buildingSettings,
  );

  for (const item of items) {
    drawBuildingItem(ctx, item);
  }
}
