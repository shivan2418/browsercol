#!/usr/bin/env node
// The Swing parity inventory: every player action Swing's client/gui offers,
// listed from FreeCol's source, so a check of the Browser UI against Swing
// can go row by row instead of by eye.
//
// A row is one call site in client/gui of
//   - a controller (InGameController, ConnectController, PreGameController,
//     MapEditorController): what the action does to the game, or
//   - a GUI show*/get*Choice method: a panel or dialog the action opens.
// Each row carries the class and method it sits in (lambdas and anonymous
// classes count as their enclosing method), the guards around it (the
// enclosing if/else/case lines), the gesture hints of the method (listener
// methods, addActionListener and friends), and the message keys the method
// names (labels of its buttons and menu items).
//
// Two exact checks come with it:
//   - controller methods Swing's GUI calls that the Engine's web package never
//     calls;
//   - GUI methods SwingGUI overrides that WebGUI does not.
// FreeColAction ids are not checked: our menus do not use them.
// The hints per row (reached?, key used?) are leads, not verdicts: an agent
// or a person decides each row.
//
// Usage: ./dev.sh node tools/swing-inventory.mjs [outDir]
// Writes <outDir>/swing-inventory.json and <outDir>/swing-inventory.md
// (default docs/parity).

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repo, process.argv[2] ?? 'docs/parity');
const guiRoot = join(repo, 'freecol/src/net/sf/freecol/client/gui');
const webRoot = join(repo, 'engine/src/main/java/online/freecol/web');
const uiRoot = join(repo, 'ui/src');

const walk = (dir, ext) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : [];
  });

/** Blank out comments, keeping line breaks so line numbers hold. String literals stay. */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'") {
      const q = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') out += src[i++];
        out += src[i++];
      }
      out += q;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The text with string literal contents blanked, for brace counting. */
const noStrings = (line) => line.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");

