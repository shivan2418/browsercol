// Types only, for the browser scripts: what they keep on the page's window, and the `label` option
// that common.ts's watchWaits adds to Playwright's waits.
import type { ElementHandle, JSHandle } from 'playwright-core';
import type { MapView } from '../src/tileset.ts';

/** A dialog's image, as dialogs.ts logs it. */
export interface Picture {
  kind: string | undefined;
  src: string | null;
  loaded: boolean;
}

declare global {
  interface Window {
    /** dialogs.ts: each dialog answered, as "kind: first line". */
    __dialogs: string[];
    /** dialogs.ts: each dialog answered, as "kind: every text of it". */
    __dialogTexts: string[];
    /** dialogs.ts: each dialog's images. */
    __pictures: Picture[];
    /** dialogs.ts: the units each dialog names by id. */
    __dialogUnits: { kind: string | undefined; units: (string | undefined)[] }[];
    /** dialogs.ts: the shot function the script passed, exposed to the page. */
    __shot?: (kind: string | undefined, n: number) => Promise<void>;
    /** dialogs.ts: whether the dialogs with no pictures are shown to the shot function too. */
    __shotPlain?: boolean;
    /** The dialog kind the script answers itself. */
    __hold?: string | null;
    /** scenarios.ts: when the AI's turns began (0 if they have not), and how long each took, in ms. */
    __aiAt?: number;
    __aiMs?: number[];
    /** The last map the page was sent. */
    __map: MapView;
    /** How many maps the page was sent. */
    __maps: number;
    /** saves.ts: when the page last listed the saves, and when it last got a map on its own turn. */
    __listAt: number;
    __ourMapAt: number;
    /** saves.ts, in Chromium: the files the stand-in save picker was given, by name, as byte arrays. */
    __files?: Record<string, number[]>;
    /** play.ts: whether the page's own key handler took the last key. */
    __keyTaken: boolean | null;
    __keyListener: (e: KeyboardEvent) => void;
    /** play.ts: whether a click reached the map. */
    __mapClicked: boolean;
    /** perf.ts: what the page recorded. */
    __perf: unknown;
    /** The WebGUI's own entry point, for showing a panel the Engine was not asked for (src/main.tsx). */
    fcShow: (kind: string, json: string) => void;
  }
}

/** What names a wait for its timeout message (common.ts, watchWaits). */
interface Label {
  label?: string;
}

/** A function run in the page, as Playwright's PageFunction (not exported) is. */
type PageFn<Arg, R> = string | ((arg: Arg) => R | Promise<R>);

declare module 'playwright-core' {
  interface Page {
    waitForFunction<R, Arg>(
      pageFunction: PageFn<Arg, R>,
      arg: Arg,
      options?: { polling?: number | 'raf'; timeout?: number } & Label,
    ): Promise<JSHandle<R>>;
    waitForSelector(
      selector: string,
      options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; strict?: boolean; timeout?: number } & Label,
    ): Promise<ElementHandle<SVGElement | HTMLElement> | null>;
    waitForEvent(event: string, options?: { timeout?: number; predicate?: Function } & Label): Promise<any>;
  }
  interface Locator {
    waitFor(
      options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number } & Label,
    ): Promise<void>;
  }
}
