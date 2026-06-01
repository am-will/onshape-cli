#!/usr/bin/env bash
set -euo pipefail

mkdir -p out

npx onshape create-document --name "NPM 0.1.1 Candy Cane Demo $(date +%Y%m%d-%H%M%S)" --public \
  | tee out/create-document.json

doc=$(jq -r '.result.id' out/create-document.json)
ws=$(jq -r '.result.defaultWorkspace.id' out/create-document.json)

npx onshape get-elements --doc "$doc" --ws "$ws" | tee out/elements.json
elem=$(
  jq -r '.result[] | select(.element_type=="Part Studio" or .elementType=="PARTSTUDIO") | .id' \
    out/elements.json | head -n 1
)

printf '{"doc":"%s","ws":"%s","elem":"%s","url":"https://cad.onshape.com/documents/%s/w/%s/e/%s"}\n' \
  "$doc" "$ws" "$elem" "$doc" "$ws" "$elem" | tee out/ids.json

npx onshape sketch-circle \
  --doc "$doc" --ws "$ws" --elem "$elem" \
  --plane Top \
  --center 0.95,0 \
  --radius 0.16 \
  --name "Stem circular profile" \
  | tee out/01-stem-sketch.json

stem_sketch=$(jq -r '.result.featureId' out/01-stem-sketch.json)

npx onshape extrude \
  --doc "$doc" --ws "$ws" --elem "$elem" \
  --sketch "$stem_sketch" \
  --depth 4.05 \
  --op NEW \
  --name "Straight cylindrical stem" \
  | tee out/02-stem-extrude.json

npx onshape sketch-circle-axis \
  --doc "$doc" --ws "$ws" --elem "$elem" \
  --plane Front \
  --center 0.95,3.9 \
  --radius 0.16 \
  --axis-start -0.05,2.6 \
  --axis-end -0.05,5.3 \
  --name "Hook circular profile and revolve axis" \
  | tee out/03-hook-sketch.json

hook_sketch=$(jq -r '.result.featureId' out/03-hook-sketch.json)

npx onshape revolve \
  --doc "$doc" --ws "$ws" --elem "$elem" \
  --sketch "$hook_sketch" \
  --angle 205 \
  --op ADD \
  --name "Curved cylindrical hook" \
  | tee out/04-hook-revolve.json

npx onshape validate-partstudio \
  --doc "$doc" --ws "$ws" --elem "$elem" \
  --expect-parts 1 \
  --expect-bodies 1 \
  | tee out/05-validate.json
