import type { Point } from '@/services/contracts/editing';

export interface Rect { x: number; y: number; width: number; height: number }
export function containRect(photoWidth: number, photoHeight: number, width: number, height: number): Rect {
  const scale = Math.min(width / photoWidth, height / photoHeight);
  const result = { width: photoWidth * scale, height: photoHeight * scale };
  return { x: (width - result.width) / 2, y: (height - result.height) / 2, ...result };
}
export function toNormalized(x: number, y: number, rect: Rect): Point | null {
  const nx = (x - rect.x) / rect.width;
  const ny = (y - rect.y) / rect.height;
  return nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 ? { x: nx, y: ny } : null;
}
export function toScreen(point: Point, rect: Rect): Point {
  return { x: rect.x + point.x * rect.width, y: rect.y + point.y * rect.height };
}
