# onshape-cli

Command-line CAD automation for [Onshape](https://www.onshape.com). Build,
inspect, render, validate, and export parametric models from a terminal, script,
or coding agent.

This repository contains two CLIs with the same command names, flags, credential
store, and JSON contract:

- `onshape-cli`: the Python CLI.
- `onshape`: the Node/npm CLI.

Both talk directly to the Onshape REST API over HTTP Basic auth and print
machine-readable JSON:

```json
{"ok": true, "result": "..."}
{"ok": false, "error": "...", "detail": "..."}
```

## What It Can Do

- Discover documents, workspaces, elements, part studios, assemblies, drawings,
  versions, variables, metadata, and feature definitions.
- Create sketches, extrudes, holes, thickens, sweeps, revolves, drafts, fillets,
  chamfers, shells, booleans, mirrors, and linear/circular patterns.
- Query geometry, measure bounding boxes and volume, inspect edges, and read mass
  properties.
- Create assemblies, insert instances, add mate connectors and mates, group
  instances, transform/delete instances, and read BOMs.
- Create drawings and Feature Studios, set FeatureScript contents, and add raw
  feature payloads when the high-level commands are not enough.
- Download thumbnails, server-render shaded PNG views, and export STL, STEP,
  IGES, 3MF, Parasolid, and drawing PDFs.
- Provide a concise [agent skill](skills/onshape-cad/SKILL.md) for AI coding
  agents that need to operate Onshape safely and repeatably.

## Install

Python, from source:

```bash
git clone https://github.com/am-will/onshape-cli
cd onshape-cli
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

Python requires 3.10 or newer. Runtime dependencies are `httpx`, `pydantic`, and
`loguru`. Optional keychain storage support is available with:

```bash
pip install -e '.[keychain]'
```

Python with `uvx`:

```bash
# after the Python package is published to PyPI
uvx onshape-cli --help
uvx onshape-cli list-documents --limit 5

# from GitHub without a PyPI publish
uvx --from git+https://github.com/am-will/onshape-cli onshape-cli --help

# from a local checkout
uvx --from /path/to/onshape-cli onshape-cli --help
```

Node/npm:

```bash
npm install -g onshape
onshape --help
```

Or run without a global install:

```bash
npx onshape list-documents --limit 5
```

The npm package requires Node 18 or newer. Its source lives in [node/](node/).

## Authenticate

Create an API key pair at [dev.onshape.com](https://dev.onshape.com) under API
keys. Save it once with either CLI:

```bash
onshape-cli login
# or
onshape login
```

Useful credential commands:

```bash
onshape-cli config show
onshape-cli config path
onshape-cli logout
```

For headless or scripted environments:

```bash
onshape-cli login --store file --access-key "$ONSHAPE_ACCESS_KEY" --secret-key "$ONSHAPE_SECRET_KEY" --no-verify
onshape config set --store file --access-key "$ONSHAPE_ACCESS_KEY" --secret-key "$ONSHAPE_SECRET_KEY"
```

Credential resolution order is shared by both CLIs:

1. `--access-key` / `--secret-key`
2. `ONSHAPE_ACCESS_KEY` / `ONSHAPE_SECRET_KEY`
3. `~/.onshape/credentials.json` or `ONSHAPE_CONFIG`
4. Linux `$XDG_CONFIG_HOME/onshape/credentials.json`
5. the `onshape` block in `~/.claude/mcp.json`

`ONSHAPE_BASE_URL` or `--base-url` can override the default API base URL,
`https://cad.onshape.com`.

By default, credentials use OS keychain storage when available and fall back to a
`0600` credentials file. The shared storage contract is documented in
[shared/credentials-spec.json](shared/credentials-spec.json).

## Quickstart

Create a public document, create a Part Studio, build a small bracket, validate
dimensions, render it, and export an STL:

```bash
DOC=$(onshape-cli create-document --name "CLI bracket" --public | jq -r .result.id)
WS=$(onshape-cli get-document --doc "$DOC" | jq -r .result.defaultWorkspace.id)
ELEM=$(onshape-cli create-part-studio --doc "$DOC" --ws "$WS" --name "Bracket" | jq -r .result.response.id)

SK=$(onshape-cli sketch-rectangle \
  --doc "$DOC" --ws "$WS" --elem "$ELEM" \
  --plane Top --corner1 0,0 --corner2 3,2 \
  | jq -r .result.featureId)

EX=$(onshape-cli extrude \
  --doc "$DOC" --ws "$WS" --elem "$ELEM" \
  --sketch "$SK" --depth 0.25 --op NEW \
  | jq -r .result.featureId)

onshape-cli fillet --doc "$DOC" --ws "$WS" --elem "$ELEM" --feature "$EX" --radius 0.1
onshape-cli measure --doc "$DOC" --ws "$WS" --elem "$ELEM"
onshape-cli shaded-view --doc "$DOC" --ws "$WS" --elem "$ELEM" --out bracket.png
onshape-cli export-stl --doc "$DOC" --ws "$WS" --elem "$ELEM" --out bracket.stl
```

The same workflow works with `onshape` or `npx onshape`; only the executable name
changes.

Free Onshape accounts can only create public documents, so pass `--public` when
creating documents unless you know the account supports private documents.

## Targeting Documents

Most modeling commands need a document, workspace, and element:

```bash
--doc <documentId> --ws <workspaceId> --elem <elementId>
```

You can pass those flags explicitly or set defaults in the same shell:

```bash
export ONSHAPE_DOC=... ONSHAPE_WS=... ONSHAPE_ELEM=...
```

Onshape URLs contain the same ids:

```text
https://cad.onshape.com/documents/<doc>/w/<workspace>/e/<element>
```

Helpful discovery commands:

```bash
onshape-cli list-documents --limit 10
onshape-cli search-documents "phone holder"
onshape-cli get-document-summary --doc <doc>
onshape-cli get-elements --doc <doc> --ws <workspace> --type PARTSTUDIO
onshape-cli find-part-studios --doc <doc> --ws <workspace> --name "Part"
```

## Command Overview

Documents and versions:
`create-document`, `delete-document`, `update-document`, `list-documents`,
`search-documents`, `get-document`, `get-document-summary`, `get-elements`,
`find-part-studios`, `get-workspaces`, `list-versions`, `create-version`.

Part Studios:
`create-part-studio`, `delete-element`, `delete-feature`, `get-parts`,
`get-features`, `get-feature-specs`, `get-sketch-info`, `get-body-details`,
`validate-partstudio`, `rollback`, `add-feature`, `update-feature`.

Sketches and solids:
`create-sketch`, `sketch-rectangle`, `sketch-circle`, `sketch-line`,
`sketch-circle-axis`, `sketch-candy-cane-path`, `extrude`, `hole`, `thicken`,
`revolve`, `sweep`, `draft`.

Edges, faces, and patterns:
`fillet`, `chamfer`, `shell`, `boolean`, `boolean-union`, `mirror`,
`linear-pattern`, `circular-pattern`, `offset-plane`, `get-edges`,
`find-circular-edges`, `find-edges-by-feature`.

Assemblies:
`create-assembly`, `insert-instance`, `get-assembly`, `get-assembly-features`,
`assembly-add-feature`, `assembly-mate-connector`, `assembly-mate`,
`assembly-group`, `get-bom`, `assembly-mass-properties`, `transform-instance`,
`delete-instance`.

Drawings, Feature Studios, metadata, and config:
`create-drawing`, `get-drawing-views`, `export-drawing`,
`create-feature-studio`, `get-feature-studio`, `set-feature-studio`,
`get-feature-studio-specs`, `get-metadata`, `set-metadata`, `get-variables`,
`set-variable`, `get-configuration`, `encode-configuration`.

Measurement, rendering, export, and FeatureScript:
`measure`, `mass-properties`, `thumbnail-info`, `get-thumbnail`, `shaded-view`,
`export-stl`, `export`, `eval-featurescript`.

Run `onshape-cli --help`, `onshape --help`, or a command-specific help page for
exact flags.

## Geometry Selection

Many commands select edges, faces, or bodies with FeatureScript queries evaluated
server-side. This is usually more robust than collecting raw ids.

Common selection options:

| Flag | Meaning |
| --- | --- |
| `--all` | every edge of every solid body |
| `--feature <featureId>` | edges created by one feature |
| `--circular` | circular or arc edges |
| `--query "<FeatureScript query>"` | custom server-side query |
| `--edges id1,id2` / `--faces id1,id2` | explicit deterministic ids |

Useful queries:

```text
qAllModifiableSolidBodies();
qCreatedBy(makeId("FID"), EntityType.FACE);
qCreatedBy(makeId("FID"), EntityType.EDGE);
```

Default plane ids are Front `JCC`, Top `JDC`, and Right `JEC`.

## Raw FeatureScript Escape Hatch

The high-level commands cover common CAD operations. For features that are not
wrapped yet, inspect Onshape's feature schemas and submit a raw feature envelope:

```bash
onshape-cli get-feature-specs --doc "$DOC" --ws "$WS" --elem "$ELEM" > specs.json
onshape-cli add-feature --doc "$DOC" --ws "$WS" --elem "$ELEM" --json-file feature.json
onshape-cli update-feature --doc "$DOC" --ws "$WS" --elem "$ELEM" --feature "$FID" --json-file feature.json
```

Raw feature JSON is a `BTFeatureDefinitionCall-1406` envelope wrapping a
`BTMFeature-134`. Feature Studio workflows use `create-feature-studio`,
`set-feature-studio`, `get-feature-studio-specs`, and then `add-feature` with
the returned namespace.

`eval-featurescript` decodes FeatureScript values by default. Use `--raw` if you
need the original BTFSValue tree.

## Validation and CAD Gotchas

- Lengths are inches; angles are degrees.
- `measure` is the fastest dimensional check. `shaded-view` or `get-thumbnail`
  is the fastest visual check.
- Feature-creation commands validate post-add feature state by default. Use
  `--no-validate` only when you intentionally need to defer validation.
- `ok:false` or `result.value: null` usually means a real API or FeatureScript
  error. Read `detail.message` and `detail.notices`.
- Patterns need real edge ids for `--direction-ids` or `--axis-ids`; use
  `get-edges`.
- Cross-document inserts and drawings reference versions, not mutable
  workspaces. Run `create-version` first.
- `export-stl` is the simplest reliable export for 3D printing. `export` handles
  STEP, IGES, 3MF, and Parasolid through Onshape translations.
- For Front-plane side profiles, sketch X maps to world X, sketch Y maps to
  world Z, and extrude depth maps to world Y. In `measure`, `bbox.z` is height
  and `bbox.y` is depth.
- Search before creating documents so reruns do not create duplicate
  `Name (1)` documents.
- To edit an existing model, target its existing `doc/ws/elem`; do not recreate
  it.

## Demos

- [demo/npm-candy-cane](demo/npm-candy-cane/) builds a candy cane with the
  published npm package using high-level commands, a Feature Studio appearance
  feature, and `validate-partstudio`.
- [demo/phone-holder](demo/phone-holder/) contains a generated phone-holder model
  workflow and captured render/measurement outputs.

These demos create real Onshape documents. They require valid credentials and may
leave public documents in your account.

## Development

Python layout:

- [onshape_cli/cli.py](onshape_cli/cli.py): Python command dispatcher.
- [onshape_cli/api/](onshape_cli/api/): REST managers for documents, part
  studios, exports, assemblies, drawings, metadata, variables, configurations,
  edges, and Feature Studios.
- [onshape_cli/builders/](onshape_cli/builders/): Feature JSON builders.
- [onshape_cli/credentials.py](onshape_cli/credentials.py): shared credential
  store implementation.

Node layout:

- [node/src/cli.ts](node/src/cli.ts): Node command dispatcher.
- [node/src/api/](node/src/api/): Node REST managers.
- [node/src/builders/](node/src/builders/): Node feature builders.
- [node/src/credentials.ts](node/src/credentials.ts): shared credential store
  implementation.

Shared specs live in [shared/](shared/). The agent-facing operating guide lives
in [skills/onshape-cad/SKILL.md](skills/onshape-cad/SKILL.md).

Useful checks:

```bash
python -m compileall onshape_cli
python scripts/smoke_test.py
python scripts/final_test.py <doc> <ws>
python scripts/test_new_areas.py
python scripts/test_round2.py
python scripts/test_assembly_mates.py
python scripts/test_images.py

cd node
npm run check
npm run build
```

The live test scripts create temporary public Onshape documents, exercise the
API, and delete them when possible.

## Status

The Python CLI is the original implementation. The Node CLI has been ported to
command parity for the documented command surface and is published as `onshape`
on npm. Both CLIs share credentials and the standard JSON envelope.

The project is beta-quality CAD automation: commands have been live-tested
against real Onshape documents, but CAD feature regeneration can still reject
valid-looking payloads. Treat `featureStatus`, `measure`, and rendered previews
as part of the normal workflow.

## License

[MIT](LICENSE) © 2026 William Ryan.

Not affiliated with or endorsed by Onshape / PTC. "Onshape" is a trademark of
its respective owner.
