// Use opaque interior rock paint from each atlas panel. The unneeded display
// background and grass/foam outside those rectangles never enter the mesh.
export const COAST_ATLAS = { file: "painted-rock-faces.png" };
const frames = [
  [40, 170, 680, 70], [800, 170, 680, 70],
  [40, 495, 680, 55], [800, 495, 680, 55],
  [40, 800, 680, 60], [800, 800, 680, 60],
];

export function prepareCoastAtlas(image) {
  const scaleX = (image.naturalWidth || image.width) / 1536;
  const scaleY = (image.naturalHeight || image.height) / 1024;
  return frames.map(([x, y, width, height], index) => ({
    name: `painted-coast-${index}`, image,
    sourceRect: { x: x * scaleX, y: y * scaleY, width: width * scaleX, height: height * scaleY },
  }));
}
