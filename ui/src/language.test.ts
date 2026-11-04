import { describe, expect, it } from 'vite-plus/test';
import { languageName, pickLanguage, translationFiles } from './language';

/** Some of the translations FreeCol ships, as their files name them. */
const available = ['en', 'de', 'en_GB', 'es_ES', 'pt_BR', 'pt_PT', 'zh_CN', 'zh-hant', 'be-tarask', 'sr-ec'];

describe('pickLanguage', () => {
  it('keeps a language the player picked', () => {
    expect(pickLanguage('pt_PT', available, ['de-DE'])).toBe('pt_PT');
  });

  it('takes the first of the browser languages FreeCol has a translation for, when automatic', () => {
    expect(pickLanguage('automatic', available, ['tlh', 'de-AT', 'en'])).toBe('de');
    expect(pickLanguage('automatic', available, ['pt-BR'])).toBe('pt_BR');
    expect(pickLanguage('automatic', available, ['en-GB'])).toBe('en_GB');
    expect(pickLanguage('automatic', available, ['es'])).toBe('es_ES');
    expect(pickLanguage('automatic', available, ['zh-TW'])).toBe('zh-hant');
  });

  it('is English when the browser asks for none of them, or the pick is unknown', () => {
    expect(pickLanguage('automatic', available, ['tlh'])).toBe('en');
    expect(pickLanguage('automatic', available, ['en-US', 'de'])).toBe('en');
    expect(pickLanguage('xx', available, ['de'])).toBe('en');
  });
});

describe('translationFiles', () => {
  it('are the strings files FreeCol layers over its English ones for the language', () => {
    expect(translationFiles('en', available)).toEqual([]);
    expect(translationFiles('de', available)).toEqual(['strings/FreeColMessages_de.properties']);
    expect(translationFiles('pt_BR', available)).toEqual(['strings/FreeColMessages_pt_BR.properties']);
    expect(translationFiles('en_GB', available)).toEqual(['strings/FreeColMessages_en_GB.properties']);
    expect(translationFiles('pt_BR', [...available, 'pt'])).toEqual([
      'strings/FreeColMessages_pt.properties',
      'strings/FreeColMessages_pt_BR.properties',
    ]);
  });
});

describe('languageName', () => {
  it('names a language in itself', () => {
    expect(languageName('de')).toBe('Deutsch');
    expect(languageName('pt_BR')).toBe('Português (Brasil)');
    expect(languageName('sr-ec')).toBe('Српски (ћирилица)');
  });
});
