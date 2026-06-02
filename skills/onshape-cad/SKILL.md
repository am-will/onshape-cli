---
name: onshape-cad
description: Use when a task mentions Onshape, CAD, cad.onshape.com URLs, parametric parts, 3D printing, or model inspection/export.
---

# Onshape CAD CLI

Use this skill to drive Onshape through the repo's CLI. The Python command is
`onshape-cli`; the Node/npm command is `onshape`. They share command names,
flags, and JSON output.

## Run Model

- Installed Python CLI: `onshape-cli <command> ...`
- From this repo without install: `python -m onshape_cli.cli <command> ...`
- Node package: `onshape <command> ...` or `npx onshape <command> ...`
- Every shell call is fresh. Do not rely on aliases, shell functions, or prior
  `export`s unless they are set in the same command.
- Every command prints JSON:
  - success: `{"ok": true, "result": ...}`
  - failure: `{"ok": false, "error": ..., "detail": ...}`
- Capture feature/document ids from `.result` with `jq`; read `.detail.message`
  and `.detail.notices` before retrying failures.

## Auth

Create an API key at `https://dev.onshape.com` -> API keys.

Credential lookup order:

1. `--access-key` / `--secret-key`
2. `ONSHAPE_ACCESS_KEY` / `ONSHAPE_SECRET_KEY`
3. `~/.onshape/credentials.json` or `ONSHAPE_CONFIG`
4. Linux `$XDG_CONFIG_HOME/onshape/credentials.json`
5. `~/.claude/mcp.json` `onshape` block

Useful commands:

```bash
onshape-cli login
onshape-cli config show
onshape-cli logout
```

For scripted agents, prefer env vars or explicit flags. `ONSHAPE_BASE_URL` or
`--base-url` can override the API base URL.

## Targeting

Most geometry commands need a document, workspace, and element:

```bash
--doc <documentId> --ws <workspaceId> --elem <elementId>
```

You can also set `ONSHAPE_DOC`, `ONSHAPE_WS`, and `ONSHAPE_ELEM` inside the same
shell command. Extract ids from URLs shaped like:

```text
https://cad.onshape.com/documents/<doc>/w/<workspace>/e/<element>
```

Discovery flow:

```bash
onshape-cli list-documents --limit 10
onshape-cli search-documents "name"
onshape-cli get-document-summary --doc D
onshape-cli get-elements --doc D --ws W --type PARTSTUDIO
onshape-cli find-part-studios --doc D --ws W --name "Part"
```

Free Onshape accounts can create only public documents:

```bash
onshape-cli create-document --name "Agent build" --public
```

The result includes `result.id` and `result.defaultWorkspace.id`.

## Core Workflow

For new parts:

1. Search before creating, so reruns do not create duplicates.
2. Create or find a document and part studio.
3. Make one clean, closed sketch when possible.
4. Add features and capture returned feature ids.
5. Verify with `measure`.
6. Render with `shaded-view` or `get-thumbnail`.
7. Export only after measurement and visual inspection.

Minimal example:

```bash
DOC=$(onshape-cli create-document --name "Bracket" --public | jq -r .result.id)
WS=$(onshape-cli get-document --doc "$DOC" | jq -r .result.defaultWorkspace.id)
ELEM=$(onshape-cli create-part-studio --doc "$DOC" --ws "$WS" --name "Part" | jq -r .result.response.id)
SK=$(onshape-cli sketch-rectangle --doc "$DOC" --ws "$WS" --elem "$ELEM" --plane Top --corner1 0,0 --corner2 3,2 | jq -r .result.featureId)
EX=$(onshape-cli extrude --doc "$DOC" --ws "$WS" --elem "$ELEM" --sketch "$SK" --depth 0.25 | jq -r .result.featureId)
onshape-cli fillet --doc "$DOC" --ws "$WS" --elem "$ELEM" --feature "$EX" --radius 0.1
onshape-cli measure --doc "$DOC" --ws "$WS" --elem "$ELEM"
onshape-cli shaded-view --doc "$DOC" --ws "$WS" --elem "$ELEM" --out render.png
onshape-cli export-stl --doc "$DOC" --ws "$WS" --elem "$ELEM" --out bracket.stl
```

## Geometry Selection

