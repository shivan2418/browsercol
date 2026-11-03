// The game's own art for stories, resolved as the page does (main.tsx): through the art manifest from
// scripts/build-art.mjs. Storybook serves generated/public at its root (see .storybook/main.js).
import manifest from '../generated/public/art/art.json';
import type { Art } from './frame';
import { resources } from './resources';

const res = resources(manifest.layers, manifest.files);

export const art: Art = (keys) => {
  const key = keys.find((k) => res.has(k));
  return key ? `art/${res.path(key)}` : null;
};
