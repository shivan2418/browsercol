// Bundles FreeCol's data files into data.json: a flat array of
// alternating "data/<path>" and text, the set run-node.mjs passes plus
// base/client-options.xml. Usage: node build-data.mjs <freecol/data> <out.json>
import fs from 'node:fs';
const [data, out] = process.argv.slice(2);
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
fs.writeFileSync(out, JSON.stringify(args));
console.log(`data.json: ${files.length} files, ${(fs.statSync(out).size / 1024).toFixed(0)} KiB`);
