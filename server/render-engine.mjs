import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { makeMap } from "../src/generation/mapGenerator.js";
import { renderMapNode } from "./render-map-node.mjs";
import {
  createMapMetadata,
  generateGoMapFunction,
  generateGraphicsJsObject,
} from "../src/export/mapMetadata.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const ASSETS_DIR = path.join(ROOT, "src", "assets");

export const DEFAULT_SETTINGS = {
  seed: "deniz-42",

  tileCount: 52,
  width: 1400,
  height: 900,
  shapeMode: "mainland",

  wobble: 11,
  spread: 70,

  tileShapeSettings: {
    chonkiness: 60,
    repulsionSteps: 5,
  },

  waterSettings: {
    centerLakeSize: 100,
    seaSize: 100,
  },

  scenerySettings: {
    forestTreeSize: 100,
    mountainObjectSize: 100,
  },

  biomeWeights: {
    field: 100,
    grass: 100,
    forest: 100,
    mountain: 100,
    swamp: 100,
  },

  biomeTextureZooms: {
    field: 100,
    grass: 100,
    forest: 100,
    mountain: 100,
    swamp: 100,
    sea: 100,
  },

  buildingSettings: {
    averagePerTile: 0.35,
    maxPerTile: 1,
    sizeMultiplier: 1,
    symbolBuildingChance: 100,
  },

  featureSettings: {
    magic: {
      count: 5,
      spread: 55,
    },
    mine: {
      count: 4,
      spread: 65,
    },
    cave: {
      count: 4,
      spread: 60,
    },
  },

  seaCorners: {
    NW: true,
    NE: false,
    SW: true,
    SE: true,
  },

  randomizeSeaCorners: false,
  centerLake: false,
};

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(base, patch) {
  if (patch == null) return clone(base);

  if (Array.isArray(base) || Array.isArray(patch)) {
    return clone(patch);
  }

  if (typeof base !== "object" || typeof patch !== "object") {
    return patch;
  }

  const result = { ...clone(base) };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = clone(value);
    }
  }

  return result;
}

function clampNumber(value, fallback, min = -Infinity, max = Infinity) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, n));
}

function unwrapSettings(input = {}) {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    input.settings &&
    typeof input.settings === "object"
  ) {
    return input.settings;
  }

  return input;
}

