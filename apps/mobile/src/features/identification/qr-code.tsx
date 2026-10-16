import { useMemo } from 'react';
import qrFactory from 'qrcode-generator';
import Svg, { Rect } from 'react-native-svg';

/** The same qrcode-generator matrix is used for the local PC SVG fixtures. */
export function QrCode({ payload, size = 240 }: { payload: string; size?: number }) {
  const matrix = useMemo(() => {
    const code = qrFactory(0, 'M');
    code.addData(payload);
    code.make();
    const count = code.getModuleCount();
    const cells: { row: number; col: number }[] = [];
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) if (code.isDark(row, col)) cells.push({ row, col });
    }
    return { count, cells };
  }, [payload]);
  const extent = matrix.count + 8;
  return <Svg testID="member-qr" width={size} height={size} viewBox={`0 0 ${extent} ${extent}`} accessibilityLabel="会員QRコード">
    <Rect x={0} y={0} width={extent} height={extent} fill="#fff" />
    {matrix.cells.map(({ row, col }) => <Rect key={`${row}-${col}`} x={col + 4} y={row + 4} width={1} height={1} fill="#000" />)}
  </Svg>;
}
