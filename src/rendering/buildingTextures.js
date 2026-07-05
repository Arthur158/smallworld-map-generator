const buildingModules = import.meta.glob(
  "../assets/buildings/**/*.{png,jpg,jpeg,webp,avif}",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load building image: ${src}`));
    image.src = src;
  });
}

function getBiomeFromPath(path) {
  const parts = path.split("/");
  const buildingsIndex = parts.indexOf("buildings");

  if (buildingsIndex === -1 || buildingsIndex + 1 >= parts.length) {
    return null;
  }

  return parts[buildingsIndex + 1];
}

export async function loadBuildingTextures() {
  const entries = await Promise.all(
    Object.entries(buildingModules).map(async ([path, src]) => {
      const biome = getBiomeFromPath(path);
      if (!biome) return null;

      return {
        biome,
        name: path.split("/").pop(),
        src,
        image: await loadImage(src),
      };
    }),
  );

  const textures = {};

  for (const entry of entries) {
    if (!entry) continue;
    if (!textures[entry.biome]) textures[entry.biome] = [];
      textures[entry.biome].push({
        name: entry.name,
        image: entry.image,
      });
  }

  return textures;
}
