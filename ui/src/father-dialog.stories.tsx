// The choose founding father dialog as the game asks it, with the game's own art and FreeCol's own text;
// OK and closing do nothing.
import { useMemo } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { dialogs } from './dialogs';
import { DialogHost } from './panels';
import { art } from './story-art';
import type { GuiQuestions } from './webgui';

type Ask = GuiQuestions['father']['ask'];

const none = new Proxy({}, { get: () => () => {} }) as never;

/** A father as the Engine sends it, its text from FreeColMessages.properties. */
const father = (id: string, kind: string, name: string, born: string, description: string, text: string) => ({
  id: `model.foundingFather.${id}`,
  kind,
  name,
  description,
  born,
  text,
  keys: [`image.flavor.model.foundingFather.${id}`],
});

/** One father of each kind, in FreeCol's order of kinds, as the Engine offers them. */
const offer: Ask = {
  title: 'Nominate Founding Father',
  ok: 'OK',
  fathers: [
    father(
      'adamSmith',
      'Trade',
      'Adam Smith',
      '1723-1790',
      'Enables building of factories.',
      'Better known as the Father of Modern Economics, Smith penned several texts pertaining to Economic theory, including, The Wealth of Nations his most famous text.',
    ),
    father(
      'thomasJefferson',
      'Political',
      'Thomas Jefferson',
      '1743-1826',
      'Increases Liberty Bell production in colonies by 50%.',
      'A powerful voice of Patriotism, Jefferson was credited with writing the Declaration of Independence. He later became the 3rd President of the U.S.',
    ),
    father(
      'paulRevere',
      'Military',
      'Paul Revere',
      '1734-1818',
      'When a colony with no standing soldiers is attacked, a colonist automatically takes up any stockpiled muskets and defends.',
      'The famed rider of colonial America mounted his horse and rode through the countryside alerting colonists that British soldiers were coming. He was captured during the ride and later released when his captors believed they were in grave danger and their prisoner might slow them down.',
    ),
    father(
      'williamBrewster',
      'Religious',
      'William Brewster',
      '1567-1644',
      'No more criminals or servants appear on the docks, and you can select which immigrant in the recruitment pool to move to the docks.',
      'Brewster was the Puritan leader of the Plymouth colony in New England.',
    ),
    father(
      'hernandoDeSoto',
      'Exploration',
      'Hernando de Soto',
      '1496-1542',
      'Exploration of Lost City Rumors never yields a negative result and all land units have an extended sight radius.',
      'First European to explore Florida and the southeastern U.S. He also held a prominent role in conquests of Central America.',
    ),
  ],
};

/** The dialog, asked through the same DialogHost the page uses. */
function FatherDialog({ ask }: { ask: Ask }) {
  const box = useMemo(() => {
    const b = dialogs();
    void b.ask('father', ask);
    return b;
  }, [ask]);
  return <DialogHost dialogs={box} goTo={() => {}} art={art} report={none} routes={none} />;
}

const meta: Meta<typeof FatherDialog> = { component: FatherDialog, args: { ask: offer } };
export default meta;

export const Default: StoryObj<typeof FatherDialog> = {};

/** Late in the game fewer kinds may have a father left to offer. */
export const TwoKindsLeft: StoryObj<typeof FatherDialog> = {
  args: { ask: { ...offer, fathers: [offer.fathers[1], offer.fathers[4]] } },
};
