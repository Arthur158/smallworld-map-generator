import cloudAtlasUrl from "../assets/clouds/painted-clouds.png?url";
import { prepareCloudAtlas } from "./cloudAtlasCatalog.js";
import birdAtlasUrl from "../assets/wildlife/flying-birds.png?url";
import waterCliffUrl from "../assets/coasts/recessed-rock.png?url";
import { prepareBirdAtlas, DRAGON_ASSETS, prepareDragonAsset } from "./wildlifeAtlasCatalog.js";

const dragonModules = import.meta.glob("../assets/wildlife/dragon-*.png", {
  eager: true, query: "?url", import: "default",
});

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

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
    clouds: prepareCloudAtlas(await loadImage(cloudAtlasUrl), createCanvas),
    birds: prepareBirdAtlas(await loadImage(birdAtlasUrl), createCanvas),
    dragons: await Promise.all(DRAGON_ASSETS.map(async name => prepareDragonAsset(
      await loadImage(dragonModules[`../assets/wildlife/${name}`]), name, createCanvas,
    ))),
    waterCliff: await loadImage(waterCliffUrl),
  };
}
