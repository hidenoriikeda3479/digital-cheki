import type { EditElement, EditQuality, PhotoEdit, Point, StampId } from '@/services/contracts/editing';
import { EDITING_PREVIEW, IMAGE_OUTPUT } from './editing-config';
import { CHEKI_MINI } from './cheki-format';
import { toScreen, type Rect } from './geometry';

export function outputDimensions(width: number, height: number, quality: EditQuality) {
  if (width <= 0 || height <= 0) throw new Error('Invalid source dimensions');
  const scale = IMAGE_OUTPUT.longEdge[quality] / CHEKI_MINI.outer.height;
  return { width: Math.round(CHEKI_MINI.outer.width * scale), height: IMAGE_OUTPUT.longEdge[quality] };
}

export function imagePlacement(edit: Pick<PhotoEdit, 'frame' | 'baseWidth' | 'baseHeight'>, outer: Rect): Rect {
  if (edit.frame === 'none') return outer;
  const margin = EDITING_PREVIEW.whiteFrameMargin;
  const inner = {
    x: outer.x + outer.width * margin.left,
    y: outer.y + outer.height * margin.top,
    width: outer.width * (1 - margin.left - margin.right),
    height: outer.height * (1 - margin.top - margin.bottom),
  };
  return inner;
}

/** Source crop for a destination aperture, keeping the photo undistorted. */
export function sourceCrop(sourceWidth: number, sourceHeight: number, target: Rect): Rect {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = target.width / target.height;
  if (sourceRatio > targetRatio) {
    const width = sourceHeight * targetRatio;
    return { x: (sourceWidth - width) / 2, y: 0, width, height: sourceHeight };
  }
  const height = sourceWidth / targetRatio;
  return { x: 0, y: (sourceHeight - height) / 2, width: sourceWidth, height };
}

export function strokePath(points: Point[], rect: Rect): string {
  const pathPoints = points.length === 1 ? [points[0], points[0]] : points;
  return pathPoints.map((point, index) => {
    const p = toScreen(point, rect);
    return `${index ? 'L' : 'M'} ${p.x} ${p.y}`;
  }).join(' ');
}

export function stampPath(stamp: StampId, center: Point, size: number, rect: Rect): string | null {
  if (stamp === 'circle') return null;
  const c = toScreen(center, rect);
  const r = Math.min(rect.width, rect.height) * size / 2;
  if (stamp === 'star') return Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const radius = index % 2 ? r * 0.45 : r;
    return `${index ? 'L' : 'M'} ${c.x + Math.cos(angle) * radius} ${c.y + Math.sin(angle) * radius}`;
  }).join(' ') + ' Z';
  return `M ${c.x} ${c.y + r * 0.75} C ${c.x - r * 1.6} ${c.y - r * 0.2} ${c.x - r * 0.8} ${c.y - r * 1.2} ${c.x} ${c.y - r * 0.45} C ${c.x + r * 0.8} ${c.y - r * 1.2} ${c.x + r * 1.6} ${c.y - r * 0.2} ${c.x} ${c.y + r * 0.75} Z`;
}

export function elementGeometry(element: EditElement, rect: Rect) {
  if (element.kind === 'stroke') return { kind: 'stroke' as const, path: strokePath(element.points, rect),
    color: element.color, width: Math.min(rect.width, rect.height) * element.width };
  const c = toScreen(element.center, rect);
  const radius = Math.min(rect.width, rect.height) * element.size / 2;
  return element.stamp === 'circle'
    ? { kind: 'circle' as const, cx: c.x, cy: c.y, radius, color: element.color }
    : { kind: 'filledPath' as const, path: stampPath(element.stamp, element.center, element.size, rect)!, color: element.color };
}
