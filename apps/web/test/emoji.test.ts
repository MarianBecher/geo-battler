import { describe, expect, it } from 'vitest';
import { EMOJI, glyphsOnly, glyphSvg, renderGlyphs, shortcodeAt, suggest } from '../src/emoji.ts';

describe('renderGlyphs', () => {
  it('turns known codes into drawings and leaves the rest alone', () => {
    const out = renderGlyphs('well :shrug: then');
    expect(out).toMatch(/^well <svg class="glyph".*<\/svg> then$/);
    expect(out).toContain('aria-label=":shrug:"');
    expect(renderGlyphs('at 10:30: nothing')).toBe('at 10:30: nothing');
    expect(renderGlyphs(':nosuchthing:')).toBe(':nosuchthing:');
  });

  it('does not care about case', () => {
    expect(renderGlyphs(':FIRE:')).toBe(glyphSvg('fire'));
  });

  it('has a drawing for every code, with nothing but shapes and groups in it', () => {
    for (const e of EMOJI) {
      const tags = [...e.glyph.matchAll(/<([a-z]+)/g)].map((m) => m[1]);
      expect(tags.length, e.code).toBeGreaterThan(0);
      expect(tags.every((t) => ['path', 'circle', 'rect', 'ellipse', 'g'].includes(t!)), e.code).toBe(true);
    }
  });
});

describe('shortcodeAt', () => {
  it('finds the code being typed at the caret', () => {
    expect(shortcodeAt('hi :shr', 7)).toEqual({ start: 3, query: 'shr' });
    expect(shortcodeAt(':', 1)).toEqual({ start: 0, query: '' });
  });

  it('ignores colons inside words and closed codes', () => {
    expect(shortcodeAt('10:30', 5)).toBeNull();
    expect(shortcodeAt(':shrug: ', 8)).toBeNull();
    expect(shortcodeAt('hi', 2)).toBeNull();
  });
});

describe('suggest', () => {
  it('puts codes that start with the query first', () => {
    const codes = suggest('s').map((e) => e.code);
    expect(codes[0]).toBe('smile');
    expect(codes.length).toBeLessThanOrEqual(6);
  });

  it('falls back to codes containing the query', () => {
    expect(suggest('post').map((e) => e.code)).toEqual(['signpost']);
    expect(suggest('sun').map((e) => e.code)).toEqual(['sun']);
  });
});

describe('glyphsOnly', () => {
  it('is true for known codes and spaces only', () => {
    expect(glyphsOnly(':shrug:')).toBe(true);
    expect(glyphsOnly(':fire: :fire: :trophy:')).toBe(true);
  });

  it('is false with text, unknown codes or nothing at all', () => {
    expect(glyphsOnly('nice :fire:')).toBe(false);
    expect(glyphsOnly(':nosuchthing:')).toBe(false);
    expect(glyphsOnly('')).toBe(false);
  });
});
