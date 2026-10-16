/** DEC-012 / OPEN-002: provisional display geometry, to verify on iPhone. */
import { CHEKI_MINI } from './cheki-format';

export const EDITING_PREVIEW = {
  whiteFrameMargin: {
    left: CHEKI_MINI.imageOffset.x / CHEKI_MINI.outer.width,
    right: (CHEKI_MINI.outer.width - CHEKI_MINI.image.width - CHEKI_MINI.imageOffset.x) / CHEKI_MINI.outer.width,
    top: CHEKI_MINI.imageOffset.y / CHEKI_MINI.outer.height,
    bottom: (CHEKI_MINI.outer.height - CHEKI_MINI.image.height - CHEKI_MINI.imageOffset.y) / CHEKI_MINI.outer.height,
  },
  penColors: ['#111111', '#ffffff', '#e53935', '#1565c0', '#fdd835', '#2e7d32', '#e91e8f', '#f57c00'],
  penWidths: [0.003, 0.007, 0.014],
  stampSize: 0.11,
} as const;

/** OPEN-002: trial values for device measurement, not an agreed output limit. */
export const IMAGE_OUTPUT = {
  longEdge: { cheki: 1600, high: 3000 },
  jpegQuality: { cheki: 82, high: 88 },
} as const;
