/** instax mini dimensions in millimetres. The top/bottom split is a provisional layout value. */
export const CHEKI_MINI = {
  outer: { width: 54, height: 86 },
  image: { width: 46, height: 62 },
  imageOffset: { x: 4, y: 4 },
} as const;

export function centeredImageCrop(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid camera image dimensions');
  }
  const units = Math.floor(Math.min(width / CHEKI_MINI.image.width, height / CHEKI_MINI.image.height));
  const cropWidth = units > 0 ? units * CHEKI_MINI.image.width : Math.min(width, Math.floor(height * CHEKI_MINI.image.width / CHEKI_MINI.image.height));
  const cropHeight = units > 0 ? units * CHEKI_MINI.image.height : Math.min(height, Math.floor(width * CHEKI_MINI.image.height / CHEKI_MINI.image.width));
  if (cropWidth < 1 || cropHeight < 1) throw new Error('Camera image is too small to crop');
  return { originX: Math.floor((width - cropWidth) / 2), originY: Math.floor((height - cropHeight) / 2),
    width: cropWidth, height: cropHeight };
}
