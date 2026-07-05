import { hash01 } from "../rng.js";
import {
  buildSharedCurvedGeometry,
  traceSmoothClosedPath,
  traceSmoothOpenPath,
} from "../geometry/polygon.js";
import { computeTileLayout } from "../export/mapMetadata.js";
import { drawBiome } from "./biomeRenderers.js";
import { drawFeatureIcon } from "./icons.js";
import { drawBuildings } from "./buildingRenderers.js";

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

  // Pass 1: soft dark brown under-border
  ctx.strokeStyle = "rgba(70, 38, 22, 0.62)";
  ctx.lineWidth = 9;
  ctx.shadowColor = "rgba(40, 22, 14, 0.38)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  strokeEdgeSet(ctx, edgePaths);

  // Pass 2: main warm white border
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(252, 249, 243, 0.98)";
  ctx.lineWidth = 4.3;
  strokeEdgeSet(ctx, edgePaths);

  // Pass 3: thin inner dark hairline
  // ctx.strokeStyle = "rgba(82, 69, 63, 0.55)";
  // ctx.lineWidth = 1.0;
  // strokeEdgeSet(ctx, edgePaths);

  ctx.restore();
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
    drawBiome(ctx, item.cell, item.poly, seed, config.biomeTextures, config.biomeTextureZooms);
  }

  drawCurvedBorderNetwork(ctx, edgePaths);

  for (const item of drawnCells) {
    const layout = computeTileLayout(item.poly, item.cell);

    drawBuildings(
      ctx,
      item.cell,
      item.poly,
      seed,
      config.buildingTextures,
      layout,
      config.buildingSettings,
    );

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
