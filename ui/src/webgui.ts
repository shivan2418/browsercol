// The Browser UI's end of the WebGUI (engine/.../web/WebGUI.java, whose
// class comment lists which GUI method sends what). The client Engine calls
// fcShow(kind, json) for an event and fcAsk(id, kind, json) for a question;
// a question is answered through the client module's answer(id, value)
// export, with null for a dialog the player closed.

/** Game objects are named by their FreeCol ids, e.g. "unit:12", "tile:345". */
export type Id = string;

/** A tile, by id and by its [x, y] on the map. */
export interface TileRef {
  tile: Id | null;
  at: [number, number] | null;
}

/** Events: shown, nothing comes back. */
import type { OptionGroup } from './options';

export interface GuiEvents {
  refresh: Record<string, never>;
  /** force: after a move, SwingGUI keeps the selection and refocuses only if the unit is out of view. */
  activeUnit: { unit: Id | null; force: boolean; orders: string[]; route: string | null } & TileRef;
  /** Terrain mode: a tile is selected; the active unit is kept. */
  selectedTile: TileRef;
  /** Centre the map on a tile. */
  focus: TileRef;
  /** ok: the close button's label, as for the other panels. The tile is the object's, if it has one. */
  information: { text: string; object: Id | null; images: string[]; ok: string } & TileRef;
  error: { text: string; ok: string };
  eventPanel: { header: string; image: string | null; footer: string | null; ok: string };
  /**
   * A native settlement, as FreeCol's IndianSettlementPanel shows it to the player, with only what the
   * player has learned: an entry whose images are empty has no icon. The skill and wanted goods are
   * known after a visit, the most hated nation after contact. wanted[0] is the highly wanted goods and
   * the rest the others; tip is the last sale there. The tile is the settlement's.
   */
  indianSettlement: {
    name: string;
    /** The nation and the kind of settlement, as "Inca Capital". */
    kind: string;
    /** The settlement's tension towards the player, if any. */
    tension: string | null;
    /** Contacted but not scouted: the panel marks it. */
    worthScouting: boolean;
    images: string[];
    missionary: SettlementEntry | null;
    skill: SettlementEntry;
    mostHated: SettlementEntry;
    wanted: (SettlementEntry & { tip: string | null })[];
    labels: { learnableSkill: string; hatedNation: string; highlyWanted: string; otherWanted: string };
    ok: string;
  } & TileRef;
  /**
   * The high scores at the game's end, text as FreeCol's header (or null). Closing the panel does
   * nothing more: there is no start screen yet, so the player keeps playing (victory) or reloads the page.
   */
  highScores: {
    text: string | null;
    scores: { score: number; headline: string; fields: { label: string; value: string }[] }[];
    ok: string;
  };
  /**
   * Model messages, or with a title the turn report; each names its source's tile, to go to. The turn
   * report is arranged by the group by option: a message with a heading starts its group. Each message has
   * the resource keys of its display object's image, best first, none if it has no image. The report's
   * messages also have the buttons of Swing's report: filter is whether the type's messages are shown
   * (null: it has no filter), filterTip and ignoreTip the buttons' tooltips (null: no such button).
   */
  messages: {
    title: string | null;
    messages: ({
      text: string;
      type: string;
      source: Id | null;
      heading: ({ text: string } & TileRef) | null;
      images: string[];
      filter: boolean | null;
      filterTip: string | null;
      /** Whether the ignore button has been pressed. */
      ignored: boolean;
      ignoreTip: string | null;
    } & TileRef)[];
    ok: string;
    /** The turn report's group by option; absent for model messages. */
    groupBy?: { label: string; value: number; choices: { value: number; text: string }[] };
    /** The report again, as it was regrouped: it replaces the open one. */
    regrouped?: boolean;
  };
  /** A colony, as FreeCol's colony panel shows it (ColonyJson.java). */
  colony: ColonyView;
  /**
   * The player's trade routes (TradeRoutePanel), each with its stops, the goods loaded at each, and how many
   * units follow it, with the places a stop can be at and the goods that can be loaded (TradeRouteInputPanel).
   * It replaces the open panel: the Engine sends it again after each change. error is why the last change was
   * refused (FreeCol's reason, the route was not saved), else null. The other texts are the panels' labels.
   */
  tradeRoutes: {
    title: string;
    routes: TradeRoute[];
    /** The unit the panel was opened for, to assign a route to: its id, name and route (an id), or null. */
    unit: { id: Id; name: string; route: Id | null } | null;
    assign: string;
    unassign: string;
    places: { id: Id; label: string }[];
    goods: { id: string; name: string; icon: string }[];
    error: string | null;
    newRoute: string;
    editRoute: string;
    deleteRoute: string;
    nameLabel: string;
    destinationLabel: string;
    silence: string;
    addStop: string;
    removeStop: string;
    allColonies: string;
    ok: string;
    cancel: string;
  };
  /**
   * Europe, as FreeCol's EuropePanel shows it (the player recruits, trains and buys units there): the ships sailing each way, the ships in port,
   * the units on the docks, the market and the gold. Texts are localized; images are resource keys, best
   * first. Market prices: sell is what Europe pays, buy what it asks. selected is the ship in port whose
   * cargo shows first.
   */
  europe: {
    title: string;
    gold: number;
    goldLabel: string;
    ok: string;
    headings: { toAmerica: string; toEurope: string; inPort: string; docks: string; cargo: string };
    toAmerica: EuropeUnit[];
    toEurope: EuropeUnit[];
    inPort: EuropeUnit[];
    docks: EuropeUnit[];
    selected: Id | null;
    market: {
      id: Id;
      name: string;
      images: string[];
      sell: number;
      buy: number;
      /** Whether the goods can be traded at all; false when it is boycotted. */
      enabled: boolean;
      /** Why it cannot be traded, as FreeCol says it; null when it can. */
      reason: string | null;
    }[];
    buttons: { train: string; purchase: string; recruit: string; sail: string };
    /** The docks' recruit pool at one price (RecruitPanel); index is what recruiting sends. */
    recruit: {
      heading: string;
      text: string;
      price: number;
      units: { index: number; name: string; images: string[]; enabled: boolean }[];
    };
    /** The unit types to train and to buy, by ascending price (TrainPanel, PurchasePanel). */
    train: { heading: string; units: EuropeOffer[] };
    purchase: { heading: string; units: EuropeOffer[] };
  };
  /**
   * The game's difficulty level or game options (the in-game menu's entries), as an option group the option
   * editor shows read-only (options.ts, OptionsJson.java). root is null when nothing in the group can be shown.
   */
  options: { kind: 'difficulty' | 'game'; title: string; root: OptionGroup | null; ok: string };
  /**
   * A report of the Report menu (Reports.java): the report field tells which. It replaces the open report,
   * so a link to a detail report opens it in place.
   */
  report: ReportView;
  /** A dialog the Browser UI cannot show yet; the controller got FreeCol's base default. */
  unasked: { method: string };
}

