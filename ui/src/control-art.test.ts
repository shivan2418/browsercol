// @vitest-environment jsdom
import { expect, test } from 'vite-plus/test';
import html from '../index.html?raw';
import { controlArt } from './control-art';

test('the control images are set as absolute URLs on the root, and removed when the art has none', () => {
  const root = document.createElement('div');
  controlArt(root, (keys) => (keys[0] === 'image.ui.checkmark' ? 'art/base/checkmark.png' : null));
  expect(root.style.getPropertyValue('--img-checkmark')).toMatch(/^url\("https?:\/\/.*\/art\/base\/checkmark\.png"\)$/);
  expect(root.style.getPropertyValue('--img-radio-dot')).toBe('');
  controlArt(root, () => null);
  expect(root.style.getPropertyValue('--img-checkmark')).toBe('');
});

/** The body of the page's `nth` CSS rule whose selector list ends with `selector`. */
function rule(selector: string, nth = 1): string {
  let at = -1;
  for (let i = 0; i < nth; i++) at = html.indexOf(`${selector} {`, at + 1);
  expect(at, selector).toBeGreaterThan(0);
  return html.slice(at, html.indexOf('}', at));
}

test('before the art has loaded, a ticked box shows a drawn tick and a picked radio button a round dot (#311)', () => {
  // With no mask at all the mark fills its box: a solid square, which reads as neither ticked nor not.
  expect(rule("input[type='radio']::after").replace(/\s+/g, ' ')).toMatch(
    /mask: var\( --img-checkmark, url\("data:image\/svg\+xml,/,
  );
  expect(rule("input[type='radio']::after", 2)).toMatch(/border-radius: 50%/);
});
