import { hash01 } from "../rng.js";
import { polygonCentroid } from "../geometry/polygon.js";
import { polygonBounds } from "./biomeRenderers.js";
import { drawBuildingItem, getBuildingDrawItems } from "./buildingRenderers.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

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

function getPercentScale(value, fallback, min = 30, max = 220) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : fallback;

  return clamp(safe, min, max) / 100;
}

function chooseForestAssetPool(sceneryTextures, seed, cellId) {
  const forests = sceneryTextures?.forests ?? {};
  const pine = forests.pine ?? [];
  const normal = forests.normal ?? [];

  // IMPORTANT: choose pine OR normal once per tile.
  // Do not choose per object, otherwise one forest tile becomes mixed.
  const preferredGroup =
    hash01(seed, "forest-tile-kind", cellId) < 0.5 ? "pine" : "normal";

  const fallbackGroup = preferredGroup === "pine" ? "normal" : "pine";

  const preferredAssets = preferredGroup === "pine" ? pine : normal;
  const fallbackAssets = fallbackGroup === "pine" ? pine : normal;

  if (preferredAssets.length) {
    return { group: preferredGroup, assets: preferredAssets };
  }

  if (fallbackAssets.length) {
    return { group: fallbackGroup, assets: fallbackAssets };
  }

  // No images in either folder yet. Still return the chosen group so fallback
  // drawing stays deterministic and each tile remains purely pine or normal.
  return { group: preferredGroup, assets: [] };
}

function getMountainAssets(sceneryTextures) {
  return sceneryTextures?.mountains ?? [];
}

function makeLayeredObjectPositions({
  cell,
  poly,
  seed,
  baseSize,
  jitterKey,
  startOverflowFactor,
  bottomPadFactor,
  horizontalDensityFactor,
}) {
  const bounds = polygonBounds(poly);
  const positions = [];

  const rowStep = baseSize * 0.48;
  const colStep = baseSize * horizontalDensityFactor;
  const topY = bounds.y - baseSize * startOverflowFactor;
  const bottomY = bounds.y + bounds.height + baseSize * bottomPadFactor;

  let row = 0;

  for (let y = topY; y <= bottomY; y += rowStep) {
    const rowOffset = row % 2 ? colStep * 0.5 : 0;
    const drift = (hash01(seed, jitterKey, cell.id, "row-drift", row) - 0.5) * baseSize * 0.35;

    let col = 0;

    for (
      let x = bounds.x - baseSize * 0.25 + rowOffset + drift;
      x <= bounds.x + bounds.width + baseSize * 0.25;
      x += colStep
    ) {
      const jitterX = (hash01(seed, jitterKey, cell.id, row, col, "x") - 0.5) * baseSize * 0.28;
      const jitterY = (hash01(seed, jitterKey, cell.id, row, col, "y") - 0.5) * baseSize * 0.18;

      const anchor = {
        x: x + jitterX,
        y: y + jitterY,
      };

      // The anchor is the visual baseline/foot. Allow the first rows to start
      // high so the tops overflow the tile, but require the baseline or a lower
      // point to be inside the polygon so objects stay connected to the tile.
      const baselineInside = pointInPolygon(anchor, poly);
      const lowerInside = pointInPolygon(
        { x: anchor.x, y: anchor.y + baseSize * 0.22 },
        poly,
      );

      if (baselineInside || lowerInside) {
        positions.push({
          x: anchor.x,
          y: anchor.y,
          row,
          col,
          random: hash01(seed, jitterKey, cell.id, row, col, "random"),
        });
      }

      col++;
    }

    row++;
  }

  return positions;
}

function makeForestDrawItems(cell, poly, seed, sceneryTextures, scenerySettings = {}) {
  const scale = getPercentScale(scenerySettings.forestTreeSize, 100, 30, 220);
  const baseSize = 44 * scale;

  const forestPool = chooseForestAssetPool(sceneryTextures, seed, cell.id);
  const { group: forestGroup, assets } = forestPool;

  const positions = makeLayeredObjectPositions({
    cell,
    poly,
    seed,
    baseSize,
    jitterKey: `forest-object-${forestGroup}`,
    startOverflowFactor: 0.18,
    bottomPadFactor: 0.55,
    horizontalDensityFactor: forestGroup === "pine" ? 0.62 : 0.72,
  });

  return positions.map((position, index) => {
    const assetIndex = Math.floor(
      hash01(seed, "forest-asset", forestGroup, cell.id, index) *
        Math.max(1, assets.length),
    );
    const asset = assets[Math.min(assetIndex, Math.max(0, assets.length - 1))];
    const image = asset?.image ?? asset ?? null;

    const size =
      baseSize *
      (forestGroup === "pine" ? 1 : 0.9) *
      (0.82 + hash01(seed, "forest-size-jitter", forestGroup, cell.id, index) * 0.36);

    return {
      kind: image ? "scenery-image" : "fallback-tree",
      cellId: cell.id,
      image,
      forestGroup,
      x: position.x,
      y: position.y,
      width: size,
      height: size,
      z: position.y,
      colorVariant: hash01(seed, "forest-fallback-color", forestGroup, cell.id, index),
    };
  });
}

