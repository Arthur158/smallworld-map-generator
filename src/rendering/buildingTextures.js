import { BUILDING_ATLASES, addBuildingAsset, prepareBuildingAsset, prepareBuildingAtlas, useLegacyBuilding } from "./buildingAtlasCatalog.js";

const atlasModules = import.meta.glob("../assets/building-atlases/*.png", {
  eager: true, query: "?url", import: "default",
});

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

const buildingModules = import.meta.glob(
  "../assets/buildings/**/*.{png,jpg,jpeg,webp,avif}",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
);

const FEATURE_BUILDING_FOLDERS = new Set(["magic", "mine", "cave"]);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load building image: ${src}`));
    image.src = src;
  });
}

function getBuildingInfoFromPath(path) {
  const parts = path.split("/");
  const buildingsIndex = parts.indexOf("buildings");

  if (buildingsIndex === -1 || buildingsIndex + 1 >= parts.length) {
    return null;
  }

  const biome = parts[buildingsIndex + 1];
  const maybeFeature = parts[buildingsIndex + 2];

  return {
    biome,
    feature: FEATURE_BUILDING_FOLDERS.has(maybeFeature) ? maybeFeature : null,
  };
}

export async function loadBuildingTextures() {
  const entries = await Promise.all(
    Object.entries(buildingModules).map(async ([path, src]) => {
      const info = getBuildingInfoFromPath(path);
      if (!info || !useLegacyBuilding(path.split("/").pop(), info.feature)) return null;

      return {
        ...info,
        name: path.split("/").pop(),
        src,
        image: await loadImage(src),
      };
    }),
  );

  const textures = {};

  for (const entry of entries) {
    if (!entry) continue;

    addBuildingAsset(textures, entry.biome, prepareBuildingAsset(entry.image, {
      name: entry.name,
      feature: entry.feature,
    }, createCanvas));
  }

  for (const atlas of BUILDING_ATLASES) {
    const image = await loadImage(atlasModules[`../assets/building-atlases/${atlas.file}`]);
    for (const asset of prepareBuildingAtlas(image, atlas, createCanvas)) {
      addBuildingAsset(textures, atlas.biome, asset);
    }
  }

  return textures;
}