/** Goods of a type, with the resource keys of its icon, best first. */
export interface GoodsAmount {
  type: string;
  name: string;
  keys: string[];
  amount: number;
}

/** A unit, with the resource keys of its image, best first. */
export interface UnitRef {
  id: Id;
  name: string;
  keys: string[];
  /** On a colony tile: the text of TileViewer's occupation chip. */
  occupation?: string;
  /** Working in a colony: the goods type it makes (null for none), and the goods it could make there, with the amount it would make. */
  work?: string | null;
  choices?: GoodsAmount[];
}

/** What FreeCol's colony panel shows of a colony: see ColonyJson.java. All text is localized. */
export interface ColonyView {
  id: Id;
  name: string;
  at: [number, number];
  /** The close button's label. */
  ok: string;
  /** PopulationPanel's labels, the share of rebels and the two shields. */
  population: {
    total: string;
    rebels: string;
    royalists: string;
    bonus: string;
    rebelPercent: number;
    rebelShield: string[];
    royalistShield: string[];
  };
  /** The buildings, and an empty plot (site, with no id) for each kind not built yet. */
  buildings: {
    id: Id | null;
    type: string;
    name: string;
    keys: string[];
    site: boolean;
    /** How many units can work there. */
    capacity: number;
    workers: UnitRef[];
    /** The output, and the most it could be with the inputs it lacks; null for none. */
    production: (GoodsAmount & { max: number }) | null;
    /** The upkeep, when the game has upkeep and the building costs some; else null. */
    upkeep: number | null;
  }[];
  /** The 3x3 tiles, pos being the place in Swing's TilesPanel grid: north [0, 0], the centre [1, 1], south [2, 2]. */
  tiles: {
    id: Id;
    pos: [number, number];
    /** The tile on the map. */
    at: [number, number];
    name: string;
    terrain: string[];
    forest: string[] | null;
    centre: boolean;
    /** Whether the colony owns the tile. */
    ours: boolean;
    /** Whether the colony cannot work it (TileViewer's tile taken image), and whether it is native land. */
    taken: boolean;
    natives: boolean;
    workers: UnitRef[];
    production: GoodsAmount[];
  }[];
  /** The net production of each goods type, the non-zero ones. */
  production: GoodsAmount[];
  /** over: more than the warehouse holds. */
  warehouse: { title: string; capacity: number; goods: (GoodsAmount & { over: boolean })[] };
  outside: { title: string; units: UnitRef[] };
  /**
   * The ships in port, each with its cargo (ColonyCargoPanel's title, units and goods), the one chosen at
   * first, and the cargo box's title with none chosen.
   */
  inPort: {
    title: string;
    units: (UnitRef & { cargo: { title: string; units: UnitRef[]; goods: GoodsAmount[] } })[];
    selected: Id | null;
    cargo: string;
  };
  /** The current build, and the goods it needs; null when nothing is built, which `nothing` says. */
  construction: {
    type: string;
    name: string;
    keys: string[];
    turns: string | null;
    required: (GoodsAmount & { needed: number; available: number; produced: number })[];
  } | null;
  nothing: string;
  /** The build queue panel: see BuildQueues.java. */
  queue: BuildQueueView;
}