export function normalizeSettings(input = {}) {
  const merged = deepMerge(DEFAULT_SETTINGS, unwrapSettings(input));

  return {
    seed: String(merged.seed || DEFAULT_SETTINGS.seed),
    // Optional: existing UI and training callers keep their original maps.
    preserveRegionCount: merged.preserveRegionCount === true,

    tileCount: Math.round(
      clampNumber(
        merged.tileCount,
        DEFAULT_SETTINGS.tileCount,
        18,
        120,
      ),
    ),

    width: Math.round(
      clampNumber(
        merged.width,
        DEFAULT_SETTINGS.width,
        200,
        4000,
      ),
    ),

    height: Math.round(
      clampNumber(
        merged.height,
        DEFAULT_SETTINGS.height,
        200,
        4000,
      ),
    ),

    shapeMode: merged.shapeMode === "islands" ? "islands" : "mainland",

    wobble: clampNumber(
      merged.wobble,
      DEFAULT_SETTINGS.wobble,
      0,
      30,
    ),

    spread: clampNumber(
      merged.spread,
      DEFAULT_SETTINGS.spread,
      0,
      100,
    ),

    tileShapeSettings: {
      chonkiness: clampNumber(
        merged.tileShapeSettings?.chonkiness,
        DEFAULT_SETTINGS.tileShapeSettings.chonkiness,
        0,
        100,
      ),

      repulsionSteps: Math.round(
        clampNumber(
          merged.tileShapeSettings?.repulsionSteps,
          DEFAULT_SETTINGS.tileShapeSettings.repulsionSteps,
          0,
          12,
        ),
      ),
    },

    waterSettings: {
      centerLakeSize: clampNumber(
        merged.waterSettings?.centerLakeSize,
        DEFAULT_SETTINGS.waterSettings.centerLakeSize,
        40,
        240,
      ),

      seaSize: clampNumber(
        merged.waterSettings?.seaSize,
        DEFAULT_SETTINGS.waterSettings.seaSize,
        40,
        240,
      ),
    },

    scenerySettings: {
      forestTreeSize: clampNumber(
        merged.scenerySettings?.forestTreeSize,
        DEFAULT_SETTINGS.scenerySettings.forestTreeSize,
        30,
        220,
      ),

      mountainObjectSize: clampNumber(
        merged.scenerySettings?.mountainObjectSize,
        DEFAULT_SETTINGS.scenerySettings.mountainObjectSize,
        35,
        240,
      ),
    },

    biomeWeights: {
      field: clampNumber(
        merged.biomeWeights?.field,
        DEFAULT_SETTINGS.biomeWeights.field,
        0,
        300,
      ),

      grass: clampNumber(
        merged.biomeWeights?.grass,
        DEFAULT_SETTINGS.biomeWeights.grass,
        0,
        300,
      ),

      forest: clampNumber(
        merged.biomeWeights?.forest,
        DEFAULT_SETTINGS.biomeWeights.forest,
        0,
        300,
      ),

      mountain: clampNumber(
        merged.biomeWeights?.mountain,
        DEFAULT_SETTINGS.biomeWeights.mountain,
        0,
        300,
      ),

      swamp: clampNumber(
        merged.biomeWeights?.swamp,
        DEFAULT_SETTINGS.biomeWeights.swamp,
        0,
        300,
      ),
    },

    biomeTextureZooms: {
      field: clampNumber(
        merged.biomeTextureZooms?.field,
        DEFAULT_SETTINGS.biomeTextureZooms.field,
        25,
        400,
      ),

      grass: clampNumber(
        merged.biomeTextureZooms?.grass,
        DEFAULT_SETTINGS.biomeTextureZooms.grass,
        25,
        400,
      ),

      forest: clampNumber(
        merged.biomeTextureZooms?.forest,
        DEFAULT_SETTINGS.biomeTextureZooms.forest,
        25,
        400,
      ),

      mountain: clampNumber(
        merged.biomeTextureZooms?.mountain,
        DEFAULT_SETTINGS.biomeTextureZooms.mountain,
        25,
        400,
      ),

      swamp: clampNumber(
        merged.biomeTextureZooms?.swamp,
        DEFAULT_SETTINGS.biomeTextureZooms.swamp,
        25,
        400,
      ),

      sea: clampNumber(
        merged.biomeTextureZooms?.sea,
        DEFAULT_SETTINGS.biomeTextureZooms.sea,
        25,
        400,
      ),
    },

    buildingSettings: {
      averagePerTile: clampNumber(
        merged.buildingSettings?.averagePerTile,
        DEFAULT_SETTINGS.buildingSettings.averagePerTile,
        0,
        5,
      ),

      maxPerTile: Math.round(
        clampNumber(
          merged.buildingSettings?.maxPerTile,
          DEFAULT_SETTINGS.buildingSettings.maxPerTile,
          0,
          5,
        ),
      ),

      sizeMultiplier: clampNumber(
        merged.buildingSettings?.sizeMultiplier,
        DEFAULT_SETTINGS.buildingSettings.sizeMultiplier,
        0.2,
        3,
      ),

      symbolBuildingChance: clampNumber(
        merged.buildingSettings?.symbolBuildingChance,
        DEFAULT_SETTINGS.buildingSettings.symbolBuildingChance,
        0,
        100,
      ),
    },

    featureSettings: {
      magic: {
        count: Math.round(
          clampNumber(
            merged.featureSettings?.magic?.count,
            DEFAULT_SETTINGS.featureSettings.magic.count,
            0,
            40,
          ),
        ),

        spread: clampNumber(
          merged.featureSettings?.magic?.spread,
          DEFAULT_SETTINGS.featureSettings.magic.spread,
          0,
          100,
        ),
      },

      mine: {
        count: Math.round(
          clampNumber(
            merged.featureSettings?.mine?.count,
            DEFAULT_SETTINGS.featureSettings.mine.count,
            0,
            40,
          ),
        ),

        spread: clampNumber(
          merged.featureSettings?.mine?.spread,
          DEFAULT_SETTINGS.featureSettings.mine.spread,
          0,
          100,
        ),
      },

      cave: {
        count: Math.round(
          clampNumber(
            merged.featureSettings?.cave?.count,
            DEFAULT_SETTINGS.featureSettings.cave.count,
            0,
            40,
          ),
        ),

        spread: clampNumber(
          merged.featureSettings?.cave?.spread,
          DEFAULT_SETTINGS.featureSettings.cave.spread,
          0,
          100,
        ),
      },
    },

    seaCorners: {
      NW: Boolean(merged.seaCorners?.NW),
      NE: Boolean(merged.seaCorners?.NE),
      SW: Boolean(merged.seaCorners?.SW),
      SE: Boolean(merged.seaCorners?.SE),
    },

    randomizeSeaCorners: Boolean(merged.randomizeSeaCorners),
    centerLake: Boolean(merged.centerLake),
  };
}

