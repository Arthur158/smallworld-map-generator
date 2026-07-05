const textureModules = import.meta.glob(
  "../assets/images/**/*.{png,jpg,jpeg,webp,avif}",
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
    image.onerror = () => reject(new Error(`Could not load image: ${src}`));

    image.src = src;
  });
}

function getBiomeFromPath(path) {
  const parts = path.split("/");
  const imagesIndex = parts.indexOf("images");

  if (imagesIndex === -1 || imagesIndex + 1 >= parts.length) {
    return null;
  }

  return parts[imagesIndex + 1];
}

export async function loadBiomeTextures() {
  const entries = await Promise.all(
    Object.entries(textureModules).map(async ([path, src]) => {
      const biome = getBiomeFromPath(path);

      if (!biome) return null;

      return {
        biome,
        src,
        image: await loadImage(src),
      };
    }),
  );

  const textures = {};

  for (const entry of entries) {
    if (!entry) continue;

    if (!textures[entry.biome]) {
      textures[entry.biome] = [];
    }

    textures[entry.biome].push(entry.image);
  }

  return textures;
}