/** What the colony can build: the goods it takes, and why it cannot be queued (null when it can). */
export interface Buildable {
  type: string;
  name: string;
  keys: string[];
  required: GoodsAmount[];
  reason: string | null;
}

/** BuildQueuePanel: its labels, the queue (first is being built), what can be queued, and the buy button (null for none). */
export interface BuildQueueView {
  title: string;
  buildingsTitle: string;
  unitsTitle: string;
  showAll: string;
  queue: Buildable[];
  buildings: Buildable[];
  units: Buildable[];
  buy: { label: string; price: number; enabled: boolean } | null;
}

/** A trade route: where it stops, in order, and the goods types (by id) loaded at each stop. */
export interface TradeRoute {
  id: Id;
  name: string;
  silent: boolean;
  /** How many units follow it. */
  units: number;
  stops: { place: Id; label: string; cargo: string[] }[];
}

/** A route as the player saves it: a null id makes a new route. */
export interface TradeRouteDraft {
  id: Id | null;
  name: string;
  silent: boolean;
  stops: { place: Id; cargo: string[] }[];
}

/** A unit type Europe sells, with the server's price; enabled when the player can pay. */
export interface EuropeOffer {
  id: Id;
  name: string;
  images: string[];
  price: number;
  priceLabel: string;
  enabled: boolean;
}

/** A unit in Europe or on its way; a carrier also lists its cargo. */
export interface EuropeUnit {
  id: Id;
  name: string;
  images: string[];
  selected: boolean;
  cargo?: { kind: 'unit' | 'goods'; id: Id; name: string; images: string[]; amount: number }[];
}

/** A text with the resource keys of its icon, best first. */
export interface SettlementEntry {
  text: string;
  images: string[];
}

export interface Choice {
  text: string;
  enabled: boolean;
  ok: boolean;
  cancel: boolean;
  default: boolean;
}

