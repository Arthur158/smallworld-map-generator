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
  showBorders: true,
  showFieldCity: true,
  wobble: 11,
  tileShapeSettings: {
    chonkiness: 60,
    repulsionSteps: 5,
  },
  spread: 0,
  waterSettings: {
    centerLakeSize: 100,
    seaSize: 100,
  },
  scenerySettings: {
    forestTreeSize: 100,
    mountainObjectSize: 100,
    cloudDensity: 100,
    birdDensity: 100,
    dragonCount: 2,
    riverCount: 2,
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
    maxPerTile: 2,
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
    showBorders: merged.showBorders !== false,
    showFieldCity: merged.showFieldCity !== false,
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
      cloudDensity: clampNumber(
        merged.scenerySettings?.cloudDensity,
        DEFAULT_SETTINGS.scenerySettings.cloudDensity,
        0,
        200,
      ),
      birdDensity: clampNumber(
        merged.scenerySettings?.birdDensity,
        DEFAULT_SETTINGS.scenerySettings.birdDensity,
        0,
        200,
      ),
      dragonCount: Math.round(clampNumber(
        merged.scenerySettings?.dragonCount ?? DEFAULT_SETTINGS.scenerySettings.dragonCount,
        DEFAULT_SETTINGS.scenerySettings.dragonCount,
        0,
        12,
      )),
      riverCount: Math.round(clampNumber(
        merged.scenerySettings?.riverCount ?? DEFAULT_SETTINGS.scenerySettings.riverCount,
        DEFAULT_SETTINGS.scenerySettings.riverCount,
        0,
        6,
      )),
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
    showBorders: document.getElementById("showBorders")?.checked,
    showFieldCity: document.getElementById("showFieldCity")?.checked,
    tileCount: document.getElementById("tileCount")?.value,
    wobble: document.getElementById("wobble")?.value,
    tileShapeSettings: {
      chonkiness: document.getElementById("tileChonkiness")?.value,
      repulsionSteps: document.getElementById("tileRepulsionSteps")?.value,
    },
    spread: document.getElementById("spread")?.value,
    width: document.getElementById("mapWidth")?.value,
    height: document.getElementById("mapHeight")?.value,
    shapeMode: document.getElementById("shapeMode")?.value,
    waterSettings: {
      centerLakeSize: document.getElementById("centerLakeSize")?.value,
      seaSize: document.getElementById("seaSize")?.value,
    },
    scenerySettings: {
      forestTreeSize: document.getElementById("forestTreeSize")?.value,
      mountainObjectSize: document.getElementById("mountainObjectSize")?.value,
      cloudDensity: document.getElementById("cloudDensity")?.value,
      birdDensity: document.getElementById("birdDensity")?.value,
      dragonCount: document.getElementById("dragonCount")?.value,
      riverCount: document.getElementById("riverCount")?.value,
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
  setValue("mapWidth", settings.width);
  setValue("mapHeight", settings.height);
  syncDimensions();

  setValue("seed", settings.seed);
  setChecked("showBorders", settings.showBorders !== false);
  setChecked("showFieldCity", settings.showFieldCity !== false);
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
  setValue("cloudDensity", settings.scenerySettings.cloudDensity);
  setValue("birdDensity", settings.scenerySettings.birdDensity);
  setValue("dragonCount", settings.scenerySettings.dragonCount);
  syncDragonCount();
  setValue("riverCount", settings.scenerySettings.riverCount);
  syncRiverHint();

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
  document.getElementById("regionName").textContent = metadata.regionName;
  canvas.setAttribute("aria-label", `Map of ${metadata.regionName}`);
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
  if (!syncDimensions()) return;
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

function syncDimensions(inferPreset = true) {
  const width = document.getElementById("mapWidth");
  const height = document.getElementById("mapHeight");
  const valid = input => Number.isInteger(input.valueAsNumber) && input.valueAsNumber >= 200 && input.valueAsNumber <= 4000;
  const sidesValid = valid(width) && valid(height);
  const areaValid = sidesValid && width.valueAsNumber * height.valueAsNumber <= 4000000;
  const ready = sidesValid && areaValid;
  for (const input of [width, height]) input.setAttribute("aria-invalid", String(!valid(input) || (sidesValid && !areaValid)));
  const error = document.getElementById("dimensionError");
  error.hidden = ready;
  error.textContent = sidesValid
    ? "Choose dimensions totaling at most 4 million pixels (for example 2000 × 2000)."
    : "Enter a whole width and height from 200 to 4000 pixels.";
  for (const id of ["generate", "randomSeed"]) document.getElementById(id).disabled = !ready;
  if (inferPreset) document.getElementById("dimensionPreset").value = width.valueAsNumber === 1400
    ? height.valueAsNumber === 900 ? "small" : height.valueAsNumber === 1400 ? "large" : "custom" : "custom";
  return ready;
}

on("mapWidth", "input", () => syncDimensions());
on("mapHeight", "input", () => syncDimensions());
on("dimensionPreset", "change", event => {
  if (event.target.value !== "custom") {
    document.getElementById("mapWidth").value = "1400";
    document.getElementById("mapHeight").value = event.target.value === "large" ? "1400" : "900";
  }
  syncDimensions(false);
});

function syncDragonCount() {
  const input = document.getElementById("dragonCount");
  const output = document.getElementById("dragonCountValue");
  if (input && output) output.value = String(Math.round(clampNumber(input.value, DEFAULT_SETTINGS.scenerySettings.dragonCount, 0, 12)));
}

on("dragonCount", "input", syncDragonCount);

function syncRiverHint() {
  const input = document.getElementById("riverCount");
  if (!input) return;
  const count = Math.round(clampNumber(input.value, DEFAULT_SETTINGS.scenerySettings.riverCount, 0, 6));
  input.title = `Up to ${count} short rivers, each crossing at most four land regions. Routes need a mountain or map-edge source and a water outlet. Zero turns rivers off.`;
}

on("riverCount", "input", syncRiverHint);

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
