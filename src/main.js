import { makeMap } from "./generation/mapGenerator.js";
import { renderMap } from "./rendering/renderMap.js";
import { loadBiomeTextures } from "./rendering/biomeTextures.js";
import { loadFeatureIcons } from "./rendering/icons.js";
import { loadBuildingTextures } from "./rendering/buildingTextures.js";
import { loadSceneryTextures } from "./rendering/sceneryTextures.js";
import {
  createMapMetadata,
  generateGoMapFunction,
  generateGraphicsJsObject,
} from "./export/mapMetadata.js";

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

let biomeTextures = {};
let featureIcons = {};
let buildingTextures = {};
let sceneryTextures = {};
let lastCells = [];
let lastConfig = null;
let lastMetadata = null;
let assetsReady = false;

export const DEFAULT_SETTINGS = {
  seed: "deniz-42",
  tileCount: 52,
  wobble: 11,
  tileShapeSettings: {
    chonkiness: 60,
    repulsionSteps: 5,
  },
  spread: 70,
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
  width: 1400,
  height: 900,
  shapeMode: "mainland",
  biomeTextureZooms: {
    forest: 100,
    grass: 100,
    field: 100,
    swamp: 100,
    mountain: 100,
    sea: 100,
  },
  buildingSettings: {
    averagePerTile: 0.35,
    maxPerTile: 1,
    sizeMultiplier: 1,
    symbolBuildingChance: 100,
  },
  featureSettings: {
    magic: { count: 5, spread: 55 },
    mine: { count: 4, spread: 65 },
    cave: { count: 4, spread: 60 },
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
  if (!Number.isFinite(n)) return fallback;
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

function normalizeSettings(input = {}) {
  const merged = deepMerge(DEFAULT_SETTINGS, unwrapSettings(input));

  return {
    seed: String(merged.seed || DEFAULT_SETTINGS.seed),
    tileCount: Math.round(clampNumber(merged.tileCount, DEFAULT_SETTINGS.tileCount, 18, 120)),
    wobble: clampNumber(merged.wobble, DEFAULT_SETTINGS.wobble, 0, 30),
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
    spread: clampNumber(merged.spread, DEFAULT_SETTINGS.spread, 0, 100),
    width: Math.round(clampNumber(merged.width, DEFAULT_SETTINGS.width, 200, 4000)),
    height: Math.round(clampNumber(merged.height, DEFAULT_SETTINGS.height, 200, 4000)),
    shapeMode: merged.shapeMode === "islands" ? "islands" : "mainland",
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
      field: clampNumber(merged.biomeWeights?.field, DEFAULT_SETTINGS.biomeWeights.field, 0, 300),
      grass: clampNumber(merged.biomeWeights?.grass, DEFAULT_SETTINGS.biomeWeights.grass, 0, 300),
      forest: clampNumber(merged.biomeWeights?.forest, DEFAULT_SETTINGS.biomeWeights.forest, 0, 300),
      mountain: clampNumber(merged.biomeWeights?.mountain, DEFAULT_SETTINGS.biomeWeights.mountain, 0, 300),
      swamp: clampNumber(merged.biomeWeights?.swamp, DEFAULT_SETTINGS.biomeWeights.swamp, 0, 300),
    },
    biomeTextureZooms: {
      forest: clampNumber(merged.biomeTextureZooms?.forest, DEFAULT_SETTINGS.biomeTextureZooms.forest, 25, 400),
      grass: clampNumber(merged.biomeTextureZooms?.grass, DEFAULT_SETTINGS.biomeTextureZooms.grass, 25, 400),
      field: clampNumber(merged.biomeTextureZooms?.field, DEFAULT_SETTINGS.biomeTextureZooms.field, 25, 400),
      swamp: clampNumber(merged.biomeTextureZooms?.swamp, DEFAULT_SETTINGS.biomeTextureZooms.swamp, 25, 400),
      mountain: clampNumber(merged.biomeTextureZooms?.mountain, DEFAULT_SETTINGS.biomeTextureZooms.mountain, 25, 400),
      sea: clampNumber(merged.biomeTextureZooms?.sea, DEFAULT_SETTINGS.biomeTextureZooms.sea, 25, 400),
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
        count: Math.round(clampNumber(merged.featureSettings?.magic?.count, DEFAULT_SETTINGS.featureSettings.magic.count, 0, 40)),
        spread: clampNumber(merged.featureSettings?.magic?.spread, DEFAULT_SETTINGS.featureSettings.magic.spread, 0, 100),
      },
      mine: {
        count: Math.round(clampNumber(merged.featureSettings?.mine?.count, DEFAULT_SETTINGS.featureSettings.mine.count, 0, 40)),
        spread: clampNumber(merged.featureSettings?.mine?.spread, DEFAULT_SETTINGS.featureSettings.mine.spread, 0, 100),
      },
      cave: {
        count: Math.round(clampNumber(merged.featureSettings?.cave?.count, DEFAULT_SETTINGS.featureSettings.cave.count, 0, 40)),
        spread: clampNumber(merged.featureSettings?.cave?.spread, DEFAULT_SETTINGS.featureSettings.cave.spread, 0, 100),
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

function makeRenderableConfig(settings) {
  return {
    ...settings,
    biomeTextures,
    featureIcons,
    buildingTextures,
    sceneryTextures,
  };
}

function readSettingsFromDom() {
  return normalizeSettings({
    seed: document.getElementById("seed")?.value,
    tileCount: document.getElementById("tileCount")?.value,
    wobble: document.getElementById("wobble")?.value,
    tileShapeSettings: {
      chonkiness: document.getElementById("tileChonkiness")?.value,
      repulsionSteps: document.getElementById("tileRepulsionSteps")?.value,
    },
    spread: document.getElementById("spread")?.value,
    width: canvas.width,
    height: canvas.height,
    shapeMode: document.getElementById("shapeMode")?.value,
    waterSettings: {
      centerLakeSize: document.getElementById("centerLakeSize")?.value,
      seaSize: document.getElementById("seaSize")?.value,
    },
    scenerySettings: {
      forestTreeSize: document.getElementById("forestTreeSize")?.value,
      mountainObjectSize: document.getElementById("mountainObjectSize")?.value,
    },
    biomeWeights: {
      field: document.getElementById("fieldBiomeWeight")?.value,
      grass: document.getElementById("grassBiomeWeight")?.value,
      forest: document.getElementById("forestBiomeWeight")?.value,
      mountain: document.getElementById("mountainBiomeWeight")?.value,
      swamp: document.getElementById("swampBiomeWeight")?.value,
    },
    biomeTextureZooms: {
      forest: document.getElementById("forestTextureZoom")?.value,
      grass: document.getElementById("grassTextureZoom")?.value,
      field: document.getElementById("fieldTextureZoom")?.value,
      swamp: document.getElementById("swampTextureZoom")?.value,
      mountain: document.getElementById("mountainTextureZoom")?.value,
      sea: document.getElementById("seaTextureZoom")?.value,
    },
    buildingSettings: {
      averagePerTile: document.getElementById("buildingAveragePerTile")?.value,
      maxPerTile: document.getElementById("maxBuildingsPerTile")?.value,
      sizeMultiplier: document.getElementById("buildingSizeMultiplier")?.value,
      symbolBuildingChance: document.getElementById("symbolBuildingChance")?.value,
    },
    featureSettings: {
      magic: {
        count: document.getElementById("magicCount")?.value,
        spread: document.getElementById("magicSpread")?.value,
      },
      mine: {
        count: document.getElementById("mineCount")?.value,
        spread: document.getElementById("mineSpread")?.value,
      },
      cave: {
        count: document.getElementById("caveCount")?.value,
        spread: document.getElementById("caveSpread")?.value,
      },
    },
    seaCorners: {
      NW: document.getElementById("seaNW")?.checked,
      NE: document.getElementById("seaNE")?.checked,
      SW: document.getElementById("seaSW")?.checked,
      SE: document.getElementById("seaSE")?.checked,
    },
    randomizeSeaCorners: document.getElementById("randomizeSeaCorners")?.checked,
    centerLake: document.getElementById("centerLake")?.checked,
  });
}

function syncDomFromSettings(settings) {
  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };
  const setChecked = (id, checked) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(checked);
  };

  canvas.width = settings.width;
  canvas.height = settings.height;

  setValue("seed", settings.seed);
  setValue("tileCount", settings.tileCount);
  setValue("wobble", settings.wobble);
  setValue("tileChonkiness", settings.tileShapeSettings.chonkiness);
  setValue("tileRepulsionSteps", settings.tileShapeSettings.repulsionSteps);
  setValue("spread", settings.spread);
  setValue("shapeMode", settings.shapeMode);

  setValue("centerLakeSize", settings.waterSettings.centerLakeSize);
  setValue("seaSize", settings.waterSettings.seaSize);

  setValue("forestTreeSize", settings.scenerySettings.forestTreeSize);
  setValue("mountainObjectSize", settings.scenerySettings.mountainObjectSize);

  setValue("fieldBiomeWeight", settings.biomeWeights.field);
  setValue("grassBiomeWeight", settings.biomeWeights.grass);
  setValue("forestBiomeWeight", settings.biomeWeights.forest);
  setValue("mountainBiomeWeight", settings.biomeWeights.mountain);
  setValue("swampBiomeWeight", settings.biomeWeights.swamp);

  setValue("forestTextureZoom", settings.biomeTextureZooms.forest);
  setValue("grassTextureZoom", settings.biomeTextureZooms.grass);
  setValue("fieldTextureZoom", settings.biomeTextureZooms.field);
  setValue("swampTextureZoom", settings.biomeTextureZooms.swamp);
  setValue("mountainTextureZoom", settings.biomeTextureZooms.mountain);
  setValue("seaTextureZoom", settings.biomeTextureZooms.sea);

  setValue("buildingAveragePerTile", settings.buildingSettings.averagePerTile);
  setValue("maxBuildingsPerTile", settings.buildingSettings.maxPerTile);
  setValue("buildingSizeMultiplier", settings.buildingSettings.sizeMultiplier);
  setValue("symbolBuildingChance", settings.buildingSettings.symbolBuildingChance);

  setValue("magicCount", settings.featureSettings.magic.count);
  setValue("magicSpread", settings.featureSettings.magic.spread);
  setValue("mineCount", settings.featureSettings.mine.count);
  setValue("mineSpread", settings.featureSettings.mine.spread);
  setValue("caveCount", settings.featureSettings.cave.count);
  setValue("caveSpread", settings.featureSettings.cave.spread);

  setChecked("seaNW", settings.seaCorners.NW);
  setChecked("seaNE", settings.seaCorners.NE);
  setChecked("seaSW", settings.seaCorners.SW);
  setChecked("seaSE", settings.seaCorners.SE);
  setChecked("randomizeSeaCorners", settings.randomizeSeaCorners);
  setChecked("centerLake", settings.centerLake);
}

function exposeGeneratedData(cells, metadata) {
  window.lastGeneratedMap = cells.map((cell) => ({
    id: cell.id,
    site: cell.site,
    polygon: cell.polygon,
    biome: cell.biome,
    feature: cell.feature,
    object: cell.object,
    buildings: cell.buildings ?? [],
    waterKind: cell.waterKind || null,
  }));

  window.lastMapMetadata = metadata;
  window.lastServerMapMetadata = metadata.server;
  window.lastGraphicsMapMetadata = metadata.graphics;
  window.lastGoMapFunction = generateGoMapFunction(metadata);
  window.lastWaterPlan = lastConfig?.waterPlan || null;
}

async function ensureAssetsReady() {
  if (assetsReady) return;

  [biomeTextures, featureIcons, buildingTextures, sceneryTextures] = await Promise.all([
    loadBiomeTextures(),
    loadFeatureIcons(),
    loadBuildingTextures(),
    loadSceneryTextures(),
  ]);

  assetsReady = true;
}

function stripRuntimeAssets(config) {
  return clone({
    ...config,
    biomeTextures: undefined,
    featureIcons: undefined,
    buildingTextures: undefined,
    sceneryTextures: undefined,
  });
}

export async function generateFromSettings(inputSettings = {}, options = {}) {
  await ensureAssetsReady();

  const settings = normalizeSettings(unwrapSettings(inputSettings));

  if (options.syncDom !== false) {
    syncDomFromSettings(settings);
  } else {
    canvas.width = settings.width;
    canvas.height = settings.height;
  }

  lastConfig = makeRenderableConfig(settings);
  lastCells = makeMap(lastConfig);
  lastMetadata = createMapMetadata(lastCells, lastConfig);

  renderMap(ctx, lastCells, lastConfig);
  exposeGeneratedData(lastCells, lastMetadata);

  return {
    imageDataUrl: canvas.toDataURL("image/png"),
    settings: stripRuntimeAssets(lastConfig),
    metadata: lastMetadata,
    exports: {
      goServerMap: generateGoMapFunction(lastMetadata, "GeneratedMap"),
      graphicsJs: generateGraphicsJsObject(lastMetadata, "generatedMapGraphics"),
    },
  };
}

function regenerateFromUi() {
  return generateFromSettings(readSettingsFromDom(), { syncDom: true });
}

function downloadText(filename, text, mimeType = "text/plain") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();

  URL.revokeObjectURL(url);
}

async function getFreshMetadata() {
  if (!lastCells.length || !lastConfig) {
    await regenerateFromUi();
  }

  lastMetadata = createMapMetadata(lastCells, lastConfig);
  exposeGeneratedData(lastCells, lastMetadata);

  return lastMetadata;
}

function on(id, event, handler) {
  const element = document.getElementById(id);
  if (element) element.addEventListener(event, handler);
}

on("generate", "click", () => {
  regenerateFromUi();
});

on("randomSeed", "click", async () => {
  document.getElementById("seed").value = Math.random().toString(36).slice(2, 10);
  await regenerateFromUi();
});

on("exportPng", "click", () => {
  const link = document.createElement("a");
  link.download = "generated-voronoi-board-map.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});

on("exportMetadataJson", "click", async () => {
  const metadata = await getFreshMetadata();

  downloadText(
    "generated-map-metadata.json",
    JSON.stringify(metadata, null, 2),
    "application/json",
  );
});

on("exportGoServerMap", "click", async () => {
  const metadata = await getFreshMetadata();

  downloadText(
    "generated-map-server.go",
    generateGoMapFunction(metadata, "GeneratedMap"),
    "text/x-go",
  );
});

on("exportGraphicsJs", "click", async () => {
  const metadata = await getFreshMetadata();

  downloadText(
    "generated-map-graphics.js",
    generateGraphicsJsObject(metadata, "generatedMapGraphics"),
    "text/javascript",
  );
});

async function boot() {
  await ensureAssetsReady();
  await regenerateFromUi();

  window.mapGeneratorApi = {
    ready: true,
    getDefaultSettings() {
      return clone(DEFAULT_SETTINGS);
    },
    async generate(settings = {}) {
      return generateFromSettings(settings, { syncDom: false });
    },
  };
}

window.mapGeneratorApi = {
  ready: false,
  getDefaultSettings() {
    return clone(DEFAULT_SETTINGS);
  },
  async generate(settings = {}) {
    return generateFromSettings(settings, { syncDom: false });
  },
};

boot();