/** Questions: what is asked, and what the player answers (null: closed). */
export interface GuiQuestions {
  /**
   * An event panel the Engine waits on: the first landing's, whose closing adds the build colony tutorial.
   * It looks as the eventPanel event does; closing it answers.
   */
  event: {
    ask: { header: string; image: string | null; footer: string | null; ok: string };
    answer: true;
  };
  confirm: {
    ask: {
      text: string;
      ok: string | null;
      cancel: string | null;
      defaultOk: boolean;
      tile: Id | null;
      object: Id | null;
      /** The title Swing's dialog shows above its text, if it has one. */
      header: string | null;
    };
    answer: boolean;
  };
  choice: {
    ask: { text: string; cancel: string | null; tile: Id | null; object: Id | null; choices: Choice[] };
    /** The index of the chosen item. */
    answer: number | null;
  };
  input: {
    ask: { text: string; value: string | null; ok: string | null; cancel: string | null; tile: Id | null };
    answer: string | null;
  };
  /**
   * The end turn dialog: the units still waiting, any of which can be picked to be made the active unit
   * (the dialog closes and the turn goes on). Answers ok to end the turn, cancel to keep it.
   */
  endTurn: {
    ask: {
      header: string;
      text: string;
      ok: string | null;
      cancel: string | null;
      units: { id: Id; name: string; location: string }[];
    };
    answer: { status: 'ok' | 'cancel' } | { status: 'select'; unit: Id } | null;
  };
  /**
   * The dialog before an attack: both sides' modifiers, side by side in FreeCol's order, and the final
   * results. Answers true to attack.
   */
  preCombat: {
    ask: {
      attacker: string;
      defender: string;
      offence: { source: string; value: string }[];
      defence: { source: string; value: string }[];
      /** The label of the results. */
      finalResult: string;
      offenceResult: string;
      defenceResult: string;
      ok: string | null;
      cancel: string | null;
      tile: Id | null;
      object: Id | null;
    };
    answer: boolean;
  };
  /**
   * FreeCol's select amount dialog: an amount of goods, from 0 to max. values are the amounts it lists, value
   * the one selected at first (null for none); any whole number in range may be typed instead.
   */
  amount: {
    ask: {
      text: string;
      type: Id | null;
      name: string | null;
      keys: string[];
      values: number[];
      value: number | null;
      max: number;
      ok: string | null;
      cancel: string | null;
    };
    /** The amount, null for a closed dialog. */
    answer: number | null;
  };
  /** Pick goods to capture or dump; at most `max` lots. */
  goods: {
    ask: {
      text: string;
      ok: string | null;
      cancel: string | null;
      max: number;
      object: Id | null;
      goods: Lot[];
    };
    /** The indexes of the lots chosen, null for a closed dialog. */
    answer: number[] | null;
  };
  /**
   * A trade, as FreeCol's negotiation dialog: the agreement's items, and what can be added to it. Answers
   * with the status and, to propose, the items the agreement should have.
   */
  negotiation: {
    ask: {
      title: string;
      text: string | null;
      /** The headings of what the other player gives and what we give, and the one between them. */
      demand: string;
      offer: string;
      exchange: string;
      version: number;
      add: string;
      send: string;
      /** Null: this offer cannot be accepted, or cancelled. */
      accept: string | null;
      cancel: string | null;
      items: TradeItem[];
      options: TradeOption[];
    };
    answer: { status: 'accept' | 'propose' | 'reject'; items: TradeItem[] } | null;
  };
  /**
   * FreeCol's warehouse dialog: for each storable goods the levels that warn of too little or too much stock,
   * the level below which it is imported (null unless the enhanced trade routes option is on), whether it is
   * exported (only with a custom house) and the level above which. max is the most a level may be.
   */
  warehouse: {
    ask: {
      title: string;
      ok: string | null;
      cancel: string | null;
      /** The export check box's label. */
      export: string;
      canExport: boolean;
      tips: { low: string; high: string; import: string; export: string; exported: string };
      goods: {
        type: Id;
        name: string;
        keys: string[];
        amount: number;
        exported: boolean;
        low: number;
        high: number;
        import: number | null;
        export: number;
        max: number;
      }[];
    };
    /** The settings of every goods, as they stand when OK is pressed; null for a closed dialog. */
    answer: { type: Id; exported: boolean; low: number; high: number; import: number | null; export: number }[] | null;
  };
  /** Text fields, each with its label and a suggestion (the new nation's names). */
  names: {
    ask: { text: string; fields: { label: string; value: string }[]; ok: string | null; cancel: string | null };
    /** The fields' values, in order; null when cancelled or closed. */
    answer: string[] | null;
  };
}

export type TradeKind = 'gold' | 'stance' | 'colony' | 'goods' | 'incite' | 'unit';

/** One thing traded. We give an "offer"; the other player gives a "demand"; a stance has no side. */
export interface TradeItem {
  kind: TradeKind;
  side: 'offer' | 'demand' | null;
  /** What names the thing: a stance, an id, a goods type; empty for gold. */
  key: string;
  amount: number;
  text: string;
}

