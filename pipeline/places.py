"""Town names and coordinates for place labels and search, from the GeoNames gazetteer (CC BY 4.0,
https://www.geonames.org): every town in the US, Canada and Mexico of MIN_POPULATION people or more.

Writes them into public/data/graph_meta.json as "places": {"Oakville, ON": [lon, lat], ...}, the
largest town first, so a search lists the bigger of two matches first. A name used twice in one state
or province is kept once, for the larger town. Run after export_web_graph.py, which writes that file.
"""
import csv
import io
import json
import sys
import time
import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
# Every town of 5,000 people or more, and every seat of a state, county or municipality.
URL = "https://download.geonames.org/export/dump/cities5000.zip"
RAW = ROOT / "data/raw/cities5000.zip"
META = ROOT / "public/data/graph_meta.json"
COUNTRIES = {"US", "CA", "MX"}
MIN_POPULATION = 5000
# Neighbourhoods would name a spot in a city after its district; abandoned and historical places are gone.
SKIP_FEATURES = {"PPLX", "PPLQ", "PPLH"}
# About 100 m.
DECIMALS = 3

# GeoNames admin1 codes. The US ones are the postal codes already; Canada gets its postal codes and
# Mexico its ISO 3166-2 codes.
PROVINCES = {"01": "AB", "02": "BC", "03": "MB", "04": "NB", "05": "NL", "07": "NS", "08": "ON", "09": "PE",
             "10": "QC", "11": "SK", "12": "YT", "13": "NT", "14": "NU"}
MX_STATES = {"01": "AGU", "02": "BCN", "03": "BCS", "04": "CAM", "05": "CHP", "06": "CHH", "07": "COA", "08": "COL",
             "09": "CMX", "10": "DUR", "11": "GUA", "12": "GRO", "13": "HID", "14": "JAL", "15": "MEX", "16": "MIC",
             "17": "MOR", "18": "NAY", "19": "NLE", "20": "OAX", "21": "PUE", "22": "QUE", "23": "ROO", "24": "SLP",
             "25": "SIN", "26": "SON", "27": "TAB", "28": "TAM", "29": "TLA", "30": "VER", "31": "YUC", "32": "ZAC"}
STATE = {"US": lambda code: code, "CA": PROVINCES.get, "MX": MX_STATES.get}


def download():
    for i in range(5):
        try:
            r = requests.get(URL, timeout=120)
            r.raise_for_status()
            RAW.parent.mkdir(parents=True, exist_ok=True)
            RAW.write_bytes(r.content)
            return
        except Exception as e:  # network hiccups: back off and retry
            print(f"  retry {i + 1}: {e}", file=sys.stderr)
            time.sleep(2 ** i)
    raise RuntimeError("GeoNames download failed")


def places():
    """{"Name, ST": (lon, lat)}, the largest town first."""
    with zipfile.ZipFile(RAW) as z:
        rows = list(csv.reader(io.TextIOWrapper(z.open("cities5000.txt"), "utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE))
    towns = []
    for r in rows:
        name, lat, lon, feature, country, admin1, population = r[2], float(r[4]), float(r[5]), r[7], r[8], r[10], int(r[14] or 0)
        state = STATE[country](admin1) if country in COUNTRIES else None
        if state and population >= MIN_POPULATION and feature not in SKIP_FEATURES:
            towns.append((population, f"{name}, {state}", (round(lon, DECIMALS), round(lat, DECIMALS))))
    found = {}
    for _, label, at in sorted(towns, key=lambda t: -t[0]):
        found.setdefault(label, at)
    return found


download()
meta = json.loads(META.read_text())
meta["places"] = places()
META.write_text(json.dumps(meta, separators=(",", ":")))
print(len(meta["places"]), "places from GeoNames")
