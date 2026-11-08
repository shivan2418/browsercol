import { afterEach, describe, expect, it } from 'vite-plus/test';
import { currentSave, setCurrentSaveSource } from './current-save';

describe('currentSave', () => {
  afterEach(() => setCurrentSaveSource(null));

  it('fails cleanly while there is no game', async () => {
    await expect(currentSave()).rejects.toThrow('No game is running');
  });

  it('gives the bytes the source makes', async () => {
    setCurrentSaveSource(() => Promise.resolve(new Uint8Array([1, 2])));
    expect(await currentSave()).toEqual(new Uint8Array([1, 2]));
  });
});
