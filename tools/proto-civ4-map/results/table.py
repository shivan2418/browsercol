# THROWAWAY (#405): the write-up's numbers table, from the JSON files next to this script.
import json, os
d = os.path.dirname(os.path.abspath(__file__))
b = json.load(open(os.path.join(d, 'bench-igpu-chromium.json')))
far = json.load(open(os.path.join(d, 'far-igpu-chromium.json')))
names = {'topdown': 'Top-down straight', 'oblique': 'Colonization oblique', 'tilt': 'Civ IV tilt', 'iso': 'Isometric'}
out = ['| Window, dpr | Camera | Pan and zoom, 1x CPU: p50 / p95 | 6x CPU: p50 / p95 | Whole map in view, 1x: p50 / p95 | Load to first frame, 1x / 6x |', '|---|---|---|---|---|---|']
for size, dpr in [('1280x720', 1), ('1280x720', 2), ('1920x1080', 1), ('1920x1080', 2)]:
    for v in ['topdown', 'oblique', 'tilt', 'iso']:
        g = lambda t: [r for r in b if '%dx%d' % (r['size'][0]/r['dpr'], r['size'][1]/r['dpr']) == size and r['dpr'] == dpr and r['view'] == v and r['throttle'] == t][0]
        a, c = g(1), g(6)
        f = [r for r in far if r['size'] == size and r['dpr'] == dpr and r['view'] == v][0]
        out.append(f"| {size} @{dpr}x | {names[v]} | {a['workP50']:.1f} / {a['workP95']:.1f} ms | {c['workP50']:.1f} / {c['workP95']:.1f} ms | {f['workP50']:.1f} / {f['workP95']:.1f} ms | {a['timing']['loadToFirstFrameMs']} / {c['timing']['loadToFirstFrameMs']} ms |")
print('\n'.join(out))
r = b[0]
print({k: r[k] for k in ['calls', 'triangles', 'textures', 'textureMB', 'geometryMB', 'terrainTris', 'trees', 'peaks', 'units', 'timing']})
print('max load1', max(x['load1'] for x in b))