function makeMountainDrawItems(cell, poly, seed, sceneryTextures, scenerySettings = {}) {
  const scale = getPercentScale(scenerySettings.mountainObjectSize, 100, 35, 240);
  const baseSize = 62 * scale;
  const assets = getMountainAssets(sceneryTextures);
  const center = polygonCentroid(poly);
  const bounds = polygonBounds(poly);

  const positions = makeLayeredObjectPositions({
    cell,
    poly,
    seed,
    baseSize,
    jitterKey: "mountain-object",
    // Start a little lower than before so mountains read as more centered
    // instead of hugging the top border.
    startOverflowFactor: -0.1,
    bottomPadFactor: 0.18,
    horizontalDensityFactor: 0.8,
  });

  // Pull the generated positions toward the middle of the tile.
  const centerBiasX = 0.22;
  const centerBiasY = 0.34;
  const centerYOffset = bounds.height * 0.08;

  return positions.map((position, index) => {
    const assetIndex = Math.floor(
      hash01(seed, "mountain-asset", cell.id, index) * Math.max(1, assets.length),
    );
    const asset = assets[Math.min(assetIndex, Math.max(0, assets.length - 1))];
    const image = asset?.image ?? asset ?? null;

    const size = baseSize * (0.86 + hash01(seed, "mountain-size-jitter", cell.id, index) * 0.32);

    const centeredX = position.x * (1 - centerBiasX) + center.x * centerBiasX;
    const centeredY = position.y * (1 - centerBiasY) + (center.y + centerYOffset) * centerBiasY;

    return {
      kind: image ? "scenery-image" : "fallback-mountain",
      cellId: cell.id,
      image,
      x: centeredX,
      y: centeredY,
      width: size,
      height: size,
      z: centeredY,
      colorVariant: hash01(seed, "mountain-fallback-color", cell.id, index),
    };
  });
}

export function collectTileObjectDrawItems({
  cell,
  poly,
  seed,
  buildingTextures = {},
  sceneryTextures = {},
  layout = null,
  buildingSettings = {},
  scenerySettings = {},
}) {
  const items = [];

  if (cell.biome === "forest") {
    items.push(...makeForestDrawItems(cell, poly, seed, sceneryTextures, scenerySettings));
  }

  if (cell.biome === "mountain") {
    items.push(...makeMountainDrawItems(cell, poly, seed, sceneryTextures, scenerySettings));
  }

  items.push(
    ...getBuildingDrawItems(
      cell,
      poly,
      seed,
      buildingTextures,
      layout,
      buildingSettings,
    ),
  );

  return items;
}

function drawFallbackPineTree(ctx, item) {
  const size = item.width;
  const dark = item.colorVariant < 0.5 ? "#0e3d23" : "#16592f";
  const light = item.colorVariant < 0.5 ? "#1d6f39" : "#247d3f";

  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(item.x, item.y - size * 0.9);
  ctx.lineTo(item.x - size * 0.42, item.y - size * 0.22);
  ctx.lineTo(item.x + size * 0.42, item.y - size * 0.22);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.moveTo(item.x, item.y - size * 0.68);
  ctx.lineTo(item.x - size * 0.34, item.y - size * 0.06);
  ctx.lineTo(item.x + size * 0.34, item.y - size * 0.06);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#59381e";
  ctx.fillRect(item.x - size * 0.055, item.y - size * 0.14, size * 0.11, size * 0.2);
}

function drawFallbackNormalTree(ctx, item) {
  const size = item.width;
  const trunkHeight = size * 0.28;
  const canopyRadius = size * 0.34;
  const dark = item.colorVariant < 0.5 ? "#245c2a" : "#2f6b30";
  const light = item.colorVariant < 0.5 ? "#4e8f34" : "#5d9c3b";

  ctx.fillStyle = "#5a3920";
  ctx.fillRect(item.x - size * 0.05, item.y - trunkHeight, size * 0.1, trunkHeight);

  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(item.x, item.y - size * 0.46, canopyRadius, 0, Math.PI * 2);
  ctx.arc(item.x - size * 0.18, item.y - size * 0.36, canopyRadius * 0.82, 0, Math.PI * 2);
  ctx.arc(item.x + size * 0.2, item.y - size * 0.35, canopyRadius * 0.78, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(item.x - size * 0.08, item.y - size * 0.57, canopyRadius * 0.52, 0, Math.PI * 2);
  ctx.arc(item.x + size * 0.15, item.y - size * 0.48, canopyRadius * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

function drawFallbackTree(ctx, item) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 3;

  if (item.forestGroup === "normal") {
    drawFallbackNormalTree(ctx, item);
  } else {
    drawFallbackPineTree(ctx, item);
  }

  ctx.restore();
}

function drawFallbackMountain(ctx, item) {
  const size = item.width;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 4;

  ctx.fillStyle = item.colorVariant < 0.5 ? "#7e8490" : "#9299a3";
  ctx.beginPath();
  ctx.moveTo(item.x, item.y - size * 0.88);
  ctx.lineTo(item.x - size * 0.47, item.y);
  ctx.lineTo(item.x + size * 0.52, item.y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
  ctx.beginPath();
  ctx.moveTo(item.x, item.y - size * 0.88);
  ctx.lineTo(item.x - size * 0.16, item.y - size * 0.48);
  ctx.lineTo(item.x + size * 0.12, item.y - size * 0.54);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawSceneryImage(ctx, item) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.27)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 3;

  // Objects are anchored by their lower visual baseline, not their center.
  // This makes top-to-bottom sorting feel natural.
  ctx.drawImage(
    item.image,
    item.x - item.width / 2,
    item.y - item.height * 0.86,
    item.width,
    item.height,
  );

  ctx.restore();
}

export function drawTileObjectItem(ctx, item) {
  if (item.kind === "building") {
    drawBuildingItem(ctx, item);
    return;
  }

  if (item.kind === "scenery-image") {
    drawSceneryImage(ctx, item);
    return;
  }

  if (item.kind === "fallback-tree") {
    drawFallbackTree(ctx, item);
    return;
  }

  if (item.kind === "fallback-mountain") {
    drawFallbackMountain(ctx, item);
  }
}
