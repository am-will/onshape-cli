#!/usr/bin/env bash
set -euo pipefail

mkdir -p out

npx onshape create-document --name "NPM 0.1.3 Candy Cane Demo $(date +%Y%m%d-%H%M%S)" --public \
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
  --name "Round candy profile" \
  --no-validate \
  | tee out/01-profile.json

profile=$(jq -r '.result.featureId' out/01-profile.json)

npx onshape sketch-candy-cane-path \
  --doc "$doc" --ws "$ws" --elem "$elem" \
  --plane Front \
  --x 0.95 \
  --bottom 0 \
  --straight-height 4.05 \
  --hook-radius 1.0 \
  --hook-angle 210 \
  --segments 24 \
  --name "Candy cane centerline" \
  --no-validate \
  | tee out/02-path.json

path=$(jq -r '.result.featureId' out/02-path.json)

npx onshape sweep \
  --doc "$doc" --ws "$ws" --elem "$elem" \
  --profile "$profile" \
  --path "$path" \
  --op NEW \
  --name "Continuous candy cane body" \
  --no-validate \
  | tee out/03-sweep.json

base_sweep=$(jq -r '.result.featureId' out/03-sweep.json)
stripe_features=()
stripe_index=0
for offset in 0.55 1.15 1.75 2.35 2.95 3.55; do
  stripe_index=$((stripe_index + 1))
  npx onshape offset-plane \
    --doc "$doc" --ws "$ws" --elem "$elem" \
    --base-plane Top \
    --offset "$offset" \
    --name "Stripe plane $stripe_index" \
    --no-validate \
    | tee "out/stripe-$stripe_index-plane.json"

  stripe_plane=$(jq -r '.result.featureId' "out/stripe-$stripe_index-plane.json")

  npx onshape sketch-circle \
    --doc "$doc" --ws "$ws" --elem "$elem" \
    --plane Top \
    --plane-feature "$stripe_plane" \
    --center 0.95,0 \
    --radius 0.19 \
    --name "Stripe profile $stripe_index" \
    --no-validate \
    | tee "out/stripe-$stripe_index-sketch.json"

  stripe_sketch=$(jq -r '.result.featureId' "out/stripe-$stripe_index-sketch.json")

  npx onshape extrude \
    --doc "$doc" --ws "$ws" --elem "$elem" \
    --sketch "$stripe_sketch" \
    --depth 0.22 \
    --op ADD \
    --name "Raised red stripe $stripe_index" \
    --no-validate \
    | tee "out/stripe-$stripe_index-extrude.json"

  stripe_features+=("$(jq -r '.result.featureId' "out/stripe-$stripe_index-extrude.json")")
done

npx onshape create-feature-studio \
  --doc "$doc" --ws "$ws" \
  --name "Candy cane appearance" \
  | tee out/04-create-feature-studio.json

feature_studio=$(jq -r '.result.id' out/04-create-feature-studio.json)

{
cat <<FS
FeatureScript 2960;
import(path : "onshape/std/common.fs", version : "2960.0");

annotation { "Feature Type Name" : "Candy cane appearance" }
export const candyCaneAppearance = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
    }
    {
        setProperty(context, {
            "entities" : qCreatedBy(makeId("$base_sweep"), EntityType.FACE),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : color(1, 1, 1)
        });
FS
for stripe_feature in "${stripe_features[@]}"; do
cat <<FS
        setProperty(context, {
            "entities" : qCreatedBy(makeId("$stripe_feature"), EntityType.FACE),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : color(0.9, 0.02, 0.02)
        });
FS
done
cat <<'FS'
    });
FS
} > out/candy-appearance.fs

npx onshape set-feature-studio \
  --doc "$doc" --ws "$ws" --elem "$feature_studio" \
  --contents-file out/candy-appearance.fs \
  | tee out/05-set-feature-studio.json

npx onshape get-feature-studio-specs \
  --doc "$doc" --ws "$ws" --elem "$feature_studio" \
  | tee out/06-feature-studio-specs.json

namespace=$(jq -r '.result.featureSpecs[0].namespace' out/06-feature-studio-specs.json)

cat > out/07-add-appearance.json <<JSON
{
  "btType": "BTFeatureDefinitionCall-1406",
  "feature": {
    "btType": "BTMFeature-134",
    "featureType": "candyCaneAppearance",
    "name": "Candy cane appearance",
    "namespace": "$namespace",
    "parameters": [],
    "suppressed": false
  }
}
JSON

npx onshape add-feature \
  --doc "$doc" --ws "$ws" --elem "$elem" \
  --json-file out/07-add-appearance.json \
  --no-validate \
  | tee out/08-appearance-feature.json

npx onshape validate-partstudio \
  --doc "$doc" --ws "$ws" --elem "$elem" \
  --expect-parts 1 \
  --expect-bodies 1 \
  | tee out/09-validate.json
