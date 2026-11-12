// Every progress bar of the game with values past its maximum, at it, empty and negative (#483): the filled part
// and the added part stay inside the bar while the text says the real numbers.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { RebelTipBox } from './colony-panel';
import { GoodsProgressBar, WindowFrame } from './frame';
import { PROGRESS_CASES } from './progress-bar-cases';
import { art } from './story-art';

const goodsBar = (name: string, value: number, step: number, max: number) => (
  <GoodsProgressBar
    key={name}
    art={art}
    need={{
      type: 'model.goods.hammers',
      name: 'Hammers',
      keys: ['image.icon.model.goods.hammers'],
      amount: max,
      needed: max,
      available: value,
      produced: step,
      turns: '(Turns: 1)',
    }}
  />
);

const rebelBar = (value: number, step: number, max: number) => (
  <RebelTipBox
    key={`${value}/${step}/${max}`}
    art={art}
    tip={{
      members: [],
      liberty: [],
      bar: {
        keys: ['image.icon.model.goods.bells'],
        value,
        step,
        max,
        text: `${value}${step < 0 ? '-' : '+'}${Math.abs(step)}/${max} (Turns: 1)`,
      },
      turns: [],
    }}
  />
);

const meta: Meta = {
  title: 'Progress bars',
  decorators: [
    (Story) => (
      <WindowFrame className="dialog" title="Progress bars" close={() => {}}>
        <Story />
      </WindowFrame>
    ),
  ],
};
export default meta;

/** Goods bars: a building's hammers, immigration crosses, the liberty bells of a founding father. */
export const GoodsBars: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 8 }}>
      {PROGRESS_CASES.map((c) => (
        <div key={c.name}>
          <small>{c.name}</small>
          {goodsBar(c.name, c.value, c.step, c.max)}
        </div>
      ))}
    </div>
  ),
};

/** The rebel tooltip's bar, 188+21/200 among them. */
export const RebelBars: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 8 }}>
      {PROGRESS_CASES.map((c) => (
        <div key={c.name}>
          <small>{c.name}</small>
          {rebelBar(c.value, c.step, c.max)}
        </div>
      ))}
    </div>
  ),
};

export const RebelBarOverMax: StoryObj = { render: () => rebelBar(188, 21, 200) };
export const GoodsBarOverMax: StoryObj = { render: () => goodsBar('over', 188, 21, 200) };
export const GoodsBarAtMax: StoryObj = { render: () => goodsBar('at', 200, 0, 200) };
export const GoodsBarEmpty: StoryObj = { render: () => goodsBar('empty', 0, 0, 200) };
export const GoodsBarLoss: StoryObj = { render: () => goodsBar('loss', 20, -5, 200) };
