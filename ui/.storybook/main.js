import { readFileSync } from 'node:fs';

/** The page's own CSS lives in index.html's <style> blocks; stories take it from there so they look as the game does. */
const pageStyles = [
  ...readFileSync(new URL('../index.html', import.meta.url), 'utf8').matchAll(/<style[^>]*>[\s\S]*?<\/style>/g),
]
  .map((m) => m[0])
  .join('\n');

/** @type {import('@storybook/react-vite').StorybookConfig} */
const config = {
  stories: ['../src/**/*.stories.tsx'],
  framework: '@storybook/react-vite',
  previewHead: (head) => `${head}\n${pageStyles}`,
  // The site's relative base breaks Storybook's virtual module URLs.
  viteFinal: (config) => ({ ...config, base: '/' }),
};
export default config;
