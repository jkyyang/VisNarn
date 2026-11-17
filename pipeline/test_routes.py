import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from railroute import RailRouter

t = time.time(); r = RailRouter(); print(f"loaded in {time.time()-t:.1f}s, {len(r.ids)} snap nodes")
cities = {"Chicago": (-87.63, 41.88), "Los Angeles": (-118.24, 34.05), "Houston": (-95.37, 29.76),
          "Toronto": (-79.38, 43.65), "Atlanta": (-84.39, 33.75), "Seattle": (-122.33, 47.61)}
snap = {c: r.snap(*xy) for c, xy in cities.items()}
for c, (n, d) in snap.items(): print(f"{c:12s} -> node {n}, {d:.2f} km away")
for a, b, ref in [("Chicago", "Los Angeles", 3600), ("Toronto", "Houston", 2900),
                  ("Seattle", "Atlanta", 4400)]:
    t = time.time(); km, pts = r.route(snap[a][0], snap[b][0])
    print(f"{a} -> {b}: {km:,.0f} km ({len(pts)} pts, {time.time()-t:.2f}s); rough real-rail ~{ref:,} km")
