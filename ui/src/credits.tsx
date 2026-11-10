// The credits window: who made BrowserCol's code, art, music and sounds, under which licences, and
// where the source is. The GPL asks that players can get the source; CC BY asks that the authors are named
// where their work is used. The entries follow the README beside each file under freecol/data/.
// Opened from the start screen and from the Colopedia menu (FreeCol's About entry sits there too).
import type { ReactNode } from 'react';
import { BUILD } from './build';
import { Heading, WindowFrame } from './frame';
import './credits.css';
// The fonts' licence texts, shipped in dist/ with the fonts (fonts.css).
import cinzelOfl from './fonts/cinzel/OFL.txt?url';
import notoSansOfl from './fonts/noto-sans/OFL.txt?url';
import { useCoverage } from './coverage';

export const SOURCE_URL = 'https://github.com/shivan2418/browsercol';
export const FREECOL_URL = 'https://github.com/FreeCol/freecol';

const GPL = 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html';
const CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/';
const CC_BY_3 = 'https://creativecommons.org/licenses/by/3.0/';
const CC_BY_SA = 'https://creativecommons.org/licenses/by-sa/3.0/';
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';

interface Credit {
  /** What the work is. */
  what: string;
  /** Who made it, and where it came from. */
  who: string;
  licence?: { name: string; url: string };
  source?: string;
}

/** The art, music and sounds whose authors or licences differ from FreeCol's own. */
export const ASSET_CREDITS: readonly Credit[] = [
  {
    what: 'Music: El Dorado, Fearless Sailors, Founders, Free Colonist, Lost City, Rainy Day, Royal Troops, Settlers’ Routine, Sunrise, Tailwind, Wagon Wheels',
    who: 'Alexander Zhelanov',
    licence: { name: 'CC BY 4.0', url: CC_BY_4 },
  },
  { what: 'Music: Music Box', who: 'Stian Grenborgen', licence: { name: 'CC BY 4.0', url: CC_BY_4 } },
  {
    what: 'River bed (pebbles), modified',
    who: 'from OpenGameArt “Pebbles surface”',
    licence: { name: 'CC BY 3.0', url: CC_BY_3 },
    source: 'https://opengameart.org/content/pebbles-surface',
  },
  {
    what: 'Meat goods icon',
    who: 'derived from 0 A.D.’s action-gather-meat.png',
    licence: { name: 'CC BY-SA', url: CC_BY_SA },
  },
  {
    what: 'Ocean and river water',
    who: 'zookeeper and Zabin, from The Battle for Wesnoth',
    licence: { name: 'CC0', url: CC0 },
    source: 'https://opengameart.org/content/the-battle-for-wesnoth-water-animation',
  },
  {
    what: 'Desert terrain, colourised',
    who: 'from OpenGameArt “2048 digitally painted tileable desert sand texture”',
    licence: { name: 'CC0', url: CC0 },
    source: 'https://opengameart.org/content/2048-digitally-painted-tileable-desert-sand-texture',
  },
  {
    what: 'Game bonus (deer)',
    who: 'CDmir',
    licence: { name: 'CC0', url: CC0 },
    source: 'https://opengameart.org/content/old-deer-male',
  },
  {
    what: 'Map backgrounds and report images',
    who: 'David Rumsey Map Collection',
    source: 'https://www.davidrumsey.com',
  },
  {
    what: 'Noto Sans font',
    who: 'The Noto Project Authors',
    licence: { name: 'SIL OFL 1.1', url: notoSansOfl },
    source: 'https://github.com/notofonts/latin-greek-cyrillic',
  },
  {
    what: 'Cinzel font',
    who: 'The Cinzel Project Authors (Natanael Gama)',
    licence: { name: 'SIL OFL 1.1', url: cinzelOfl },
    source: 'https://github.com/NDISCOVER/Cinzel',
  },
  { what: 'ShadowedBlack font', who: 'Paul Lloyd' },
  {
    what: 'Alert sound, derived',
    who: 'acclivity on Freesound',
    source: 'https://freesound.org/people/acclivity/sounds/32304/',
  },
];

/** The libraries in the page, with their licences. */
export const LIBRARY_CREDITS: readonly Credit[] = [
  {
    what: 'TeaVM',
    who: 'Alexey Andreev and contributors',
    licence: { name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
  },
  {
    what: 'PixiJS',
    who: 'PixiJS contributors',
    licence: { name: 'MIT', url: 'https://github.com/pixijs/pixijs/blob/dev/LICENSE' },
  },
  {
    what: 'React',
    who: 'Meta Platforms and contributors',
    licence: { name: 'MIT', url: 'https://github.com/facebook/react/blob/main/LICENSE' },
  },
];

const Link = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
);

function Credits({ list }: { list: readonly Credit[] }) {
  return (
    <ul>
      {list.map((c) => (
        <li key={c.what}>
          {c.source ? <Link href={c.source}>{c.what}</Link> : c.what}: {c.who}
          {c.licence && (
            <>
              {' '}
              (<Link href={c.licence.url}>{c.licence.name}</Link>)
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The source and licence links, as the start screen shows them under its window. */
export function SourceLinks({ credits }: { credits: () => void }) {
  return (
    <p className="source-links">
      Free software under the <Link href={GPL}>GNU GPL</Link> · <Link href={SOURCE_URL}>Source code</Link> ·{' '}
      <button type="button" className="linkish" data-credits onClick={credits}>
        Credits
      </button>{' '}
      · <span data-build>{BUILD}</span>
    </p>
  );
}

export function CreditsDialog({ close }: { close: () => void }) {
  useCoverage('showAboutPanel');
  return (
    <div className="modal">
      <WindowFrame title="About BrowserCol" close={close} id="credits" className="dialog">
        <div className="credits-body">
          <p>
            BrowserCol is FreeCol in the browser: FreeCol’s own Java code, compiled to WebAssembly, under a new
            interface. It is an unofficial port, not made by the FreeCol Team.
          </p>
          <p>
            FreeCol is copyright © 2002–2024 The FreeCol Team. BrowserCol is free software: you can redistribute it and
            modify it under the terms of the <Link href={GPL}>GNU General Public License</Link>, version 2 or (at your
            option) any later version. It comes with no warranty.
          </p>
          <p>Build: {BUILD}</p>
          <Heading space="section">Source code</Heading>
          <ul>
            <li>
              BrowserCol: <Link href={SOURCE_URL}>{SOURCE_URL}</Link>
            </li>
            <li>
              FreeCol: <Link href={FREECOL_URL}>{FREECOL_URL}</Link>
            </li>
          </ul>
          <Heading space="section">Art, fonts, music and sounds</Heading>
          <p>
            Most of FreeCol’s art, music and sounds are by the FreeCol Team under the GPL v2. These are by others, or
            under other licences:
          </p>
          <Credits list={ASSET_CREDITS} />
          <Heading space="section">Libraries</Heading>
          <Credits list={LIBRARY_CREDITS} />
        </div>
      </WindowFrame>
    </div>
  );
}
