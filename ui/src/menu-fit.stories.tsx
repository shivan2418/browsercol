// The menu bar's menus, each opened as a player opens it, for the screen-fit check (#503, scripts/screen-fit.ts): at
// a high UI scale a long menu ran off the bottom of the screen and its last entries could not be reached. The bar sits
// in a #menubar element, as on the page, so the UI scale (the `uiZoom` global) scales it as the game does.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MENUS, MenuBar, type Menu } from './frame';
import { gameMenu, ordersMenu, reportOptionsMenu, viewMenu, type MenuActions } from './menus';
import { colopediaMenu, reportMenu } from './reports';
import { NO_MODES } from './tileset';

const actions: MenuActions = {
  ready: true,
  orders: [],
  hasActiveUnit: true,
  canDeclare: true,
  hasEurope: true,
  run: () => {},
  newGame: () => {},
  save: () => {},
  saveAndExit: () => {},
  returnToMain: () => {},
  panelShowing: false,
  open: () => {},
  zoom: () => {},
  centreOnUnit: () => {},
  preferences: () => {},
  feedback: () => {},
  modes: NO_MODES,
  toggleMode: () => {},
  setTileText: () => {},
  fog: false,
  toggleFog: () => {},
  fullScreen: false,
  toggleFullScreen: () => {},
  sidePanel: false,
  toggleSidePanel: () => {},
  mapControls: true,
  toggleMapControls: () => {},
  debug: false,
  toggleDebug: () => {},
  allowDebug: true,
};

/** The menus as the page builds them (main.tsx currentMenus), less the Debug menu, which only debug mode shows. */
const items: Record<string, Menu['items']> = {
  Game: gameMenu(actions),
  View: viewMenu(actions),
  Orders: ordersMenu(actions),
  Report: [
    ...reportMenu(
      () => {},
      () => {},
    ),
    ...reportOptionsMenu(actions),
  ],
  Colopedia: [...colopediaMenu(() => {}), { label: 'About BrowserCol', run: () => {} }],
};
const menus: Menu[] = MENUS.map((name) => ({ name, items: items[name] }));

function Bar() {
  return (
    <div id="menubar">
      <MenuBar menus={menus} status="Score: 9974 ✧ Gold: 6851 ✧ Tax: 32% ✧ Year: Spring 1632" />
    </div>
  );
}

const meta: Meta<typeof Bar> = { title: 'Screen fit menus', component: Bar, tags: ['screen-fit'] };
export default meta;
type Story = StoryObj<typeof Bar>;

/** Open the menu with this title, as a click on it does. */
const opened = (title: string): Story => ({
  play: async ({ canvasElement }) => {
    const button = [...canvasElement.querySelectorAll<HTMLElement>('[role=menubar] [role=menuitem]')].find(
      (b) => b.textContent?.trim() === title,
    );
    button?.click();
  },
});

export const Game = opened('Game');
export const View = opened('View');
export const Orders = opened('Orders');
export const Report = opened('Report');
export const Colopedia = opened('Colopedia');
