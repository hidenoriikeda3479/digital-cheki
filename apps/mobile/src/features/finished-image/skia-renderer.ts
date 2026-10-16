import { AppError, toAppError } from '@/core/errors';
import { elementGeometry, imagePlacement, outputDimensions, sourceCrop } from '@/features/editing/composition-geometry';
import { IMAGE_OUTPUT } from '@/features/editing/editing-config';
import type { FinishedImageRenderer } from '@/services/contracts/finished-image';

/** Offscreen composition contains only photo, white frame and saved edit elements. */
export function createSkiaFinishedImageRenderer(): FinishedImageRenderer {
  return { async render(photo, edit, sourceBytes) {
    // Resolve on first composition so startup and non-image tests do not initialize Skia.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ImageFormat, PaintStyle, Skia, StrokeCap, StrokeJoin } = require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');
    const size = outputDimensions(edit.baseWidth, edit.baseHeight, edit.quality);
    const surface = Skia.Surface.Make(size.width, size.height);
    if (!surface) throw new AppError('Storage', '画像の合成領域を確保できませんでした。');
    let source: ReturnType<typeof Skia.Image.MakeImageFromEncoded> = null;
    let snapshot: ReturnType<typeof surface.makeImageSnapshot> | null = null;
    try {
      source = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(sourceBytes));
      if (!source) throw new AppError('Storage', '元写真を読み取れませんでした。');
      const canvas = surface.getCanvas();
      const outer = { x: 0, y: 0, width: size.width, height: size.height };
      const white = Skia.Paint();
      white.setColor(Skia.Color('#ffffff'));
      canvas.drawRect(Skia.XYWHRect(0, 0, size.width, size.height), white);
      white.dispose();
      const target = imagePlacement(edit, outer);
      const crop = sourceCrop(source.width(), source.height(), target);
      const imagePaint = Skia.Paint();
      imagePaint.setAntiAlias(true);
      canvas.drawImageRect(source, Skia.XYWHRect(crop.x, crop.y, crop.width, crop.height),
        Skia.XYWHRect(target.x, target.y, target.width, target.height), imagePaint);
      imagePaint.dispose();
      for (const element of edit.elements) {
        const geometry = elementGeometry(element, outer);
        const paint = Skia.Paint();
        paint.setColor(Skia.Color(geometry.color));
        paint.setAntiAlias(true);
        if (geometry.kind === 'stroke') {
          paint.setStyle(PaintStyle.Stroke);
          paint.setStrokeWidth(geometry.width);
          paint.setStrokeCap(StrokeCap.Round);
          paint.setStrokeJoin(StrokeJoin.Round);
          const path = Skia.Path.MakeFromSVGString(geometry.path);
          if (!path) throw new AppError('Storage', '線を合成できませんでした。');
          canvas.drawPath(path, paint);
          path.dispose();
        } else if (geometry.kind === 'circle') {
          canvas.drawCircle(geometry.cx, geometry.cy, geometry.radius, paint);
        } else {
          const path = Skia.Path.MakeFromSVGString(geometry.path);
          if (!path) throw new AppError('Storage', 'スタンプを合成できませんでした。');
          canvas.drawPath(path, paint);
          path.dispose();
        }
        paint.dispose();
      }
      surface.flush();
      snapshot = surface.makeImageSnapshot();
      if (snapshot.width() !== size.width || snapshot.height() !== size.height) {
        throw new AppError('Storage', '完成画像の寸法が一致しません。');
      }
      const bytes = snapshot.encodeToBytes(ImageFormat.JPEG, IMAGE_OUTPUT.jpegQuality[edit.quality]);
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
        throw new AppError('Storage', 'JPEGの生成を確認できませんでした。');
      }
      return { bytes, width: snapshot.width(), height: snapshot.height() };
    } catch (cause) { throw toAppError(cause); }
    finally { snapshot?.dispose(); source?.dispose(); surface.dispose(); }
  } };
}
