// Stand-in art for stories: every key gets a labelled coloured block, sized by what it is.
import type { Art } from './frame';

const hue = (s: string) => Array.from(s).reduce((h, c) => (h * 31 + (c.codePointAt(0) ?? 0)) % 360, 7);

export const art: Art = (keys) => {
  const k = keys[0];
  if (!k) return null;
  const [w, h] = k.includes('.unit.') ? [30, 48] : k.includes('icon.model.goods') ? [24, 24] : [120, 70];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="hsl(${hue(k)} 40% 70%)"/><text x="3" y="${h / 2}" font-size="9">${k.split('.').pop()}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
};
