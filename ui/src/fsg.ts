// Reads what the save list shows (turn, year, nation) from a .fsg file, so an
// imported save can be listed without starting the Engine. A .fsg is a zip
// whose `savegame.xml` has a <savedGame owner=...> root, a <game turn=...>
// and the players. The zip's central directory is read for the entry (the
// local headers may carry no sizes), and the entry is inflated with the
// browser's own DecompressionStream, so there is no library to ship. The year
// is FreeCol's Turn.getTurnYear for the Classic and FreeCol rulesets' calendar
// (start 1492, two seasons a year from 1600); nothing else in the file gives it.

/** The file is not a FreeCol save. */
export class NotASave extends Error {}

export interface FsgInfo {
  turn: number;
  year: number;
  nation: string;
  owner: string;
}

const STARTING_YEAR = 1492;
const SEASON_YEAR = 1600;
const SEASONS = 2;

/** FreeCol's Turn.getTurnYear. */
export function turnYear(turn: number): number {
  const year = turn - 1 + STARTING_YEAR;
  return year < SEASON_YEAR ? year : SEASON_YEAR + Math.floor((year - SEASON_YEAR) / SEASONS);
}

/** The bytes of a zip's entry by name, or null if the zip has none. */
async function zipEntry(bytes: Uint8Array, wanted: string): Promise<Uint8Array | null> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end of central directory record: its signature, searched from the end past a comment.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new NotASave('not a zip file');
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || v.getUint32(at, true) !== 0x02014b50) throw new NotASave('damaged zip directory');
    const method = v.getUint16(at + 10, true);
    const size = v.getUint32(at + 20, true);
    const nameLength = v.getUint16(at + 28, true);
    const extraLength = v.getUint16(at + 30, true);
    const commentLength = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name !== wanted) continue;
    if (local + 30 > bytes.length || v.getUint32(local, true) !== 0x04034b50) throw new NotASave('damaged zip entry');
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) return data;
    if (method !== 8) throw new NotASave(`unsupported zip compression ${method}`);
    try {
      const inflated = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(inflated).arrayBuffer());
    } catch {
      throw new NotASave('damaged zip entry');
    }
  }
  return null;
}

const attribute = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const unescapeXml = (s: string) =>
  s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

/** "model.nation.dutch" as the save list names it: "Dutch". */
export const nationName = (id: string) => {
  const last = id.split('.').pop() ?? '';
  return last.charAt(0).toUpperCase() + last.slice(1);
};

/** Turn, year, nation and owner of a .fsg; throws NotASave, with the reason, for anything else. */
export async function readFsg(bytes: Uint8Array): Promise<FsgInfo> {
  const xml = await zipEntry(bytes, 'savegame.xml');
  if (!xml) throw new NotASave('no savegame.xml inside');
  const text = new TextDecoder().decode(xml);
  const root = /<savedGame\b[^>]*>/.exec(text)?.[0];
  if (!root) throw new NotASave('savegame.xml is not a FreeCol saved game');
  const turn = Number(attribute(/<game\b[^>]*>/.exec(text)?.[0] ?? '', 'turn'));
  if (!Number.isInteger(turn) || turn < 1) throw new NotASave('the saved game has no turn');
  const owner = unescapeXml(attribute(root, 'owner') ?? '');
  // The human player, as ServerEngine.saveInfo finds it; else the owner's.
  const players = [...text.matchAll(/<player\b[^>]*>/g)].map((m) => m[0]);
  const human =
    players.find((p) => attribute(p, 'ai') === 'false') ??
    players.find((p) => unescapeXml(attribute(p, 'username') ?? '') === owner);
  return { turn, year: turnYear(turn), nation: nationName(attribute(human ?? '', 'nationId') ?? ''), owner };
}