/** What can be added: gold up to max, else one of the choices. A unique kind has one item at most. */
export interface TradeOption {
  kind: TradeKind;
  side: 'offer' | 'demand' | null;
  label: string;
  note: string | null;
  unique: boolean;
  max?: number;
  choices: { key: string; amount: number; text: string }[];
}

export interface Lot {
  id: string;
  type: string;
  name: string;
  amount: number;
  /** The goods type's resource key, so a Tileset can replace the picture. */
  icon: string;
  label: string;
  /** Checked when the dialog opens. */
  checked: boolean;
}

export interface GuiHandlers {
  /** Events without a handler are dropped. */
  events: { [K in keyof GuiEvents]?: (event: GuiEvents[K]) => void };
  /** Every question needs a handler: the Engine waits for its answer. */
  questions: {
    [K in keyof GuiQuestions]: (
      ask: GuiQuestions[K]['ask'],
    ) => GuiQuestions[K]['answer'] | Promise<GuiQuestions[K]['answer']>;
  };
}

/** How each kind of answer crosses to Java, as a string or null. */
const encode: { [K in keyof GuiQuestions]: (answer: GuiQuestions[K]['answer']) => string | null } = {
  confirm: (a) => String(a),
  event: () => 'closed',
  preCombat: (a) => String(a),
  choice: (a) => (a === null ? null : String(a)),
  input: (a) => a,
  amount: (a) => (a === null ? null : String(a)),
  goods: (a) => (a === null ? null : JSON.stringify(a)),
  // Java splits the answer at the line break, after the word.
  endTurn: (a) => (a === null ? null : a.status === 'select' ? `select\n${a.unit}` : a.status),
  // A status line, then a line for each item, its fields separated by tabs (no field has one).
  negotiation: (a) =>
    a === null
      ? null
      : [
          a.status,
          ...(a.status === 'propose' ? a.items.map((i) => [i.kind, i.side ?? '', i.key, i.amount].join('\t')) : []),
        ].join('\n'),
  // A line for each goods, its fields separated by tabs; -1 is no import level (Warehouses.java).
  warehouse: (a) =>
    a === null
      ? null
      : a.map((g) => [g.type, g.exported, g.low, g.high, g.import ?? -1, g.export].join('\t')).join('\n'),
  // Java splits the answer at the line break, which a text field never holds.
  names: (a) => (a === null ? null : a.join('\n')),
};

const isKey = <T extends object>(o: T, k: string): k is Extract<keyof T, string> => Object.hasOwn(o, k);

/**
 * The fcShow and fcAsk globals for the client Engine, routing to typed
 * handlers. `answer` is the client module's export.
 */
export function webGui(handlers: GuiHandlers, answer: (id: number, value: string | null) => void) {
  return {
    fcShow(kind: string, json: string): void {
      if (!isKey(handlers.events, kind)) return;
      const handle = handlers.events[kind] as (e: unknown) => void;
      handle(JSON.parse(json));
    },
    fcAsk(id: number, kind: string, json: string): void {
      // Answer in a later microtask, never inside the Engine's call.
      void Promise.resolve()
        .then(async () => {
          if (!isKey(handlers.questions, kind)) {
            handlers.events.unasked?.({ method: `ask ${kind}` });
            return null;
          }
          const handle = handlers.questions[kind] as (q: unknown) => unknown;
          const encodeAnswer = encode[kind] as (a: unknown) => string | null;
          return encodeAnswer(await handle(JSON.parse(json)));
        })
        .catch((ex: unknown) => {
          console.error(`WebGUI question ${kind} failed; answering as closed`, ex);
          return null;
        })
        .then((value) => answer(id, value));
    },
  };
}

/** What every report has: its window's title and close button's label, and the report that a detail returns to. */
interface ReportHead<K extends string> {
  report: K;
  title: string;
  ok: string;
  back: ReportName | null;
}

/** A unit type, with the resource keys of its image. */
export interface TypeRef {
  id: string;
  name: string;
  keys: string[];
}

/** One kind of unit in a unit report, with how many: the tooltip is its description. */
export interface UnitCount {
  type: string;
  name: string;
  keys: string[];
  count: number;
  text: string;
}

