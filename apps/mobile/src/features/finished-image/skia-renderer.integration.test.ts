/** @jest-environment @shopify/react-native-skia/jestEnv.js */
import { Skia } from '@shopify/react-native-skia';
import type { CapturePhoto } from '@/services/contracts/capture';
import type { PhotoEdit } from '@/services/contracts/editing';
import { createSkiaFinishedImageRenderer } from './skia-renderer';

jest.mock('@shopify/react-native-skia', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Skia's Jest build is CommonJS.
  const { Mock } = require('@shopify/react-native-skia/lib/commonjs/mock');
  return Mock((globalThis as unknown as { CanvasKit: unknown }).CanvasKit);
});

const photo: CapturePhoto = { id: 'p1', intakeId: 'i1', capturedAt: '2026-09-25T00:00:00.000Z',
  width: 2, height: 3, format: 'png', originalRef: 'photos/p1.png', thumbnailRef: 'photos/thumb-p1.jpg',
  originalUri: 'file:///p1.png', thumbnailUri: 'file:///thumb-p1.jpg' };
const edit: PhotoEdit = { schemaVersion: 1, groupId: 'group-a', intakeId: 'i1', photoId: 'p1', originalRef: photo.originalRef,
  baseWidth: 2, baseHeight: 3, frame: 'white', quality: 'cheki', revision: 2, updatedAt: photo.capturedAt,
  elements: [{ kind: 'stroke', id: 'line', color: '#e53935', width: 0.03,
    points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] },
  { kind: 'stamp', id: 'circle', stamp: 'circle', color: '#1565c0', center: { x: 0.5, y: 0.75 }, size: 0.1 }] };
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAA//8DAJcBZ2oAAAAASUVORK5CYII=', 'base64'));

it('composes actual JPEG pixels at both output dimensions without screen UI', async () => {
  const renderer = createSkiaFinishedImageRenderer();
  const standard = await renderer.render(photo, edit, png);
  expect(standard).toMatchObject({ width: 1005, height: 1600 });
  const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(standard.bytes));
  expect(image).not.toBeNull();
  expect(image?.width()).toBe(1005);
  const pixel = (x: number, y: number) => image?.readPixels(x, y, { ...image.getImageInfo(), width: 1, height: 1 });
  const margin = pixel(5, 5);
  expect(margin).not.toBeNull();
  expect(Array.from(margin!).slice(0, 3)).toEqual([255, 255, 255]);
  const photograph = pixel(502, 400);
  expect(photograph).not.toBeNull();
  expect(Array.from(photograph!).slice(0, 3)).not.toEqual([255, 255, 255]);
  const line = pixel(502, 800);
  expect(line).not.toBeNull();
  expect(line![0]).toBeGreaterThan(line![1]);
  expect(line![0]).toBeGreaterThan(line![2]);
  const stamp = pixel(502, 1200);
  expect(stamp).not.toBeNull();
  expect(stamp![2]).toBeGreaterThan(stamp![0]);
  expect(stamp![2]).toBeGreaterThan(stamp![1]);
  const high = await renderer.render(photo, { ...edit, quality: 'high' }, png);
  expect(high).toMatchObject({ width: 1884, height: 3000 });
  expect(high.bytes.length).toBeGreaterThan(100);
});