async function collectImageFiles(dir) {
  let entries;

  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectImageFiles(fullPath)));
      continue;
    }

    if (/\.(png|jpg|jpeg|webp|avif)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function getAssetGroup(baseDir, file) {
  const relativeParts = path.relative(baseDir, file).split(path.sep);

  // Expected:
  // src/assets/images/field/something.png
  // src/assets/buildings/field/windmill.png
  //
  // If the file is directly inside images/ or buildings/, it has no useful
  // biome group, so skip it.
  if (relativeParts.length < 2) {
    return null;
  }

  return relativeParts[0];
}

async function loadGroupedImages(baseDir) {
  const grouped = {};
  const files = await collectImageFiles(baseDir);

  for (const file of files) {
    const group = getAssetGroup(baseDir, file);

    if (!group) {
      console.warn(
        `[render-engine] Skipping image with no biome folder: ${path.relative(
          ROOT,
          file,
        )}`,
      );
      continue;
    }

    if (!grouped[group]) {
      grouped[group] = [];
    }

    // IMPORTANT:
    // Biome textures must be raw Image objects.
    // drawBiome() passes these directly to ctx.drawImage().
    grouped[group].push(await loadImage(file));
  }

  return grouped;
}

const FEATURE_BUILDING_FOLDERS = new Set(["magic", "mine", "cave"]);

function getBuildingInfo(baseDir, file) {
  const relativeParts = path.relative(baseDir, file).split(path.sep);

  // Expected:
  // src/assets/buildings/<biome>/<image>.png
  // src/assets/buildings/<biome>/<feature>/<image>.png
  // Example: src/assets/buildings/grass/magic/tower.png
  if (relativeParts.length < 2) {
    return null;
  }

  const biome = relativeParts[0];
  const maybeFeature = relativeParts[1];

  return {
    biome,
    feature: FEATURE_BUILDING_FOLDERS.has(maybeFeature) ? maybeFeature : null,
  };
}

function createBuildingTextureGroup() {
  return {
    default: [],
    magic: [],
    mine: [],
    cave: [],
  };
}

function ensureBuildingTextureGroup(grouped, biome) {
  if (!grouped[biome]) {
    grouped[biome] = createBuildingTextureGroup();
  }

  return grouped[biome];
}

async function loadGroupedImageAssets(baseDir) {
  const grouped = {};
  const files = await collectImageFiles(baseDir);

  for (const file of files) {
    const info = getBuildingInfo(baseDir, file);

    if (!info) {
      console.warn(
        `[render-engine] Skipping building with no biome folder: ${path.relative(
          ROOT,
          file,
        )}`,
      );
      continue;
    }

    const group = ensureBuildingTextureGroup(grouped, info.biome);
    const bucket = info.feature ?? "default";

    // Building textures need filename metadata because the building renderer
    // uses the filename to decide custom render size.
    group[bucket].push({
      name: path.basename(file),
      image: await loadImage(file),
      feature: info.feature,
    });
  }

  return grouped;
}

async function loadSceneryTextures(baseAssetsDir) {
  const forestDirs = [
    path.join(baseAssetsDir, "forests"),
    // Also support singular `assets/forest/...` in case assets are copied there.
    path.join(baseAssetsDir, "forest"),
  ];
  const mountainsDir = path.join(baseAssetsDir, "mountains");

  const forests = {
    pine: [],
    normal: [],
  };

  for (const forestsDir of forestDirs) {
    for (const file of await collectImageFiles(forestsDir)) {
      const relativeParts = path.relative(forestsDir, file).split(path.sep);
      const group = relativeParts[0] === "pine" ? "pine" : "normal";

      forests[group].push({
        name: path.basename(file),
        image: await loadImage(file),
      });
    }
  }

  const mountains = [];

  for (const file of await collectImageFiles(mountainsDir)) {
    mountains.push({
      name: path.basename(file),
      image: await loadImage(file),
    });
  }

  return {
    forests,
    mountains,
  };
}

async function loadRequiredImage(file) {
  try {
    return await loadImage(file);
  } catch (error) {
    throw new Error(
      `[render-engine] Could not load required image: ${path.relative(
        ROOT,
        file,
      )}\n${error.message}`,
    );
  }
}

let assetCache = null;

export async function loadRuntimeAssets() {
  if (assetCache) {
    return assetCache;
  }

  const imagesDir = path.join(ASSETS_DIR, "images");
  const buildingsDir = path.join(ASSETS_DIR, "buildings");
  const iconsDir = path.join(ASSETS_DIR, "icons");

  const [biomeTextures, buildingTextures, sceneryTextures, cave, magic, mine] =
    await Promise.all([
      loadGroupedImages(imagesDir),
      loadGroupedImageAssets(buildingsDir),
      loadSceneryTextures(ASSETS_DIR),
      loadRequiredImage(path.join(iconsDir, "cave.png")),
      loadRequiredImage(path.join(iconsDir, "magic.png")),
      loadRequiredImage(path.join(iconsDir, "mine.png")),
    ]);

  assetCache = {
    biomeTextures,
    buildingTextures,
    sceneryTextures,
    featureIcons: {
      cave,
      magic,
      mine,
    },
  };

  return assetCache;
}

function makeRenderableConfig(settings, assets) {
  return {
    ...settings,
    biomeTextures: assets.biomeTextures,
    buildingTextures: assets.buildingTextures,
    sceneryTextures: assets.sceneryTextures,
    featureIcons: assets.featureIcons,
  };
}

export async function generateMapResult(inputSettings = {}) {
  const assets = await loadRuntimeAssets();
  const settings = normalizeSettings(inputSettings);
  const fullConfig = makeRenderableConfig(settings, assets);

  const canvas = createCanvas(settings.width, settings.height);
  const ctx = canvas.getContext("2d");

  const cells = makeMap(fullConfig);
  const metadata = createMapMetadata(cells, fullConfig);

  renderMapNode(ctx, cells, fullConfig);

  const pngBuffer = await canvas.encode("png");
  const imageBuffer = Buffer.from(pngBuffer);
  const imageBase64 = imageBuffer.toString("base64");
  const imageDataUrl = `data:image/png;base64,${imageBase64}`;

  return {
    imageBuffer,
    imageBase64,
    imageDataUrl,
    settings,
    metadata,
    exports: {
      goServerMap: generateGoMapFunction(metadata, "GeneratedMap"),
      graphicsJs: generateGraphicsJsObject(
        metadata,
        "generatedMapGraphics",
      ),
    },
  };
}
