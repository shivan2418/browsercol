// THROWAWAY PROTOTYPE (branch prototype/cargo-holds): cargo hold variants in three contexts. ← and → (or the
// switcher at the bottom) cycle the variants; the choice stays in the `variant` arg, which Storybook keeps in the
// URL (&args=variant:cutaway), and the iframe also takes ?variant=cutaway.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { CargoHoldPrototype, VARIANTS, type Context, type VariantId } from './cargo-hold.prototype';
import { art } from './story-art';

type Args = { variant: VariantId; context: Context | 'all' };

const fromUrl = new URLSearchParams(window.location.search).get('variant');
const initial: VariantId = VARIANTS.find((v) => v.id === fromUrl)?.id ?? 'slots';

const meta: Meta<Args> = {
  title: 'Prototype/Cargo hold',
  args: { variant: initial, context: 'all' },
  argTypes: {
    variant: { control: 'inline-radio', options: VARIANTS.map((v) => v.id) },
    context: { control: 'inline-radio', options: ['all', 'colony', 'europe', 'info'] },
  },
  render: function Render(args) {
    const [, update] = useArgs<Args>();
    return (
      <CargoHoldPrototype
        variant={args.variant}
        context={args.context}
        setVariant={(variant) => update({ variant })}
        art={art}
      />
    );
  },
};
export default meta;

export const AllContexts: StoryObj<Args> = {};
export const ColonyCargo: StoryObj<Args> = { args: { context: 'colony' } };
export const EuropeCargo: StoryObj<Args> = { args: { context: 'europe' } };
export const InfoPanel: StoryObj<Args> = { args: { context: 'info' } };
