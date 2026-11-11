// The option editor's slider stays inside its own box at any font size (#456). jsdom has no layout, so this checks the
// CSS: the knob's lift is in em like the knob, never a fixed pixel length that hangs it below the slider at a large font.
import { describe, expect, it } from 'vite-plus/test';
import sheet from './option-editor.css?raw';

const style = sheet.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the option slider', () => {
  it('centres its knob by a lift that scales with the knob', () => {
    const lift = /--slider-thumb-lift:\s*([^;]+);/.exec(style)?.[1] ?? '';
    expect(lift).toContain('1.2em');
    expect(lift).not.toMatch(/^-?\d+px$/);
  });

  it('draws the knob 1.2em high, as the lift assumes', () => {
    expect(style).toMatch(/::-webkit-slider-thumb\s*\{[^}]*height:\s*1\.2em/);
    expect(style).toMatch(/::-webkit-slider-thumb\s*\{[^}]*margin-top:\s*var\(--slider-thumb-lift\)/);
  });
});
