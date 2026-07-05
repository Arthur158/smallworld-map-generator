import caveUrl from "../assets/icons/cave.png?url";
import magicUrl from "../assets/icons/magic.png?url";
import mineUrl from "../assets/icons/mine.png?url";

const FEATURE_ICON_URLS = {
  cave: caveUrl,
  magic: magicUrl,
  mine: mineUrl,
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load icon: ${src}`));

    image.src = src;
  });
}

export async function loadFeatureIcons() {
  const entries = await Promise.all(
    Object.entries(FEATURE_ICON_URLS).map(async ([feature, src]) => {
      return [feature, await loadImage(src)];
    }),
  );

  return Object.fromEntries(entries);
}

export function drawFeatureIcon(ctx, x, y, feature, featureIcons = {}, size = 44) {
  const image = featureIcons[feature];
  if (!image) return;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 8;
  ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
  ctx.restore();
}

export function drawObject(ctx, x, y, object) {
  if (!object) return;

  const emojiByObject = {
    village: "⌂",
    windmill: "✣",
    farm: "▱",
    ruins: "▥",
    shrine: "♜",
    tower: "♖",
    camp: "▲",
    sheep: "☁",
    standingStone: "▴",
    bones: "☠",
    hut: "⌂",
    city: "♛",
  };

  const emoji = emojiByObject[object] || "•";

  ctx.save();
  ctx.font = object === "city" ? "32px serif" : "22px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.strokeText(emoji, x, y);
  ctx.fillStyle = object === "city" ? "#fff1b4" : "#2e241c";
  ctx.fillText(emoji, x, y);
  ctx.restore();
}
