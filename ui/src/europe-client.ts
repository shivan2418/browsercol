// What the Europe panel does for the player: recruit, train and buy units, load a unit on a ship and send
// the ship to the New World, and trade goods in the market. Set once the client Engine has loaded
// (main.tsx); each is a client command (Commands.recruitUnit and the others), after which the Engine sends
// the panel again.
export interface EuropeButtons {
  recruit: (index: number) => void;
  train: (unitTypeId: string) => void;
  board: (unitId: string, shipId: string) => void;
  /** Take a unit off the ship it is aboard, onto the docks. */
  leave: (unitId: string) => void;
  /** Buy goods of a type onto a ship in port; ask has the Engine ask how much, else it buys the most. */
  buy: (goodsTypeId: string, shipId: string, ask: boolean) => void;
  /** Sell a stack of a ship's cargo; ask has the Engine ask how much of it, else all is sold. */
  sell: (goodsTypeId: string, shipId: string, ask: boolean) => void;
  sail: (shipId: string) => void;
}

export const europeButtons: EuropeButtons = {
  recruit: () => {},
  train: () => {},
  board: () => {},
  leave: () => {},
  buy: () => {},
  sell: () => {},
  sail: () => {},
};
