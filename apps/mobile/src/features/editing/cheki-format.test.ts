import { CHEKI_MINI, centeredImageCrop } from './cheki-format';
import { imagePlacement, outputDimensions, sourceCrop } from './composition-geometry';

it('uses instax mini film and image ratios for capture, white frame and final JPEG', () => {
  expect(centeredImageCrop(800, 1200)).toEqual({ originX: 9, originY: 73, width: 782, height: 1054 });
  const outer = { x: 0, y: 0, width: 540, height: 860 };
  expect(imagePlacement({ frame: 'white', baseWidth: 782, baseHeight: 1054 }, outer))
    .toEqual({ x: 40, y: 40, width: 460, height: 620 });
  expect(imagePlacement({ frame: 'none', baseWidth: 782, baseHeight: 1054 }, outer)).toEqual(outer);
  expect(outputDimensions(782, 1054, 'cheki')).toEqual({ width: 1005, height: 1600 });
  expect(outputDimensions(782, 1054, 'high')).toEqual({ width: 1884, height: 3000 });
  expect(sourceCrop(782, 1054, outer).width).toBeLessThan(782);
  expect(CHEKI_MINI.image.width / CHEKI_MINI.image.height).toBe(46 / 62);
});
