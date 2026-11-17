"""Download Class I freight lines from the BTS NTAD North American Rail Network (NARN).

Keeps segments owned by, or with trackage rights for, a Class I railroad,
on active network types: M (main), S (siding), Y (yard).
Output: data/raw/narn_class1_lines.geojson (WGS84).
"""
import json
import sys
import time
from pathlib import Path

import requests

URL = ("https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/"
       "NTAD_North_American_Rail_Network_Lines/FeatureServer/0/query")
CLASS1 = ["BNSF", "UP", "CSXT", "NS", "CN", "CPKC"]
NETS = ["M", "S", "Y"]
FIELDS = ["OBJECTID", "FRAARCID", "FRFRANODE", "TOFRANODE", "STATEAB", "COUNTRY",
          "RROWNER1", "RROWNER2", "RROWNER3"] + [f"TRKRGHTS{i}" for i in range(1, 10)] + [
          "SUBDIV", "YARDNAME", "NET", "TRACKS", "MILES", "KM"]
PAGE = 2000


def where() -> str:
    ins = ",".join(f"'{c}'" for c in CLASS1)
    cols = ["RROWNER1", "RROWNER2", "RROWNER3"] + [f"TRKRGHTS{i}" for i in range(1, 10)]
    owner = " OR ".join(f"{c} IN ({ins})" for c in cols)
    nets = ",".join(f"'{n}'" for n in NETS)
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


def main(out: Path):
    w = where()
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
    main(root / "data/raw/narn_class1_lines.geojson")
