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
  /** Sell cargo of a type; ask has the Engine ask how much, else the stack is sold (all of the type for stack 0). */
  sell: (goodsTypeId: string, shipId: string, ask: boolean, stack: number) => void;
  /** Move cargo of a type from a ship in port to another (stack 0: all of the type). */
  transfer: (fromShipId: string, toShipId: string, goodsTypeId: string, stack: number) => void;
  /** Send a ship in port away; the Engine asks where, and may warn of colonists left on the docks. */
  sail: (shipId: string) => void;
  /** Turn a ship on the high seas around. */
  redirect: (shipId: string, toEurope: boolean) => void;
  /** Empty a ship in port: sell its cargo, pay arrears on boycotted goods, put its units on the docks. */
  unload: (shipId: string) => void;
}

export const europeButtons: EuropeButtons = {
  recruit: () => {},
  train: () => {},
  board: () => {},
  leave: () => {},
  buy: () => {},
  sell: () => {},
  transfer: () => {},
  sail: () => {},
  redirect: () => {},
  unload: () => {},
};
