// What the Europe panel does for the player: recruit, train and buy units, load a unit on a ship and send
// the ship to the New World, and trade goods in the market. Set once the client Engine has loaded
// (main.tsx); each is a client command (Commands.recruitUnit and the others), after which the Engine sends
// the panel again.
export interface EuropeButtons {
  recruit: (index: number) => void;
  train: (unitTypeId: string) => void;
  board: (unitId: string, shipId: string) => void;
  /** Buy goods of a type onto a ship in port; the Engine asks how much. */
  buy: (goodsTypeId: string, shipId: string) => void;
  /** Sell a stack of a ship's cargo; the Engine asks how much of it. */
  sell: (goodsTypeId: string, shipId: string) => void;
  sail: (shipId: string) => void;
}

export const europeButtons: EuropeButtons = {
  recruit: () => {},
  train: () => {},
  board: () => {},
  buy: () => {},
  sell: () => {},
  sail: () => {},
};
