Issue #36, three of its items (the others stay open): tidy-ups from a code
review of the Tileset work. Read the issue text: `gh` is not available, so
here it is.

1. **One list of map keys.** `MAP_KEYS` in `ui/scripts/build-art.mjs` is a
   regex kept in step by hand with the keys `scene` in `ui/src/tileset.ts`
   reads. A key added to one and missed in the other draws magenta or no
   art, with nothing failing. Make one the source of the other (e.g. export
   the key patterns from a small module both import; build-art.mjs is a Node
   script, tileset.ts is bundled by Vite, so a plain .mjs/.js module or a
   JSON file both can read), or, if that is awkward, a test that fails when
   they disagree. Say which and why.
2. **`JAVA_COLORS` twins.** `ui/src/resources.ts` lists every java.awt.Color
   name twice (`white`/`WHITE`, ...); a typo in one twin goes unnoticed.
   List each colour once and derive the other spelling (java.awt.Color's
   upper-case names are the lower-case ones with camel-case words split by
   `_`, e.g. `lightGray`/`LIGHT_GRAY`; check every one against the real
   class's field list, which is fixed and well known). Add a test.
3. **`build-art.mjs` arguments.** `--manifest` is only recognised right after
   `<out>`; elsewhere it is taken as a mod directory; `named`/`rest` are
   unclear names. Parse `--manifest <file>` wherever it appears, rename the
   variables, keep the usage line in the header comment true. `build.sh`
   calls it twice; both calls must keep working.

Not in this task: the shared browser-script setup and the test Tileset in
release builds.

Done when:
- `vp check` and `vp test` pass. For item 3, `./dev.sh ./build.sh` runs to
  the end and `ui/generated/public/art` holds the same files as before your
  change (compare a listing from before and after; report the counts).
- One commit per item, subjects like
  `Tileset: derive JAVA_COLORS' upper-case names (#36)`.

Traps:
- Do not change `colorValue` in resources.ts (another job works there).
- The art a Tileset draws must not change: no key may be added to or
  dropped from what build-art.mjs copies.
