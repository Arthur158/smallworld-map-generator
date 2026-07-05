
import { hash01 } from "../src/rng.js";
import {
  buildSharedCurvedGeometry,
  traceSmoothClosedPath,
  traceSmoothOpenPath,
} from "../src/geometry/polygon.js";
import { computeTileLayout } from "../src/export/mapMetadata.js";
import { drawBiome } from "../src/rendering/biomeRenderers.js";
import { drawBuildings } from "../src/rendering/buildingRenderers.js";

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

function drawCurvedBorderNetwork(ctx, edgePaths) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
  ctx.lineWidth = 7;

  for (const points of edgePaths) {
    traceSmoothOpenPath(ctx, points);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(55, 36, 35, 0.72)";
  ctx.lineWidth = 1.8;

  for (const points of edgePaths) {
    traceSmoothOpenPath(ctx, points);
    ctx.stroke();
  }

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
