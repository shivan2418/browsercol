import { expect, test } from 'vite-plus/test';
import html from '../index.html?raw';
import wordmark from '../brand/wordmark.svg?raw';

/** The first path's outline: the letters. */
const letters = (svg: string) => /<path\s+d="([^"]+)"/.exec(svg)![1];

test("the loading screen's wordmark has the letters of brand/wordmark.svg, in the text colour", () => {
  const mark = /<div data-loading-mark>([\s\S]*?)<\/div>/.exec(html)![1];
  expect(letters(mark)).toBe(letters(wordmark));
  expect(mark).toContain('fill="currentColor"');
  // The globes are the files build.sh serves as brand/.
  expect([...mark.matchAll(/href="\.\/brand\/(globe-[a-z]+\.svg)"/g)].map((m) => m[1])).toEqual([
    'globe-americas.svg',
    'globe-oldworld.svg',
  ]);
});
