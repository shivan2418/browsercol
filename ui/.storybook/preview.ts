/// <reference types="vite-plus/client" />
import '../src/theme.css';
import '../src/fonts.css';
import type { Preview } from '@storybook/react-vite';

const preview: Preview = { parameters: { layout: 'fullscreen' } };
export default preview;