// The receivers that are a controller, and which controller.
const CONTROLLER = [
  [/\b(?:igc\(\)|igc|getInGameController\(\)|inGameController)\.(\w+)\s*\(/g, 'InGameController'],
  [/\b(?:getConnectController\(\)|connectController)\.(\w+)\s*\(/g, 'ConnectController'],
  [/\b(?:getPreGameController\(\)|preGameController)\.(\w+)\s*\(/g, 'PreGameController'],
  [/\b(?:getMapEditorController\(\)|mapEditorController)\.(\w+)\s*\(/g, 'MapEditorController'],
];
// A GUI call that opens something: getGUI().showX / gui.showX / showX( inside the GUI.
const GUI_OPEN = /\b(?:getGUI\(\)\.|gui\.|getSwingGUI\(\)\.)?((?:show|get)\w*(?:Panel|Dialog|Choice|Report|Menu|Colopedia)\w*|show\w+)\s*\(/g;
// Listener methods and registrations: the gesture a handler answers.
const GESTURE =
  /\b(actionPerformed|mouseClicked|mousePressed|mouseReleased|mouseDragged|keyPressed|keyReleased|keyTyped|itemStateChanged|valueChanged|stateChanged|addCargo|importData|exportDone|createTransferable|drop|add(?:Action|Mouse|Key|Item|ListSelection|Change)Listener|setAction|registerKeyboardAction)\b/g;
const KEY =
  /\b(?:localizedMenuItem|localizedButton|localizedLabel|localizedTextArea|localizedHTML|localizedTextPane|Messages\.message|Messages\.getName|Messages\.getDescription|StringTemplate\.(?:template|key|label|name)|template|message)\s*\(\s*"([^"]+)"/g;
const METHOD_HEAD =
  /^\s*(?:@\w+\s+)*(?:(?:public|protected|private|static|final|synchronized|abstract|default)\s+)*(?:<[^>]+>\s+)?[\w$.<>\[\],? ]+\s+(\w+)\s*\([^;{}]*\)?\s*(?:throws\s+[\w$., ]+)?\s*\{?\s*$/;
const CLASS_HEAD = /\b(?:class|interface|enum)\s+(\w+)/;
const NOT_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'new', 'else', 'try', 'do']);

/**
 * Walk a Java file, giving each line its enclosing class and method chain.
 * Brace counting on comment- and string-free text; a method header is a line
 * that looks like one and opens a block at or after it.
 */
function scan(file) {
  const src = stripComments(readFileSync(file, 'utf8'));
  const lines = src.split('\n');
  const frames = []; // {kind:'class'|'method', name, depth}
  let depth = 0;
  let pending = null; // a method header whose { is on a later line
  const out = [];
  lines.forEach((line, idx) => {
    const bare = noStrings(line);
    const cls = bare.match(CLASS_HEAD);
    const head = bare.match(METHOD_HEAD);
    const opens = (bare.match(/\{/g) || []).length;
    const closes = (bare.match(/\}/g) || []).length;
    if (cls && opens > 0 && !/\bnew\b/.test(bare.split(cls[0])[0])) {
      frames.push({ kind: 'class', name: cls[1], depth: depth + 1 });
    } else if (head && !NOT_METHOD.has(head[1]) && !/[=]/.test(bare.split('(')[0])) {
      if (opens > 0) frames.push({ kind: 'method', name: head[1], depth: depth + 1 });
      else pending = head[1];
    } else if (pending && /^\s*(?:throws[^{]*)?\{/.test(bare)) {
      frames.push({ kind: 'method', name: pending, depth: depth + 1 });
      pending = null;
    } else if (pending && /;\s*$/.test(bare)) {
      pending = null; // an abstract or interface method
    } else {
      // An anonymous class: `new X(...) {` opens a frame named after X.
      const anon = bare.match(/\bnew\s+([\w.<>]+)\s*\([^)]*\)\s*\{\s*$/);
      if (anon) frames.push({ kind: 'class', name: `anon ${anon[1]}`, depth: depth + 1 });
    }
    const classes = frames.filter((f) => f.kind === 'class').map((f) => f.name);
    const methods = frames.filter((f) => f.kind === 'method').map((f) => f.name);
    out.push({ n: idx + 1, line, bare, depth, classes, methods });
    depth += opens - closes;
    while (frames.length && frames[frames.length - 1].depth > depth) frames.pop();
  });
  return out;
}

/** The guards around line i: the if/else/case/ternary lines that enclose it within its method. */
function guards(lines, i) {
  const indent = (s) => s.match(/^\s*/)[0].length;
  const method = lines[i].methods.join('/');
  let cur = indent(lines[i].line);
  const found = [];
  const own = lines[i].line.trim();
  if (/^(?:\}\s*else\s+)?if\s*\(/.test(own)) found.push(own.replace(/\s*\{\s*$/, ''));
  for (let j = i - 1; j >= 0 && lines[j].methods.join('/') === method; j--) {
    const t = lines[j].line.trim();
    if (!t) continue;
    const ind = indent(lines[j].line);
    if (ind < cur && /^(?:\}?\s*else\b|\}?\s*(?:else\s+)?if\s*\(|case\b|default\s*:|for\s*\(|while\s*\(|switch\s*\()/.test(t)) {
      found.push(t.replace(/\s*\{\s*$/, ''));
      cur = ind;
    } else if (ind < cur && /^(?:public|protected|private)\b/.test(t)) break;
  }
  return found.reverse();
}

// --- Swing's side -----------------------------------------------------------

const rows = [];
const files = walk(guiRoot, '.java');
const methodInfo = new Map(); // file#methods -> {gestures, keys}
const scanned = new Map();
for (const file of files) {
  const lines = scan(file);
  scanned.set(file, lines);
  for (const l of lines) {
    const id = `${file}#${l.classes.join('.')}#${l.methods[0] ?? ''}`;
    if (!methodInfo.has(id)) methodInfo.set(id, { gestures: new Set(), keys: new Set() });
    const info = methodInfo.get(id);
    for (const m of l.bare.matchAll(GESTURE)) info.gestures.add(m[1]);
    for (const m of l.line.matchAll(KEY)) info.keys.add(m[1]);
    l.id = id;
  }
}

// The files that are the GUI's plumbing, not a player's action: what they
// open is opened on the Engine's behalf, and WebGUI's overrides cover it.
const plumbing = /\/(?:GUI|SwingGUI|Canvas|Widgets|mapviewer\/.*|animation\/.*|images\/.*|plaf\/.*|video\/.*)\.java$/;

for (const file of files) {
  const lines = scanned.get(file);
  const rel = relative(join(repo, 'freecol/src'), file);
  lines.forEach((l, i) => {
    const hits = [];
    for (const [re, ctl] of CONTROLLER) for (const m of l.bare.matchAll(re)) hits.push({ kind: 'controller', target: `${ctl}.${m[1]}` });
    if (!plumbing.test(file)) {
      for (const m of l.bare.matchAll(GUI_OPEN)) {
        // A definition is not a call; the GUI's own getters are not openings.
        if (METHOD_HEAD.test(l.bare) && l.bare.includes(` ${m[1]}(`)) continue;
        if (/^get(?:GUI|SwingGUI|Specification|Game|My\w*|Image\w*|Selected\w*|Active\w*|Font|Messages?)$/.test(m[1])) continue;
        if (!/^(?:show|get\w*Choice)/.test(m[1])) continue;
        hits.push({ kind: 'opens', target: `GUI.${m[1]}` });
      }
    }
    if (!hits.length) return;
    const info = methodInfo.get(l.id);
    for (const h of hits) {
      rows.push({
        file: rel,
        line: l.n,
        class: l.classes.join('.'),
        method: l.methods.join('/') || '(field)',
        kind: h.kind,
        target: h.target,
        guards: guards(lines, i),
        gestures: [...info.gestures],
        keys: [...info.keys],
      });
    }
  });
}

// --- Our side, for the hints and the exact checks --------------------------

const read = (p) => readFileSync(p, 'utf8');
const webSrc = walk(webRoot, '.java').map(read).join('\n');
const patchSrc = walk(join(repo, 'engine/patches'), '.java').map(read).join('\n');
const uiSrc = walk(uiRoot, '.ts')
  .concat(walk(uiRoot, '.tsx'))
  .filter((p) => !/\.test\.tsx?$/.test(p))
  .map(read)
  .join('\n');
const ours = webSrc + '\n' + uiSrc;

const ourControllerCalls = new Set();
for (const [re, ctl] of CONTROLLER) for (const m of webSrc.matchAll(re)) ourControllerCalls.add(`${ctl}.${m[1]}`);
// The web package also reaches InGameController through helpers named igc().
for (const m of webSrc.matchAll(/\bigc\(\)\s*\.\s*(\w+)\s*\(/g)) ourControllerCalls.add(`InGameController.${m[1]}`);

for (const r of rows) {
  r.reached = r.kind === 'controller' ? ourControllerCalls.has(r.target) : null;
  r.keysUsed = r.keys.filter((k) => ours.includes(`"${k}"`) || ours.includes(`'${k}'`));
}

// Exact check 1: controller methods Swing's GUI calls that the web package never does.
const swingTargets = [...new Set(rows.filter((r) => r.kind === 'controller').map((r) => r.target))].sort();
const unreached = swingTargets.filter((t) => !ourControllerCalls.has(t));

// Exact check 2: GUI methods SwingGUI overrides that WebGUI does not.
const overrides = (src) => {
  const names = new Set();
  const lines = stripComments(src).split('\n');
  lines.forEach((l, i) => {
    if (!/@Override/.test(l)) return;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const m = lines[j].match(/\b(\w+)\s*\(/);
      if (m && !/^(?:if|for|while|new|return)$/.test(m[1])) {
        names.add(m[1]);
        break;
      }
    }
  });
  return names;
};
const swingGui = overrides(read(join(guiRoot, 'SwingGUI.java')));
const webGui = overrides(read(join(webRoot, 'WebGUI.java')));
const guiNotOverridden = [...swingGui].filter((n) => !webGui.has(n)).sort();

// --- Output -------------------------------------------------------------------

mkdirSync(outDir, { recursive: true });
const byClass = new Map();
for (const r of rows) {
  const k = r.file;
  if (!byClass.has(k)) byClass.set(k, []);
  byClass.get(k).push(r);
}
writeFileSync(
  join(outDir, 'swing-inventory.json'),
  JSON.stringify({ rows, unreached, guiNotOverridden }, null, 1) + '\n',
);

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/`/g, "'");
let md = `# Swing parity inventory

Generated by \`tools/swing-inventory.mjs\` from FreeCol's \`client/gui\`; do not edit by hand.
Each row is a call site where Swing's GUI changes the game (a controller call) or opens a panel or dialog
(\`opens\`). *Reached* says whether the Engine's web package calls that controller method anywhere;
*keys* lists the method's message keys, with the ones our Engine or UI also names in **bold**. Both are
leads, not verdicts.

- ${rows.length} rows in ${byClass.size} files
- ${swingTargets.length} controller methods called from Swing's GUI; ${unreached.length} never called by the web package
- ${guiNotOverridden.length} GUI methods SwingGUI overrides and WebGUI does not (many are Swing's own plumbing)

## Controller methods the web package never calls

${unreached.map((t) => `- \`${t}\`: ${rows.filter((r) => r.target === t).map((r) => `\`${r.file.split('/').pop()}:${r.line}\``).join(', ')}`).join('\n')}

## GUI methods SwingGUI overrides and WebGUI does not

${guiNotOverridden.map((n) => `\`${n}\``).join(', ')}

## Rows by file
`;
for (const [file, rs] of [...byClass].sort()) {
  md += `\n### ${file}\n\n| line | method | does | guards | gestures | keys | reached |\n|---|---|---|---|---|---|---|\n`;
  for (const r of rs) {
    const keys = r.keys.map((k) => (r.keysUsed.includes(k) ? `**${k}**` : k)).join(', ');
    md += `| ${r.line} | ${esc(r.method)} | ${r.kind === 'opens' ? 'opens ' : ''}\`${esc(r.target)}\` | ${esc(r.guards.join(' › '))} | ${esc(r.gestures.join(', '))} | ${esc(keys)} | ${r.reached === null ? '' : r.reached ? 'yes' : '**no**'} |\n`;
  }
}
writeFileSync(join(outDir, 'swing-inventory.md'), md);
console.log(
  `${rows.length} rows in ${byClass.size} files; ${unreached.length}/${swingTargets.length} controller methods unreached; ` +
    `${guiNotOverridden.length} GUI overrides missing -> ${relative(repo, outDir)}`,
);
