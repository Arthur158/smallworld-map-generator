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

function getLayoutFeatureIcons(layout) {
  if (Array.isArray(layout?.featureIcons)) return layout.featureIcons;
  if (layout?.featureIcon) return [layout.featureIcon];
  return [];
}

function getPrimaryFeatureIcon(layout, building) {
  const icons = getLayoutFeatureIcons(layout);
  if (!icons.length) return null;

  // If later you have multi-symbol layout icons with a feature/type field,
  // this keeps the symbol building paired with the right icon.
  if (building?.feature) {
    const matchingIcon = icons.find(
      (icon) => icon.feature === building.feature || icon.type === building.feature,
    );

    if (matchingIcon) return matchingIcon;
  }

  return icons[0];
}

function overlapsReservedLayout(position, size, layout, building) {
  const featureIcons = getLayoutFeatureIcons(layout);
  if (!featureIcons.length) return false;

  const margin = building?.required ? STACK_MARGIN + 8 : STACK_MARGIN;
  const buildingRect = rectFromCenter(position, size, margin);

  return featureIcons.some((featureIcon) => {
    const iconCircle = {
      x: featureIcon.x,
      y: featureIcon.y,
      radius: featureIcon.size / 2 + margin,
    };

    return circleOverlapsRect(iconCircle, buildingRect);
  });
}

function getBuildingAssetsForCell(buildingTextures, biome, feature = null) {
  const biomeTextures = buildingTextures[biome];

  // Backward compatibility with the old format:
  // buildingTextures[biome] = [asset, asset, ...]
  if (Array.isArray(biomeTextures)) {
    return biomeTextures;
  }

  if (!biomeTextures || typeof biomeTextures !== "object") {
    return [];
  }

  // Symbol buildings first try:
  // src/assets/buildings/<biome>/<feature>/
  if (feature && Array.isArray(biomeTextures[feature]) && biomeTextures[feature].length) {
    return biomeTextures[feature];
  }

  // Fallback to normal biome folder:
  // src/assets/buildings/<biome>/
  return biomeTextures.default ?? [];
}

function makeCandidatePositions(
  centroid,
  size,
  index,
  total,
  seed,
  cellId,
  building,
  layout,
) {
  const candidates = [];
  const phase =
    hash01(seed, "building-phase", cellId, index, total, building?.feature ?? "plain") *
    Math.PI * 2;

  // Required symbol buildings are placed around the symbol, not directly under it.
  // This keeps both the icon and the required building visible while still being
  // deterministic and semi-random per tile/seed.
  if (building?.required) {
    const featureIcon = getPrimaryFeatureIcon(layout, building);
    const anchor = featureIcon ?? centroid;

    const requiredRings = [42, 55, 68, 82];
    const preferredAngles = [
      Math.PI / 2,      // below the symbol first; usually most readable
      Math.PI * 0.18,
      Math.PI * 0.82,
      -Math.PI * 0.18,
      -Math.PI * 0.82,
      0,
      Math.PI,
    ];

    for (let ringIndex = 0; ringIndex < requiredRings.length; ringIndex++) {
      const radius = requiredRings[ringIndex];

      for (let i = 0; i < preferredAngles.length; i++) {
        const angle =
          preferredAngles[i] +
          phase * 0.28 +
          (hash01(seed, "required-building-angle", cellId, index, ringIndex, i) - 0.5) *
            0.32;

        const jitter =
          0.9 +
          hash01(seed, "required-building-radius", cellId, index, ringIndex, i) * 0.22;

        candidates.push({
          x: anchor.x + Math.cos(angle) * radius * jitter,
          y: anchor.y + Math.sin(angle) * radius * 0.78 * jitter,
        });
      }
    }
  }

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

  const placementSizes = [
    BUILDING_PLACEMENT_SIZE,
    BUILDING_PLACEMENT_SIZE * 0.85,
    BUILDING_PLACEMENT_SIZE * 0.7,
  ];

  for (const placementSize of placementSizes) {
    const minDistanceFromCenter = building.required
      ? 0
      : Math.min(28, placementSize * 0.55);

    const candidates = makeCandidatePositions(
      centroid,
      placementSize,
      index,
      total,
      seed,
      cellId,
      building,
      layout,
    );

    for (const candidate of candidates) {
      const distanceFromCenter = Math.hypot(
        candidate.x - centroid.x,
        candidate.y - centroid.y,
      );

      if (distanceFromCenter < minDistanceFromCenter) continue;
      if (!rectInsidePolygon(candidate, placementSize, poly)) continue;
      if (overlapsReservedLayout(candidate, placementSize, layout, building)) continue;

      return {
        position: candidate,
        size: renderSize,
      };
    }
  }

  // Last-resort fallback for required symbol buildings. The art may overlap a
  // border, but it is still offset away from the symbol so both remain visible.
  if (building.required) {
    const featureIcon = getPrimaryFeatureIcon(layout, building);
    const phase =
      hash01(seed, "required-building-fallback-phase", cellId, index, building.feature ?? "plain") *
      Math.PI *
      2;

    const anchor = featureIcon ?? centroid;
    const radius = featureIcon ? 62 : 34;
    const angle = Math.PI / 2 + (phase - Math.PI) * 0.22;

    return {
      position: {
        x: anchor.x + Math.cos(angle) * radius,
        y: anchor.y + Math.sin(angle) * radius * 0.78,
      },
      size: renderSize,
    };
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

  const centroid = polygonCentroid(poly);
  const items = [];

  cell.buildings.forEach((building, index) => {
    const images = getBuildingAssetsForCell(
      buildingTextures,
      cell.biome,
      building.feature,
    );

    if (!images.length) {
      console.warn(
        `[buildings] No building image found for ${cell.biome}${
          building.feature ? `/${building.feature}` : ""
        }`,
      );
      return;
    }

    const imageIndex = Math.floor(
      hash01(
        seed,
        "building-image",
        cell.id,
        index,
        cell.biome,
        building.feature ?? "plain",
      ) * images.length,
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