Edges and faces are usually selected with FeatureScript queries evaluated by
Onshape. Prefer queries over raw ids unless a command needs an axis or direction.

Common selectors:

- all solid bodies: `qAllModifiableSolidBodies();`
- faces created by feature: `qCreatedBy(makeId("FID"), EntityType.FACE);`
- edges created by feature: `qCreatedBy(makeId("FID"), EntityType.EDGE);`

Shared selection flags:

- `--all`: all edges on all solid bodies
- `--feature FID`: edges from a feature
- `--circular`: circular or arc edges
- `--query "<FeatureScript query>"`
- `--edges id1,id2` or `--faces id1,id2`

Default plane ids: Front `JCC`, Top `JDC`, Right `JEC`.

## Command Map

Documents: `list-documents`, `search-documents`, `get-document`,
`get-document-summary`, `create-document`, `delete-document`,
`update-document`, `get-elements`, `find-part-studios`, `get-workspaces`,
`list-versions`, `create-version`.

Part studios: `create-part-studio`, `delete-element`, `delete-feature`,
`get-parts`, `get-features`, `get-feature-specs`, `get-sketch-info`,
`get-body-details`, `validate-partstudio`, `rollback`.

Sketching: `sketch-rectangle`, `sketch-circle`, `sketch-line`,
`sketch-circle-axis`, `sketch-candy-cane-path`, `create-sketch`.

Solids: `extrude`, `hole`, `thicken`, `revolve`, `sweep`, `draft`.

Edges/faces: `fillet`, `chamfer`, `shell`.

Booleans/patterns: `boolean`, `boolean-union`, `mirror`, `linear-pattern`,
`circular-pattern`, `offset-plane`.

Assemblies: `create-assembly`, `insert-instance`, `get-assembly-features`,
`assembly-add-feature`, `assembly-mate-connector`, `assembly-mate`,
`assembly-group`, `get-bom`, `assembly-mass-properties`, `transform-instance`,
`delete-instance`.

Drawings: `create-drawing`, `get-drawing-views`, `export-drawing`.

Feature Studios: `create-feature-studio`, `get-feature-studio`,
`set-feature-studio`, `get-feature-studio-specs`.

Metadata/config: `get-metadata`, `set-metadata`, `get-variables`,
`set-variable`, `get-configuration`, `encode-configuration`.

Images/export/measure: `thumbnail-info`, `get-thumbnail`, `shaded-view`,
`measure`, `get-edges`, `find-circular-edges`, `find-edges-by-feature`,
`mass-properties`, `export-stl`, `export`.

Raw feature access: `add-feature`, `update-feature`,
`eval-featurescript`. Use `get-feature-specs` first, then pass a
`BTFeatureDefinitionCall-1406` envelope as `--json` or `--json-file`.

## CAD Rules That Prevent Bad Builds

- Units are inches; angles are degrees.
- For 3D printing, `export-stl` is the simplest reliable export. Use `export`
  for STEP/IGES/3MF/PARASOLID.
- Cross-document inserts and drawings require a version: run `create-version`.
- Patterns need real edge ids for `--direction-ids` or `--axis-ids`; get them
  with `get-edges`.
- Do not chamfer or shell every edge of a body that was already heavily filleted.
- `shell` needs at least one face to remove.
- `revolve` and `offset-plane` can be regen-rejected; inspect `featureStatus`.
- Prefer one closed profile sketch plus one `extrude --op NEW` over many fragile
  additive/removal steps.
- When sketching on Front, sketch X maps to world X, sketch Y maps to world Z,
  and extrude depth maps to world Y. In `measure`, `bbox.z` is height and
  `bbox.y` is depth for Front-plane profiles.
- `measure` verifies dimensions; rendered images verify shape and orientation.
- To edit an existing model, target its existing `doc/ws/elem`; do not recreate
  or overwrite it.

## Debugging

- `ok:false` or `result.value: null` is usually a real API or FeatureScript
  error, not a transient. Inspect `detail.message` and `detail.notices`.
- If a FeatureScript map key conflicts with a variable name, quote the key or use
  a different key name.
- Seed FeatureScript accumulators with typed zero values when adding measured
  quantities.
- If unsure about a feature payload, run `get-feature-specs` and use
  `add-feature` or `update-feature` with JSON.
