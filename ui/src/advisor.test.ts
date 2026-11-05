import { expect, test } from 'vite-plus/test';
import { advisor } from './advisor';

const files: Record<string, string> = {
  'image.skin.InformationPanel': 'art/doctor-paper.png',
  'image.skin.InformationPanel.spanish': 'art/conquistador1-paper.png',
  'image.skin.InformationPanel.rebel': 'art/general-paper.png',
};
const strings: Record<string, string> = {
  'image.skin.InformationPanel.insets.top': '205',
  'image.skin.InformationPanel.spanish.insets.top': '240',
  'image.skin.InformationPanel.rebel.insets.top': '195',
};
const art = (keys: readonly string[]) => files[keys.find((k) => k in files) ?? ''] ?? null;
const string = (key: string) => strings[key] ?? 'X';

test("a nation with its own advisor gets it, with its paper's top inset", () => {
  expect(advisor(art, string, 'model.nation.spanish', true)).toEqual({ src: 'art/conquistador1-paper.png', top: 240 });
});

test('any other nation gets the doctor, and a rebel the general', () => {
  expect(advisor(art, string, 'model.nation.dutch', true)).toEqual({ src: 'art/doctor-paper.png', top: 205 });
  expect(advisor(art, string, 'model.nation.spanish', false)).toEqual({ src: 'art/general-paper.png', top: 195 });
});

test('no skin before the art has loaded, and no inset where the art names none', () => {
  expect(advisor(() => null, string, 'model.nation.dutch', true)).toBeNull();
  expect(advisor(art, () => 'X', 'model.nation.dutch', true)).toEqual({ src: 'art/doctor-paper.png', top: 0 });
});
