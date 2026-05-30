# onshape-cli

Command-line automation for [Onshape](https://www.onshape.com) CAD. Build and
inspect parametric models — sketches, extrudes, holes, fillets, chamfers, shells,
booleans, mirrors, patterns — query geometry, read mass properties, and export
**STL / STEP / 3MF** straight from your terminal or an AI agent.

It talks directly to the Onshape REST API over HTTP Basic auth and emits JSON, so
it scripts cleanly and is friendly to coding agents (it ships with an
[agent skill](skills/onshape-cad/SKILL.md)).

## Why

The fastest way to generate or modify Onshape geometry programmatically without
writing FeatureScript by hand or clicking through the UI — ideal for parametric
parts, batch edits, and AI-driven CAD (e.g. "make a 7-inch monitor stand and
export an STL").

## Install

```bash
git clone https://github.com/am-will/onshape-cli
cd onshape-cli
python -m venv venv && source venv/bin/activate
pip install -e .
```

Requires Python ≥ 3.10. Dependencies: `httpx`, `pydantic`, `loguru`.

## Authenticate

Create an API key pair at https://dev.onshape.com → **API keys**, then:

```bash
export ONSHAPE_ACCESS_KEY=...   ONSHAPE_SECRET_KEY=...
```

(You can also pass `--access-key`/`--secret-key`, or keep them in the `onshape`
block of `~/.claude/mcp.json`.)

## Quickstart

```bash
# find a document and part studio
onshape-cli list-documents --limit 5
onshape-cli get-document-summary --doc <documentId>

# target a part studio once
export ONSHAPE_DOC=... ONSHAPE_WS=... ONSHAPE_ELEM=...

# build: sketch -> extrude -> fillet -> export
SK=$(onshape-cli sketch-rectangle --plane Top --corner1 0,0 --corner2 3,2 | jq -r .result.featureId)
EX=$(onshape-cli extrude --sketch "$SK" --depth 0.25 | jq -r .result.featureId)
onshape-cli fillet --feature "$EX" --radius 0.1
onshape-cli export-stl --out bracket.stl
```

Every command prints `{"ok": true, "result": ...}` or
`{"ok": false, "error": ..., "detail": ...}`.

## Selecting geometry

Edges/faces are chosen with a **FeatureScript query**, evaluated server-side — you
rarely need raw IDs. `fillet`, `chamfer`, `shell`, `boolean`, `mirror`, and the
patterns all accept:

| flag | selects |
|---|---|
| `--all` | every edge of every solid body |
| `--feature FID` | every edge created by that feature |
| `--circular` | every circular/arc edge |
| `--query "<FeatureScript>"` | any custom query |
| `--edges id1,id2` | explicit deterministic IDs |

## Commands (71)

Documents & versioning: `create-document`, `delete-document`, `update-document`,
`list-documents`, `search-documents`, `get-document`, `get-document-summary`,
`get-elements`, `find-part-studios`, `get-parts`, `get-features`,
`get-feature-specs`, `get-sketch-info`, `get-body-details`, `get-assembly`,
`get-workspaces`, `list-versions`, `create-version`, `get-variables`,
`set-variable`.
Sketching: `sketch-rectangle`, `sketch-circle`, `sketch-line`, `create-sketch`.
Solids: `extrude`, `hole`, `thicken`, `revolve`, `draft`.
Edges/faces: `fillet`, `chamfer`, `shell`.
Multi-body/patterns: `boolean`, `mirror`, `linear-pattern`, `circular-pattern`,
`offset-plane`.
Raw feature access: `add-feature`, `update-feature`, `rollback`.
Assemblies: `create-assembly`, `insert-instance`, `get-assembly-features`,
`assembly-mate-connector`, `assembly-mate`, `assembly-group`,
`assembly-add-feature`, `get-bom`, `assembly-mass-properties`,
`transform-instance`, `delete-instance`.
Configurations: `get-configuration`, `encode-configuration`.
Drawings: `create-drawing`, `get-drawing-views`, `export-drawing`.
Feature Studios: `create-feature-studio`, `get-feature-studio`,
`set-feature-studio`.
Metadata: `get-metadata`, `set-metadata`.
Geometry/export: `get-edges`, `find-circular-edges`, `find-edges-by-feature`,
`mass-properties`, `export-stl`, `export`.
Management: `create-part-studio`, `delete-feature`, `delete-element`,
`eval-featurescript`.

> Free Onshape accounts can only create **public** documents (`create-document --public`;
> private → HTTP 409). Cross-document inserts and drawings reference geometry by
> **version**, so run `create-version` first.

Full reference, examples, and gotchas: [skills/onshape-cad/SKILL.md](skills/onshape-cad/SKILL.md).

## Status

**Verified working (live-tested against a real Onshape account):** sketches,
extrude/hole/thicken/draft, fillet, chamfer, shell, boolean (union), mirror,
linear/circular patterns, get-edges, find-edges-by-feature, mass-properties,
export-stl, export STEP, all discovery, variables, create/delete part studio,
delete/add/update feature, get-feature-specs, get-sketch-info, rollback,
document versioning (update/versions), configurations (get/encode), assemblies
(create, insert, mate connectors, mates, groups, BOM, mass-properties, transform,
delete instance), drawings (create/views), feature studios, and metadata get/set.

**Notes:** patterns need a real edge for `--direction-ids`/`--axis-ids` (from
`get-edges`). `revolve` and `offset-plane` are experimental — their payloads are
spec-shaped but may still be rejected on regen; check the returned
`featureStatus`. **Free Onshape accounts can only create *public* documents** —
pass `--public` (a private document returns **HTTP 409**); paid accounts can
create private docs too. Cross-document inserts and drawings reference geometry by
**version** — run `create-version` first.

## Development

```bash
python scripts/final_test.py        <doc> <ws>          # live end-to-end feature checks
python scripts/introspect2.py       <doc> <ws> <elem>   # dump Onshape feature specs
python scripts/test_new_areas.py    # versioning, feature-specs, configs, drawings, metadata
python scripts/test_round2.py       # rollback, metadata write, transform/delete instance
python scripts/test_assembly_mates.py   # insert, mate connectors, mates, groups
```

The `test_*` scripts create a temporary **public** document, exercise the
commands live, and delete it.

Layout: `onshape_cli/cli.py` (dispatcher), `onshape_cli/builders/` (feature JSON
builders), `onshape_cli/api/` (REST client + managers).

## License

[MIT](LICENSE) © 2026 William Ryan.

---

*Not affiliated with or endorsed by Onshape / PTC. "Onshape" is a trademark of
its respective owner.*
