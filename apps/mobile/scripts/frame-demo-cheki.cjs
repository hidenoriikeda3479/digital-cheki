// Offline composition for generated mock assets only. Uses the already installed Skia/CanvasKit runtime.
const fs = require('node:fs');
const path = require('node:path');
const init = require('canvaskit-wasm/bin/full/canvaskit');

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || fs.existsSync(output)) throw Error('Pass an input image and a new output filename');
  const kit = await init({ locateFile: (file) => require.resolve(`canvaskit-wasm/bin/full/${file}`) });
  const surface = kit.MakeSurface(864, 1376); // 54 x 86 mm, 16 pixels per mm.
  const image = kit.MakeImageFromEncoded(fs.readFileSync(input));
  if (!surface || !image) throw Error('Cannot compose the generated photo');
  const canvas = surface.getCanvas();
  const paint = new kit.Paint();
  paint.setAntiAlias(true);
  canvas.clear(kit.WHITE);
  const targetRatio = 46 / 62;
  const width = Math.min(image.width(), image.height() * targetRatio);
  const height = width / targetRatio;
  canvas.drawImageRect(image, kit.XYWHRect((image.width() - width) / 2, (image.height() - height) / 2, width, height),
    kit.XYWHRect(64, 64, 736, 992), paint);
  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  const bytes = snapshot.encodeToBytes(kit.ImageFormat.JPEG, 86);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, bytes);
  snapshot.delete(); paint.delete(); image.delete(); surface.delete();
  process.stdout.write(`${path.basename(output)}: 864x1376, ${bytes.length} bytes\n`);
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
