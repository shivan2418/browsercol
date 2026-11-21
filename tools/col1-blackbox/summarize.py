"""Summarise soak runs: every tax change with its year, and where each run ended.
Usage: python3 summarize.py runs/PREFIX-*"""
import json, statistics, sys

rows = []
for d in sys.argv[1:]:
    try:
        recs = [json.loads(l) for l in open(f"{d}/turns.jsonl")]
    except (FileNotFoundError, NotADirectoryError):
        continue
    turns = [r for r in recs if "year" in r]
    if not turns:
        continue
    changes, prev = [], 0
    for r in turns:
        if r["tax"] != prev:
            changes.append((r["year"], prev, r["tax"]))
            prev = r["tax"]
    screens = sum(1 for r in recs if "screen" in r)
    rows.append((d, turns[-1]["year"], len(turns), changes, screens))
    print(f"{d}: {len(turns)} turns to {turns[-1]['year']}, final tax {prev}%, {screens} screens")
    for y, a, b in changes:
        print(f"    {y}: {a}% -> {b}%")

firsts = [c[0][0] for *_, c, _ in rows if c]
print(f"\n{len(rows)} runs; {len(firsts)} saw a tax change")
if firsts:
    print("first change years:", sorted(firsts), "median", statistics.median(firsts))
steps = [b - a for *_, c, _ in rows for _, a, b in c]
if steps:
    print("step sizes:", sorted(steps))
