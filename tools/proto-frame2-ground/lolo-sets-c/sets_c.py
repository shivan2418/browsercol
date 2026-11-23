# PROTOTYPE (BrowserCol port): a second top-down edge painting per forest type ("td-c"), so long forest edges stop
# repeating one piece, with slightly fuller discs so a lone forest tile is a solid clump, not a hollow ring.
#
#   uv run --with numpy,pillow,scipy python tools/sets_c.py guide            # guide, layout entry, collages, prompts
#   python3 tools/sets_c.py paint [SET ...]                                  # Meshy, gpt-image-2-5-flare, 12 credits each
#   uv run --with numpy,pillow,scipy python tools/sets_c.py slice [SET ...]  # sets.json with a + c + full pieces
import json, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
G = 'ai/guides'
FORESTS = ['Broadleaf', 'Mixed', 'Conifer', 'Boreal', 'Tropical', 'Rain', 'Scrub', 'Wetland']


def guide():
    import numpy as np
    from PIL import Image
    from guide import tori, mask, silhouette, draw, collage, TERRAIN
    import sets
    all_t = tori()
    layout = json.load(open(f'{G}/layout.json'))
    used = [layout['forest-td-a']['grid'], layout['forest-td-b']['grid']]
    g = next(t for t in all_t[len(all_t) // 4:] if t not in used)
    sil = silhouette(g, seed=21, rad=.46)
    draw(sil, *TERRAIN['forest']).save(f'{G}/forest-td-c.png')
    layout['forest-td-c'] = {'grid': g, 'cells': [[mask(g, r, c) for c in range(4)] for r in range(4)]}
    json.dump(layout, open(f'{G}/layout.json', 'w'), indent=1)
    for key in FORESTS:
        spr = [sets.tinted(sets.TREE[t], m) for t, m in sets.FOREST[key][0]]
        collage(sil, spr, seed=17, spacing=.14, wmin=.2, wmax=.34, base=.1).save(f'{G}/forest-{key}-td-c-collage.png')
        Path(f'ai/prompts/forest-{key}-td-c.txt').write_text(prompt(key))
    print('guide c', g)


def prompt(key):
    import sets
    p = sets.prompt(f'forest-{key}', 'td-a')
    p = p.replace('with gaps of bare ground between them', 'in close clumps')
    return p + ("\n\nEvery wooded area is filled solid with crowns right up to its outline, small round clumps included: "
                "no hollow middles, no rings of trees around an empty centre.")


def paint_one(key):
    out = Path(f'ai/out/forest-{key}-td-c.png')
    if out.exists():
        return f'{out} exists'
    r = subprocess.run(['python3', 'tools/meshy.py', str(out), f'ai/prompts/forest-{key}-td-c.txt',
                        f'{G}/forest-{key}-td-c-collage.png', 'ai/ref/a-sheet.jpg', '--model', 'gpt-image-2-5-flare'],
                       capture_output=True, text=True)
    return (r.stdout + r.stderr).strip()


def slice_c(key):
    import numpy as np
    import sets
    from slice import FADE, M, P, footprint, key_white
    from PIL import Image
    from guide import C
    from slice import N
    name = f'forest-{key}'
    layout = json.load(open(f'{G}/layout.json'))
    pieces = []
    for v in ('a', 'c', 'full'):
        a = np.array(Image.open(f'ai/out/{name}-td-{v}.png').convert('RGB').resize((N, N), Image.LANCZOS)).astype(float)
        alpha = key_white(a, 0)
        if v != 'full':
            alpha = alpha * footprint(f'{G}/forest-td-{v}.png', 14, 60)
        img = np.dstack([a, alpha])
        big = np.pad(img, ((M, M), (M, M), (0, 0)), mode='wrap')
        cells = layout[f'forest-td-{v}' if v != 'full' else 'forest-full']['cells']
        for row, masks in enumerate(cells):
            for col, m in enumerate(masks):
                p = big[row * C:row * C + P, col * C:col * C + P].copy()
                if v == 'full' and p[M:-M, M:-M, 3].mean() < .9:
                    continue
                p[..., 3] *= FADE
                pieces.append((m, v, p))
    td = {'img': f'{name}.png', 'cell': C, 'margin': M, 'pieces': sets.pack(pieces, P, P, f'public/assets/ai/{name}.png', 8)}
    path = Path('public/assets/ai/sets.json')
    d = json.loads(path.read_text())
    d[name] = td
    path.write_text(json.dumps(d))
    return f'{name}: {len(pieces)} td pieces'


if __name__ == '__main__':
    cmd, names = sys.argv[1], sys.argv[2:] or FORESTS
    if cmd == 'guide':
        guide()
    elif cmd == 'paint':
        with ThreadPoolExecutor(8) as ex:
            for r in ex.map(paint_one, names):
                print(r, flush=True)
    elif cmd == 'slice':
        for k in names:
            print(slice_c(k))
