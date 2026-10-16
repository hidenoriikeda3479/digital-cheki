import { containRect, toNormalized, toScreen } from './geometry';

it('maps portrait image points through a landscape preview without stretching', () => {
  const rect = containRect(800, 1200, 400, 400);
  expect(rect.width).toBeCloseTo(266.6667, 3);
  expect(rect.height).toBe(400);
  expect(toNormalized(0, 200, rect)).toBeNull();
  const point = { x: 0.2, y: 0.8 };
  const screen = toScreen(point, rect);
  expect(toNormalized(screen.x, screen.y, rect)).toEqual(point);
});
