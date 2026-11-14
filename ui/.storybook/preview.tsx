/// <reference types="vite-plus/client" />
import '../src/theme.css';
import '../src/fonts.css';
import '../src/tokens.css';
import type { Preview } from '@storybook/react-vite';
import { watchCompact } from '../src/compact';
import { TipProvider, TooltipLayer } from '../src/controls';

// <html data-compact> as the game sets it (main.tsx), so a story at a phone's size shows sheets.
watchCompact();

const preview: Preview = {
  parameters: { layout: 'fullscreen' },
  // The player's UI scale in per cent (the Preferences' display scaling), set on the root as the game does
  // (main.tsx applyLook): the screen-fit check loads each story at each scale with &globals=uiZoom:150.
  initialGlobals: { uiZoom: 100 },
  // The hints of `Tip`, as the game shows them.
  decorators: [
    (Story, { globals }) => {
      document.documentElement.style.setProperty('--ui-zoom', String(Number(globals.uiZoom || 100) / 100));
      return <Story />;
    },
    (Story) => (
      <TipProvider>
        <TooltipLayer />
        <Story />
      </TipProvider>
    ),
  ],
};
export default preview;
