/// <reference types="vite-plus/client" />
import '../src/theme.css';
import '../src/fonts.css';
import '../src/tokens.css';
import type { Preview } from '@storybook/react-vite';
import { TipProvider, TooltipLayer } from '../src/controls';

const preview: Preview = {
  parameters: { layout: 'fullscreen' },
  // The hints of `Tip`, as the game shows them.
  decorators: [
    (Story) => (
      <TipProvider>
        <TooltipLayer />
        <Story />
      </TipProvider>
    ),
  ],
};
export default preview;
