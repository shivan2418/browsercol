// Bundles FreeCol's data files into data.json: a flat array of
// alternating "data/<path>" and text, the set run-node.mjs passes plus
// base/client-options.xml and strings/languages.json, the ids of FreeCol's
// translations. The translations themselves (12 MB) are not bundled: they go
// to <strings dir>, served as strings/, and the page fetches the one the
// player picked (src/language.ts).
// Usage: node build-data.mjs <freecol/data> <out.json> [<strings dir>]
import fs from 'node:fs';
const [data, out, stringsOut] = process.argv.slice(2);
// FreeColMessages_<id>.properties; qqq is the translators' notes, not a language.
const translations = fs
  .readdirSync(`${data}/strings`)
  .map((f) => /^FreeColMessages_(.+)\.properties$/.exec(f)?.[1])
  .filter((id) => id && id !== 'qqq')
  .sort();
const files = [
  'base/roles-compat.xml',
  'base/unit-change-types-compat.xml',
  'base/client-options.xml',
  'strings/FreeColMessages.properties',
  'strings/plurals.xml',
  ...fs
    .readdirSync(`${data}/rules`, { recursive: true })
    .map((f) => `rules/${f}`)
    .filter((f) => fs.statSync(`${data}/${f}`).isFile()),
];
const args = [];
for (const f of files) args.push(`data/${f}`, fs.readFileSync(`${data}/${f}`, 'utf8'));
args.push('data/strings/languages.json', JSON.stringify(translations));
if (stringsOut) {
  fs.mkdirSync(stringsOut, { recursive: true });
  for (const id of translations)
    fs.copyFileSync(
      `${data}/strings/FreeColMessages_${id}.properties`,
      `${stringsOut}/FreeColMessages_${id}.properties`,
    );
}
fs.writeFileSync(out, JSON.stringify(args));
console.log(`data.json: ${files.length} files, ${(fs.statSync(out).size / 1024).toFixed(0)} KiB`);
