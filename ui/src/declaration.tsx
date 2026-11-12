// FreeCol's DeclarationPanel: the whole window is the picture of the Declaration of Independence, and the
// player's name is signed across it in handwriting, stroke by stroke, from FreeCol's animated signature font.
// It closes when signed, or on a click or a key.

import { useEffect, useRef, useState } from 'react';
import { SIGNATURE_FONT_FILE, PANEL_KEYS } from './map-keys';
import { parseFAF, signatureName, type FAFont } from './signature';
import type { Art } from './frame';
import './declaration.css';

/** The picture's size (image.flavor.Declaration), at FreeCol's scale 1. */
export const DECLARATION_SIZE = { width: 525, height: 624 };
/** DeclarationPanel.SIGNATURE_Y: where the signature's line sits in the picture. */
const SIGNATURE_Y = 450;

/** DeclarationPanel's delays and pace, in ms and points; tests make them short. */
export const declarationTiming = {
  /** Before the signing starts. */
  start: 2000,
  /** Between the signature's steps. */
  tick: 15,
  /** The points drawn in each step. */
  step: 3,
  /** After the signing, before the panel closes by itself. */
  finish: 5000,
};

/** Where the signature font is fetched from, and how: only when the Declaration opens, once. */
export const signatureFont = {
  url: `art/${SIGNATURE_FONT_FILE}`,
  load: (): Promise<FAFont> => {
    cached ??= fetch(signatureFont.url).then(async (r) => {
      if (!r.ok) throw new Error(`${signatureFont.url}: ${r.status}`);
      return parseFAF(await r.text());
    });
    // A failed fetch is tried again the next time the Declaration opens.
    cached.catch(() => (cached = undefined));
    return cached;
  },
};
let cached: Promise<FAFont> | undefined;

/** A phase of the panel: waiting for the signing to start, signing, signed. */
type Phase = 'waiting' | 'signing' | 'signed';

export function Declaration({
  name,
  title,
  art,
  done,
}: {
  /** The name to sign: the player's. */
  name: string;
  /** What the window is called for a screen reader. */
  title: string;
  art: Art;
  /** Close the panel. */
  done: () => void;
}) {
  const src = art([PANEL_KEYS.declaration]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [font, setFont] = useState<FAFont | null>(null);
  const [fit, setFit] = useState(() => fitOf(window));
  const closing = useRef(done);
  closing.current = done;
  // FreeCol scales its images up on a high resolution screen, and so does the brush (a 2 pixel one).
  const [scale] = useState(() => (window.devicePixelRatio >= 2 ? 2 : 1));

  useEffect(() => {
    const resize = () => setFit(fitOf(window));
    addEventListener('resize', resize);
    return () => removeEventListener('resize', resize);
  }, []);

  // Close once, on a key or a click (the click is on the panel itself).
  const closed = useRef(false);
  const close = () => {
    if (closed.current) return;
    closed.current = true;
    closing.current();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A key held down from the dialog before it is not the player's answer to this one.
      if (e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    addEventListener('keydown', onKey, { capture: true });
    return () => removeEventListener('keydown', onKey, { capture: true });
  }, []);

  // The font is fetched now, when the panel opens, and not before.
  useEffect(() => {
    let live = true;
    signatureFont.load().then(
      (f) => live && setFont(f),
      () => live && setPhase('signed'), // no handwriting to wait for: the panel closes by itself
    );
    return () => {
      live = false;
    };
  }, []);

  const text = font ? signatureName(font, name, DECLARATION_SIZE.width - 10) : '';
  const points = font && text !== '' ? font.points(text) : [];
  const size = font && text !== '' ? font.dimension(text) : { width: 0, height: 0 };

  // The signing starts after the delay, once the font is here, and draws a few points at a time.
  const begin = useRef(Date.now());
  useEffect(() => {
    if (!font) return;
    const ctx = canvas.current?.getContext('2d') ?? null;
    let counter = 0;
    let tick: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      clearInterval(tick);
      setPhase('signed');
    };
    const step = () => {
      const from = counter;
      counter = Math.min(points.length, counter + declarationTiming.step);
      if (ctx) {
        ctx.fillStyle = getComputedStyle(canvas.current!).color; // the ink, a token in the page's CSS
        const brush = scale > 1 ? 2 : 1;
        for (const p of points.slice(from, counter)) {
          const x = Math.trunc(p.x * scale);
          const y = Math.trunc(p.y * scale);
          ctx.fillRect(x, y, brush, brush);
          ctx.fillRect(x - 1, y + 1, brush, brush);
        }
      }
      if (canvas.current) canvas.current.dataset.drawn = String(counter);
      if (counter >= points.length) stop();
    };
    const wait = Math.max(0, declarationTiming.start - (Date.now() - begin.current));
    const start = setTimeout(() => {
      setPhase('signing');
      if (points.length === 0) return stop();
      tick = setInterval(step, declarationTiming.tick);
    }, wait);
    return () => {
      clearTimeout(start);
      clearInterval(tick);
    };
  }, [font]);

  // Once signed, the panel closes by itself after a while.
  useEffect(() => {
    if (phase !== 'signed') return;
    const finish = setTimeout(close, declarationTiming.finish);
    return () => clearTimeout(finish);
  }, [phase]);

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="declaration"
      data-kind="declaration"
      data-phase={phase}
      onClick={close}
      style={{ width: DECLARATION_SIZE.width, height: DECLARATION_SIZE.height, transform: `scale(${fit})` }}
    >
      {src ? <img src={src} alt="" draggable={false} /> : <div className="paper" />}
      {points.length > 0 && (
        <canvas
          ref={canvas}
          data-signature={text}
          width={size.width * scale}
          height={size.height * scale}
          style={{
            width: size.width,
            height: size.height,
            left: (DECLARATION_SIZE.width - size.width) / 2,
            // DeclarationPanel: the signature is centred between the picture's middle and its line.
            top: (DECLARATION_SIZE.height + SIGNATURE_Y - size.height) / 2 - 15,
          }}
        />
      )}
    </section>
  );
}

/** How much the window shrinks to fit the page, which it never grows past FreeCol's size to fill. */
function fitOf(w: { innerWidth: number; innerHeight: number }): number {
  return Math.min(1, (w.innerWidth - 24) / DECLARATION_SIZE.width, (w.innerHeight - 24) / DECLARATION_SIZE.height);
}
