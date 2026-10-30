import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, PALETTES } from '../../shared/catalog';
import type { PaletteId, Settings } from '../../shared/types';
import { groupOf, JUDGE_INDEX, JUDGE_ORDER, resolveSkin } from './skin';

const withSkin = (patch: Partial<Settings['skin']>): Settings => ({ ...DEFAULT_SETTINGS, skin: { ...DEFAULT_SETTINGS.skin, ...patch } });
const IDS = Object.keys(PALETTES) as PaletteId[];

describe('resolveSkin', () => {
  it('takes the colours from the palette table, for every palette', () => {
    for (const id of IDS) {
      const skin = resolveSkin(withSkin({ palette: id }));
      const p = PALETTES[id];
      expect(skin.palette, id).toBe(id);
      expect(skin.groups, id).toEqual([...p.groups]);
      for (const j of JUDGE_ORDER) expect(skin.judge[JUDGE_INDEX[j]], `${id} ${j}`).toBe(p.judgments[j]);
      expect(skin.fx, id).toEqual([...skin.judge, ...p.groups]);
    }
  });

  it('builds the alpha variants once, as rgba strings of the same colour', () => {
    const skin = resolveSkin(withSkin({ palette: 'flickwise' }));
    // #5ee7f2 is the first group colour of the default palette.
    expect(skin.groupFill[0]).toBe('rgba(94, 231, 242, 0.3)');
    expect(skin.groupGlow[0]).toBe('rgba(94, 231, 242, 0.22)');
    expect(skin.groupLine[0]).toBe('rgba(94, 231, 242, 0.18)');
    expect(skin.missClear).toBe('rgba(255, 79, 106, 0)');
    expect(skin.missSolid).toBe('rgba(255, 79, 106, 1)');
    expect(skin.groupFill).toHaveLength(4);
  });

  it('shares the palette strings between skins of one palette', () => {
    const a = resolveSkin(withSkin({ palette: 'contrast', approach: 'fill' }));
    const b = resolveSkin(withSkin({ palette: 'contrast', approach: 'brackets' }));
    expect(a.groupFill).toBe(b.groupFill);
    expect(a.fx).toBe(b.fx);
    expect(resolveSkin(withSkin({ palette: 'classic' })).groupFill).not.toBe(a.groupFill);
  });

  it('copies the style choices', () => {
    const s = resolveSkin(withSkin({ approach: 'brackets', cursorStyle: 'cross', fieldGrid: false, clickRipple: false }));
    expect(s.approach).toBe('brackets');
    expect(s.cursorStyle).toBe('cross');
    expect(s.fieldGrid).toBe(false);
    expect(s.clickRipple).toBe(false);
  });

  it('falls back to the default look for values it does not know', () => {
    const s = resolveSkin(withSkin({ palette: 'nope' as PaletteId, approach: 'x' as never, cursorStyle: 'y' as never }));
    expect(s.palette).toBe('flickwise');
    expect(s.approach).toBe('ring');
    expect(s.cursorStyle).toBe('ring');
  });

  it('changes the bitmap key only when a baked bitmap would change', () => {
    const base = resolveSkin(withSkin({}));
    expect(resolveSkin(withSkin({ approach: 'fill', cursorStyle: 'dot', clickRipple: false })).bitmapKey).toBe(base.bitmapKey);
    expect(resolveSkin(withSkin({ palette: 'classic' })).bitmapKey).not.toBe(base.bitmapKey);
    expect(resolveSkin(withSkin({ fieldGrid: false })).bitmapKey).not.toBe(base.bitmapKey);
  });

  it('maps any group number to one of four colours', () => {
    expect([0, 1, 2, 3, 4, 7, -1, -4].map(groupOf)).toEqual([0, 1, 2, 3, 0, 3, 3, 0]);
  });
});
