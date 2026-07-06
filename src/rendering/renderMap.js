import { hash01 } from "../rng.js";
import {
  buildSharedCurvedGeometry,
  traceSmoothClosedPath,
  traceSmoothOpenPath,
} from "../geometry/polygon.js";
import { computeTileLayout } from "../export/mapMetadata.js";
import { drawBiomeBase } from "./biomeRenderers.js";
import { drawFeatureIcon } from "./icons.js";
import {
  collectTileObjectDrawItems,
  drawTileObjectItem,
} from "./tileObjectRenderers.js";

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

function collectAllTileObjectItems(drawnCells, layouts, config) {
  const items = [];

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
      }),
    );
  });

  items.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return String(a.cellId).localeCompare(String(b.cellId));
  });

  return items;
}

export function renderMap(ctx, cells, config) {
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

  drawCurvedBorderNetwork(ctx, edgePaths);

  const layouts = drawnCells.map((item) => computeTileLayout(item.poly, item.cell));
  const objectItems = collectAllTileObjectItems(drawnCells, layouts, config);

  for (const objectItem of objectItems) {
    drawTileObjectItem(ctx, objectItem);
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
