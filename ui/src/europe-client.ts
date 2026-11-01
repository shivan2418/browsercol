// What the Europe panel does for the player: recruit, train and buy units, load a unit on a ship and send
// the ship to the New World. Set once the client Engine has loaded (main.tsx); each is a client command
// (Commands.recruitUnit and the others), after which the Engine sends the panel again.
export interface EuropeButtons {
  recruit: (index: number) => void;
  train: (unitTypeId: string) => void;
  board: (unitId: string, shipId: string) => void;
  sail: (shipId: string) => void;
}

export const europeButtons: EuropeButtons = { recruit: () => {}, train: () => {}, board: () => {}, sail: () => {} };
