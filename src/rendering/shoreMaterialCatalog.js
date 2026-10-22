// Full-bleed materials remain in screen orientation under connected shore masks.
export const SHORE_MATERIAL_ATLAS = { file: "shore-materials.png" };
export function prepareShoreMaterials(image) {
  const halfWidth = (image.naturalWidth || image.width) / 2;
  const halfHeight = (image.naturalHeight || image.height) / 2;
  return Object.fromEntries(['rock', 'sand', 'gravel', 'coldRock'].map((name, index) => [name, {
    image,
    sourceRect: { x: (index % 2) * halfWidth + 4, y: Math.floor(index / 2) * halfHeight + 4,
      width: halfWidth - 8, height: halfHeight - 8 },
  }]));
}
