import { hash01 } from "../src/rng.js";
import { createCanvas } from "@napi-rs/canvas";
import {
  buildSharedCurvedGeometry,
  traceSmoothClosedPath,
  traceSmoothOpenPath,
} from "../src/geometry/polygon.js";
import { computeTileLayout } from "../src/export/mapMetadata.js";
import { drawBiomeBase } from "../src/rendering/biomeRenderers.js";
import { drawRecessedWater } from "../src/rendering/recessedWaterRenderer.js";
import { drawRiverCascades } from "../src/rendering/cascadeRenderer.js";
import { getRiverRoutes } from "../src/rendering/riverRoutes.js";
import { drawRivers, protectRiverChannels } from "../src/rendering/riverRenderer.js";
import { getFieldCityDrawItems } from "../src/rendering/fieldCityRenderer.js";
import { getCloudDrawItems, drawCloudItem } from "../src/rendering/cloudRenderers.js";
import { getBirdDrawItems, drawBirdItem } from "../src/rendering/birdRenderers.js";
import {
  collectTileObjectDrawItems,
  drawTileObjectItem,
  protectBuildingClearings,
} from "../src/rendering/tileObjectRenderers.js";

function drawBackground(ctx, config) {
  const { width, height, seed } = config;

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#9bd5ff");
  bg.addColorStop(1, "#2c8ccc");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.beginPath();
    ctx.ellipse(
      hash01(seed, "cloudX", i) * width,
      hash01(seed, "cloudY", i) * height,
      120 + hash01(seed, "cloudW", i) * 170,
      18 + hash01(seed, "cloudH", i) * 30,
      (hash01(seed, "cloudR", i) - 0.5) * 0.5,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function drawFrame(ctx, width, height) {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.lineWidth = 8;
  ctx.strokeRect(18, 18, width - 36, height - 36);

  ctx.strokeStyle = "rgba(83, 42, 25, 0.8)";
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, width - 48, height - 48);
}

function strokeEdgeSet(ctx, edgePaths) {
  for (const points of edgePaths) {
    traceSmoothOpenPath(ctx, points);
    ctx.stroke();
  }
}

function drawCurvedBorderNetwork(ctx, edgePaths) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.strokeStyle = "rgba(70, 38, 22, 0.62)";
  ctx.lineWidth = 9;
  ctx.shadowColor = "rgba(40, 22, 14, 0.38)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  strokeEdgeSet(ctx, edgePaths);

  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(252, 249, 243, 0.98)";
  ctx.lineWidth = 4.3;
  strokeEdgeSet(ctx, edgePaths);

  ctx.restore();
}

function drawFeatureIcon(ctx, x, y, feature, featureIcons = {}, size = 44) {
  const image = featureIcons[feature];
  if (!image) return;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 8;
  ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
  ctx.restore();
}

function collectAllTileObjectItems(drawnCells, layouts, config) {
  const city = getFieldCityDrawItems(drawnCells, layouts, config);
  const items = [...city];

  drawnCells.forEach((item, index) => {
    items.push(
      ...collectTileObjectDrawItems({
        cell: item.cell,
        poly: item.poly,
        seed: config.seed,
        buildingTextures: config.buildingTextures,
        sceneryTextures: config.sceneryTextures,
        layout: layouts[index],
        buildingSettings: config.buildingSettings,
        scenerySettings: config.scenerySettings,
        canvasSize: { width: config.width, height: config.height },
      }).filter(object => !city.some(landmark => landmark.cellId === object.cellId)),
    );
  });

  items.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return String(a.cellId).localeCompare(String(b.cellId));
  });

  return protectBuildingClearings(items);
}

export function renderMapNode(ctx, cells, config) {
  const { width, height, seed } = config;

  ctx.clearRect(0, 0, width, height);
  drawBackground(ctx, config);

  const { drawnCells, edgePaths } = buildSharedCurvedGeometry(
    cells,
    config.wobble,
    seed,
  );

  for (const item of drawnCells) {
    ctx.save();
    ctx.translate(5, 9);
    traceSmoothClosedPath(ctx, item.poly);
    ctx.fillStyle = "rgba(0, 0, 0, 0.33)";
    ctx.fill();
    ctx.restore();
  }

  for (const item of drawnCells) {
    drawBiomeBase(
      ctx,
      item.cell,
      item.poly,
      seed,
      config.biomeTextures,
      config.biomeTextureZooms,
    );
  }

  const relief = drawRecessedWater(ctx, drawnCells, { ...config, createCanvas });

  const layouts = drawnCells.map((item) => computeTileLayout(item.poly, item.cell));
  const scenery = collectAllTileObjectItems(drawnCells, layouts, config);
  const rivers = getRiverRoutes(drawnCells, layouts, scenery, config);
  const objectItems = protectRiverChannels(scenery, rivers, drawnCells, config);
  const clouds = getCloudDrawItems(drawnCells, layouts, objectItems, config);
  drawRivers(ctx, drawnCells, rivers, { ...config, createCanvas });
  drawRiverCascades(ctx, drawnCells, rivers, { ...config, createCanvas }, relief);
  if (config.showBorders !== false) drawCurvedBorderNetwork(ctx, edgePaths);

  const layeredObjects = [...objectItems, ...clouds.filter((item) => item.layer === "mountain")]
    .sort((a, b) => a.z - b.z || String(a.cellId).localeCompare(String(b.cellId)));

  for (const objectItem of layeredObjects) {
    if (objectItem.kind === "cloud") drawCloudItem(ctx, objectItem);
    else drawTileObjectItem(ctx, objectItem);
  }
  for (const cloud of clouds) {
    if (cloud.layer === "sky") drawCloudItem(ctx, cloud);
  }
  for (const bird of getBirdDrawItems(drawnCells, layouts, objectItems, config, clouds)) {
    drawBirdItem(ctx, bird);
  }

  for (let i = 0; i < drawnCells.length; i++) {
    const item = drawnCells[i];
    const layout = layouts[i];

    if (item.cell.feature && layout.featureIcon) {
      drawFeatureIcon(
        ctx,
        layout.featureIcon.x,
        layout.featureIcon.y,
        item.cell.feature,
        config.featureIcons,
        layout.featureIcon.size,
      );
    }
  }

  drawFrame(ctx, width, height);
}
