const forestModules = {
  ...import.meta.glob(
    "../assets/forests/**/*.{png,jpg,jpeg,webp,avif}",
    {
      eager: true,
      query: "?url",
      import: "default",
    },
  ),
  // Also support singular `assets/forest/...` in case assets are copied there.
  ...import.meta.glob(
    "../assets/forest/**/*.{png,jpg,jpeg,webp,avif}",
    {
      eager: true,
      query: "?url",
      import: "default",
    },
  ),
};

const mountainModules = import.meta.glob(
  "../assets/mountains/**/*.{png,jpg,jpeg,webp,avif}",
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
    image.onerror = () => reject(new Error(`Could not load scenery image: ${src}`));
    image.src = src;
  });
}

function getFolderAfter(path, folderName) {
  const parts = path.split("/");
  const index = parts.indexOf(folderName);

  if (index === -1 || index + 1 >= parts.length) {
    return null;
  }

  return parts[index + 1];
}

export async function loadSceneryTextures() {
  const forests = {
    pine: [],
    normal: [],
  };

  const forestEntries = await Promise.all(
    Object.entries(forestModules).map(async ([path, src]) => {
      const group = getFolderAfter(path, "forests") ?? getFolderAfter(path, "forest");

      if (!group) return null;

      return {
        group,
        name: path.split("/").pop(),
        image: await loadImage(src),
      };
    }),
  );

  for (const entry of forestEntries) {
    if (!entry) continue;

    // Expected folders:
    // src/assets/forests/pine/*.png
    // src/assets/forests/normal/*.png
    const group = entry.group === "pine" ? "pine" : "normal";

    forests[group].push({
      name: entry.name,
      image: entry.image,
    });
  }

  const mountains = [];

  const mountainEntries = await Promise.all(
    Object.entries(mountainModules).map(async ([path, src]) => ({
      name: path.split("/").pop(),
      image: await loadImage(src),
    })),
  );

  for (const entry of mountainEntries) {
    mountains.push(entry);
  }

  return {
    forests,
    mountains,
  };
}
