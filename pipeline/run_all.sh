#!/usr/bin/env bash
# Rebuild everything in public/data from public sources (BTS NTAD NARN).
set -euo pipefail
cd "$(dirname "$0")/.."
PY=.venv/bin/python
[ -x "$PY" ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
MS="npx -y mapshaper@0.6.102"
mkdir -p data/raw data/processed public/data

$PY -I pipeline/download_narn.py
$PY -I pipeline/build_graph.py
$PY -I pipeline/export_web_graph.py

$PY -I pipeline/export_basemap.py
$MS data/processed/mainline_full.geojson -dissolve owner,class -simplify 8% keep-shapes \
  -o precision=0.0001 public/data/basemap_mainline.geojson
rm data/processed/mainline_full.geojson

echo "public/data rebuilt"