/** The military, naval and cargo reports (ReportUnitPanel) share one view; `report` tells which. */
type UnitsView<K extends 'military' | 'naval' | 'cargo'> = ReportHead<K> & {
  forces: { name: string; units: UnitCount[] };
  /** The king's expeditionary force, or null if it has nothing of this kind. */
  ref: { name: string; units: UnitCount[] } | null;
  /** The label of an empty place. */
  none: string;
  locations: {
    label: string;
    link: { kind: 'colony' | 'europe' | 'tile'; id: Id; at: [number, number] | null };
    units: (UnitRef & {
      text: string;
      /** What a carrier holds. */
      goods: GoodsAmount[];
      cargo: UnitRef[];
    })[];
  }[];
};

/** The reports of Reports.java, as the Engine sends them. Adding a report adds a member here. */
export type ReportView =
  | (ReportHead<'colopedia'> & {
      sections: { id: string; name: string; entries: ColopediaEntry[] }[];
    })
  | UnitsView<'military'>
  | UnitsView<'naval'>
  | UnitsView<'cargo'>
  | (ReportHead<'colony'> & {
      colonies: {
        id: Id;
        name: string;
        /** What the colony is building, or null; unit says it is a unit rather than a building. */
        building: { name: string; keys: string[]; unit: boolean } | null;
        colonists: UnitRef[];
        outside: UnitRef[];
        /** Goods made, used or kept: amount is the net production, stock what is stored, max what could be made. */
        goods: (GoodsAmount & { stock: number; max: number })[];
        buildings: { id: Id; name: string; keys: string[] }[];
      }[];
    })
  | (ReportHead<'labour'> & { types: (TypeRef & { count: number })[] })
  | (ReportHead<'labourDetail'> & {
      unit: TypeRef;
      total: number;
      colonies: { id: Id; name: string; count: number; canTrain: boolean }[];
      /** Europe, and tiles on land (at is where on the map). */
      places: { label: string; count: number; europe: boolean; at: [number, number] | null }[];
      atSea: { label: string; count: number }[];
      canTrain: string | null;
    })
  | (ReportHead<'compactLabour'> & {
      /** The unit type the details are of; null for the overview. */
      unit: TypeRef | null;
      canTrain: string | null;
      showProduction: boolean;
      showNet: boolean;
      /** The image of the goods the expert makes. */
      goods: string[] | null;
      /** The image of the goods the net production is of (the goods are stored as it), or null. */
      storedAs: string[] | null;
      /** The column headers, localized. */
      headers: { unitType: string; workingAs: string; colonists: string; production: string };
      groups: {
        label: string;
        keys: string[] | null;
        /** Where a click on the label goes: details of a unit type (id "" for all colonists), a colony or Europe. */
        link: { kind: 'unit' | 'colony' | 'europe'; id: string } | null;
        summary: { colonists: number; production: number; net: number; hasNet: boolean };
        rows: { unit: string | null; doing: string; count: number; production: number; counted: boolean }[];
      }[];
    })
  | (ReportHead<'religion'> & {
      /** Each kind of immigration goods (crosses): the player's store of it, what it needs, and the buildings that make it. */
      goods: (GoodsAmount & {
        immigration: number;
        required: number;
        production: number;
        colonies: { id: Id; name: string; building: { id: Id; name: string; keys: string[] }; workers: UnitRef[] }[];
      })[];
    })
  | (ReportHead<'education'> & {
      /** The titles of the lists of teachers and students, localized. */
      headers: { teachers: string; students: string };
      /** One entry for each school; a student's learns is what it would become. */
      colonies: {
        id: Id;
        name: string;
        building: { id: Id; name: string; keys: string[] };
        teachers: UnitRef[];
        students: (UnitRef & { learns: string })[];
      }[];
    })
  | (ReportHead<'exploration'> & {
      /** The column headers, localized. */
      headers: { name: string; type: string; discoveredIn: string; discoveredBy: string; value: string };
      regions: { name: string; type: string; turn: string; by: string; value: number }[];
    })
  | (ReportHead<'history'> & { events: { turn: string; text: string }[] })
  | (ReportHead<'trade'> & {
      /** The storable goods, with the market's prices; every list of numbers below has one entry for each. */
      goods: { type: string; name: string; keys: string[]; buy: number | null; sell: number | null }[];
      labels: {
        unitsSold: string;
        beforeTaxes: string;
        afterTaxes: string;
        cargoUnits: string;
        totalUnits: string;
        totalDelta: string;
        hasCustomHouse: string;
      };
      sold: number[];
      beforeTaxes: number[];
      afterTaxes: number[];
      cargo: number[];
      total: number[];
      delta: number[];
      colonies: {
        id: Id;
        name: string;
        /** It has a custom house. */
        export: boolean;
        cells: {
          amount: number;
          production: number;
          /** The level the goods are exported at, or null if they are not. */
          exported: number | null;
          /** Why the production is a problem, or null. */
          warning: string | null;
        }[];
      }[];
    })
  | (ReportHead<'production'> & {
      labels: { selectGoods: string; nothing: string; colony: string };
      /** The goods that are not farmed, with the first level of each building that makes them. */
      goods: {
        type: string;
        name: string;
        keys: string[];
        buildings: { id: string; name: string; keys: string[] }[];
      }[];
      colonies: {
        id: Id;
        name: string;
        /** One for each goods above: the net production, and for each of its buildings the units in it (null: not built). */
        cells: { amount: number; buildings: (UnitRef[] | null)[] }[];
      }[];
    })
  | (ReportHead<'requirements'> & {
      colonies: {
        id: Id;
        name: string;
        /** The advice, a paragraph each; colonies are linked after the text, info being text after a name, such as "(3)". */
        items: { text: string; colonies: { id: Id; name: string; info: string }[] }[];
        /** What to say when there is no advice: the colony's requirements are met; null if there is advice. */
        met: string | null;
      }[];
    })
  | (ReportHead<'foreign'> & {
      labels: {
        stance: string;
        colonies: string;
        units: string;
        military: string;
        naval: string;
        gold: string;
        fathers: string;
        tax: string;
        sol: string;
      };
      /** The notice under the nations, localized. */
      notice: string;
      /** Each European nation the server summarises; fathers, tax and sol are null where we have not learnt them. */
      nations: {
        id: Id;
        name: string;
        keys: string[];
        stance: string;
        colonies: number;
        units: number;
        military: number;
        naval: number;
        gold: number;
        fathers: number | null;
        tax: number | null;
        sol: number | null;
      }[];
    })
  | (ReportHead<'indian'> & {
      labels: {
        chieftain: string;
        kind: string;
        settlements: string;
        tension: string;
        /** What to say of a tribe with no known settlement. */
        none: string;
        /** The settlement table's headings. */
        columns: string[];
      };
      /** Each tribe we have contacted. */
      tribes: {
        id: Id;
        name: string;
        keys: string[];
        chieftain: string;
        kind: string;
        /** "known / all", the all being "?" when the server did not say. */
        settlements: string;
        tension: string;
        rows: {
          /** The settlement's tile. */
          id: Id;
          /** Where the settlement is, for the link. */
          at: [number, number];
          name: string;
          mission: { text: string; keys: string[] } | null;
          alarm: string;
          /** The skill taught, with its image once visited. */
          skill: { text: string; keys: string[] | null };
          hated: string;
          wanted: { text: string; keys: string[] | null }[];
        }[];
      }[];
    })
  | (ReportHead<'congress'> & {
      labels: { recruiting: string; none: string };
      /** The father being recruited, with the liberty progress; null if none. */
      current: {
        id: Id;
        name: string;
        description: string;
        keys: string[];
        cost: number;
        liberty: number;
        production: { type: string; name: string; keys: string[]; amount: number }[];
      } | null;
      /** Every father, grouped by kind. */
      fathers: {
        id: Id;
        name: string;
        description: string;
        keys: string[];
        kind: string;
        state: 'elected' | 'recruiting' | 'available';
        status: string;
        turn: string | null;
      }[];
    });

/** One entry of the Colopedia: a plain-text description and labelled facts, with the image keys of its icon. */
export interface ColopediaEntry {
  id: string;
  name: string;
  keys: string[];
  text: string;
  facts: { label: string; value: string }[];
}

/** The reports the menu opens and the Engine can send. */
export type ReportName = ReportView['report'];
