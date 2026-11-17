#!/usr/bin/env bash
# Rebuild everything in public/data from public sources (BTS NTAD NARN, world-atlas, us-atlas).
set -euo pipefail
cd "$(dirname "$0")/.."
PY=.venv/bin/python
[ -x "$PY" ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
MS="npx -y mapshaper@0.6.102"
mkdir -p data/raw/borders data/processed public/data

$PY -I pipeline/download_narn.py
$PY -I pipeline/build_graph.py
$PY -I pipeline/export_web_graph.py

$PY -I pipeline/export_basemap.py
$MS data/processed/mainline_full.geojson -dissolve owner -simplify 8% keep-shapes \
  -o precision=0.0001 public/data/basemap_mainline.geojson
rm data/processed/mainline_full.geojson

curl -sfo data/raw/borders/countries-50m.json https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json
curl -sfo data/raw/borders/states-10m.json https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json
$MS -i data/raw/borders/countries-50m.json -target countries \
  -filter '["United States of America","Canada","Mexico"].indexOf(name)>-1' \
  -clip bbox=-170,14,-50,72 -simplify 15% -o format=geojson precision=0.001 public/data/countries.geojson
$MS -i data/raw/borders/states-10m.json -target states -innerlines -simplify 20% \
  -o format=geojson precision=0.001 public/data/states.geojson
echo "public/data rebuilt"
