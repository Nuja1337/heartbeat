// The skin: settings.skin and the palette table turned into ready-made colour strings (PLAN-2 5.4).
// The renderer resolves it when the settings change, so no frame builds a colour string.

import { PALETTES } from '../../shared/catalog';
import type { ApproachStyle, CursorStyle, Judgment, PaletteId, Settings } from '../../shared/types';
import { hexAlpha } from './theme';

/** Index of each judgment in `Skin.judge`. */
export const JUDGE_INDEX: Record<Judgment, number> = { crisp: 0, solid: 1, rough: 2, miss: 3 };
export const JUDGE_ORDER: readonly Judgment[] = ['crisp', 'solid', 'rough', 'miss'];

interface PaletteStrings {
  palette: PaletteId;
  /** Target ring colours, one per colour group. */
  groups: readonly string[];
  /** The same at 30% alpha, for the fill approach style. */
  groupFill: readonly string[];
  /** The same at 22% alpha, for the halo around a target. */
  groupGlow: readonly string[];
  /** The same at 18% alpha, for the centre line of a slider. */
  groupLine: readonly string[];
  /** Crisp, Solid, Rough and Miss, as hex. */
  judge: readonly string[];
  /** The miss colour at 0 and at full alpha, for the edge flash. */
  missClear: string;
  missSolid: string;
  /** Judgment colours then group colours, indexed by the effects pools. */
  fx: readonly string[];
}

export interface Skin extends PaletteStrings {
  approach: ApproachStyle;
  cursorStyle: CursorStyle;
  fieldGrid: boolean;
  clickRipple: boolean;
  /** Changes whenever a baked bitmap (target sprites, slider bodies, the field) has to be drawn again. */
  bitmapKey: string;
}

const palettes = new Map<PaletteId, PaletteStrings>();

function paletteStrings(id: PaletteId): PaletteStrings {
  const known = id in PALETTES ? id : 'heartbeat';
  let p = palettes.get(known);
  if (p) return p;
  const src = PALETTES[known];
  const judge = JUDGE_ORDER.map((j) => src.judgments[j]);
  p = {
    palette: known,
    groups: src.groups.slice(),
    groupFill: src.groups.map((c) => hexAlpha(c, 0.3)),
    groupGlow: src.groups.map((c) => hexAlpha(c, 0.22)),
    groupLine: src.groups.map((c) => hexAlpha(c, 0.18)),
    judge,
    missClear: hexAlpha(src.judgments.miss, 0),
    missSolid: hexAlpha(src.judgments.miss, 1),
    fx: [...judge, ...src.groups],
  };
  palettes.set(known, p);
  return p;
}

/** The colour group (0 to 3) of an object. */
export const groupOf = (group: number): number => ((group % 4) + 4) % 4;

/** Resolve the skin settings. The palette strings are built once per palette, and shared between skins. */
export function resolveSkin(settings: Pick<Settings, 'skin'>): Skin {
  const s = settings.skin;
  const p = paletteStrings(s.palette);
  return {
    ...p,
    approach: s.approach === 'fill' || s.approach === 'brackets' ? s.approach : 'ring',
    cursorStyle: s.cursorStyle === 'cross' || s.cursorStyle === 'dot' ? s.cursorStyle : 'ring',
    fieldGrid: s.fieldGrid,
    clickRipple: s.clickRipple,
    bitmapKey: `${p.palette}|${s.fieldGrid ? 1 : 0}`,
  };
}
