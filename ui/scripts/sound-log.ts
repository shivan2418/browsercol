/* oxlint-disable typescript/unbound-method -- the logger wraps the prototypes' methods and calls them on `this` */
// Logs every <audio> element's life and every Web Audio source started in the page, for the browser scripts (#391): each play() call and how its
// promise ended (resolved, or the DOMException's name), each pause(), and the element's media events, with the
// time since the page began and the file (src) concerned. Printed to the script's output as "[browser] SND ...".
import type { Page } from 'playwright-core';

export async function logAudio(page: Page, name: string, out: (line: string) => void = console.log): Promise<void> {
  page.on('console', (m) => {
    if (m.text().startsWith('SND')) out(`[${name}] ${m.text()}`);
  });
  await page.addInitScript(() => {
    const t0 = performance.now();
    const log = (s: string) => console.log(`SND ${(performance.now() - t0).toFixed(0)}ms ${s}`);
    let n = 0;
    const ids = new WeakMap<object, number>();
    const id = (e: object) => (ids.has(e) ? ids.get(e)! : (ids.set(e, ++n), n));
    const short = (s: string) => s.replace(/^.*\/audio\//, '');
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const p = origPlay.call(this);
      log(`el${id(this)} play() ${short(this.src)}`);
      p.then(
        () => log(`el${id(this)} play() resolved ${short(this.src)}`),
        (ex) => log(`el${id(this)} play() REJECTED ${ex.name} ${short(this.src)}`),
      );
      return p;
    };
    const origPause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function () {
      if (this.src) log(`el${id(this)} pause() call ${short(this.src)} paused=${this.paused} rs=${this.readyState}`);
      return origPause.call(this);
    };
    // Web Audio, where the effects play (#391): each source started, with the context's state, and when it ended.
    const origStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a: [number?, number?, number?]) {
      const ctx = this.context;
      log(`source start ctx=${ctx.state} duration=${this.buffer?.duration.toFixed(2)}s`);
      this.addEventListener('ended', () => log('source ended'));
      return origStart.apply(this, a);
    };
    const origResume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      const p = origResume.call(this);
      log(`context resume() state=${this.state}`);
      p.then(
        () => log(`context resume() resolved state=${this.state}`),
        (ex: Error) => log(`context resume() REJECTED ${ex.name}`),
      );
      return p;
    };
    const OrigAudio = window.Audio;
    window.Audio = function (this: unknown, ...a: unknown[]) {
      const el = new OrigAudio(...(a as []));
      for (const ev of [
        'loadstart',
        'loadedmetadata',
        'canplay',
        'canplaythrough',
        'playing',
        'ended',
        'pause',
        'abort',
        'emptied',
        'error',
        'stalled',
      ])
        el.addEventListener(ev, () => log(`el${id(el)} event ${ev} ${short(el.src)}`));
      return el;
    } as unknown as typeof Audio;
    window.Audio.prototype = OrigAudio.prototype;
  });
}
