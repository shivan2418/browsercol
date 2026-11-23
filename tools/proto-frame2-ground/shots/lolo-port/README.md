# Lolonization's own renderer on BrowserCol's USA map

Throwaway. Lolonization's `prototypes/connected` (the water-proto checkout, 19 Oct) run unchanged except:

- the map: BrowserCol's `S_USA_Mazim` (via `usa-names.json`) converted to its `fixtures/maps/amer2.json` format.
  Forest types keep their names, hills/mountains take their neighbours' base ground, rivers are all `minor`.
- `layered.js`: `?cam=td` projects the trees top-down (it was iso-only, so its top-down camera showed no trees).

How it was run: copy to `.cache/lolo/` (gitignored), Vite in `node:22-slim` on 127.0.0.1:5191, screenshots from an
isolated Chromium in `mcr.microsoft.com/playwright:v1.58.2-noble` (`?cam=td&fx=&fy=&zoom=`).
Units and ships in the shots are Lolonization's demo units, not the map's.
