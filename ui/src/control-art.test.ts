// @vitest-environment jsdom
import { expect, test } from 'vite-plus/test';
import { controlArt } from './control-art';

test('the control images are set as absolute URLs on the root, and removed when the art has none', () => {
  const root = document.createElement('div');
  controlArt(root, (keys) => (keys[0] === 'image.ui.checkmark' ? 'art/base/checkmark.png' : null));
  expect(root.style.getPropertyValue('--img-checkmark')).toMatch(/^url\("https?:\/\/.*\/art\/base\/checkmark\.png"\)$/);
  expect(root.style.getPropertyValue('--img-radio-dot')).toBe('');
  controlArt(root, () => null);
  expect(root.style.getPropertyValue('--img-checkmark')).toBe('');
});
