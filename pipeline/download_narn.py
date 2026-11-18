"""Download freight lines from the BTS NTAD North American Rail Network (NARN).

Active network types only: M (main), S (siding), Y (yard). Two files (WGS84):
  data/raw/narn_class1_lines.geojson  segments owned by, or with trackage rights for, a Class I railroad
  data/raw/narn_other_lines.geojson   every other segment: regional and short-line railroads, and lines of
                                      passenger agencies; build_graph.py classifies the owners and keeps
                                      only track some freight railroad may run on
"""
import json
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from railroad_classes import CARRIER_COLS, CLASS1  # noqa: E402

URL = ("https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/"
       "NTAD_North_American_Rail_Network_Lines/FeatureServer/0/query")
NETS = ["M", "S", "Y"]
FIELDS = ["OBJECTID", "FRAARCID", "FRFRANODE", "TOFRANODE", "STATEAB", "COUNTRY"] + CARRIER_COLS + [
          "SUBDIV", "YARDNAME", "NET", "TRACKS", "MILES", "KM"]
PAGE = 2000


def where(class1: bool) -> str:
    ins = ",".join(f"'{c}'" for c in CLASS1)
    nets = ",".join(f"'{n}'" for n in NETS)
    if class1:
        owner = " OR ".join(f"{c} IN ({ins})" for c in CARRIER_COLS)
    else:
        # The exact complement: an empty column is "not Class I" too (NOT IN alone is unknown on NULL).
        owner = " AND ".join(f"({c} IS NULL OR {c} NOT IN ({ins}))" for c in CARRIER_COLS)
    return f"({owner}) AND NET IN ({nets})"


def fetch(params, tries=5):
    for i in range(tries):
        try:
            r = requests.post(URL, data=params, timeout=120)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # network hiccups: back off and retry
            print(f"  retry {i + 1}: {e}", file=sys.stderr)
            time.sleep(2 ** i)
    raise RuntimeError("query failed")


def main(out: Path, class1: bool):
    w = where(class1)
    total = fetch({"where": w, "returnCountOnly": "true", "f": "json"})["count"]
    print(f"{total} segments match")
    feats = []
    for off in range(0, total, PAGE):
        page = fetch({"where": w, "outFields": ",".join(FIELDS), "outSR": 4326,
                      "orderByFields": "OBJECTID", "resultOffset": off,
                      "resultRecordCount": PAGE, "f": "geojson"})
        feats.extend(page["features"])
        print(f"  {len(feats)}/{total}", end="\r")
    print()
    out.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print(f"wrote {len(feats)} features -> {out}")


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    main(root / "data/raw/narn_class1_lines.geojson", class1=True)
    main(root / "data/raw/narn_other_lines.geojson", class1=False)
