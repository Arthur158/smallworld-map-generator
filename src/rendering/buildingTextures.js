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

function createBuildingTextureGroup() {
  return {
    default: [],
    magic: [],
    mine: [],
    cave: [],
  };
}

function ensureBuildingTextureGroup(textures, biome) {
  if (!textures[biome]) {
    textures[biome] = createBuildingTextureGroup();
  }

  return textures[biome];
}

export async function loadBuildingTextures() {
  const entries = await Promise.all(
    Object.entries(buildingModules).map(async ([path, src]) => {
      const info = getBuildingInfoFromPath(path);
      if (!info) return null;

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

    const group = ensureBuildingTextureGroup(textures, entry.biome);
    const bucket = entry.feature ?? "default";

    group[bucket].push({
      name: entry.name,
      image: entry.image,
      feature: entry.feature,
    });
  }

  return textures;
}
