---
name: onshape-cad
description: Drive Onshape CAD from the command line via the onshape-cli tool — inspect documents and part studios; build sketches, extrudes, holes, revolves; apply fillets, chamfers, shells; do booleans, mirrors, and linear/circular patterns; query edges; read mass properties; and export STL/STEP/3MF. Use whenever the user wants to build, modify, inspect, or export parametric CAD in Onshape, mentions Onshape or a cad.onshape.com URL, asks for fillets/chamfers/extrudes on a part, or wants to generate a model for 3D printing.
---

# Onshape CAD CLI

`onshape-cli` is a self-contained command-line tool that talks to the Onshape
REST API. This skill teaches any coding agent how to use it.

---

## 1. How to run it  ⚠️ READ THIS

After `pip install -e .` (or `pip install onshape-cli`) the command is
`onshape-cli`. Without installing, run it as a module from the repo root:
`python -m onshape_cli.cli`.

**Each agent Bash call is a fresh non-interactive shell — `alias` and shell
functions do NOT persist or even expand. Do not rely on an alias; type the full
command every time** (e.g. `python -m onshape_cli.cli ...`, or set
`PY="python -m onshape_cli.cli"` and use `$PY` *within the same Bash call*).
Examples below abbreviate the command as `onshape-cli`.

### Credentials (automatic)
Get an API key pair at https://dev.onshape.com → API keys. Resolved in order:
`--access-key`/`--secret-key` → `ONSHAPE_ACCESS_KEY`/`ONSHAPE_SECRET_KEY` env →
the `onshape` block in `~/.claude/mcp.json` (if present).

### Targeting
Most commands take `--doc <documentId> --ws <workspaceId> --elem <elementId>`.
`ONSHAPE_DOC`/`ONSHAPE_WS`/`ONSHAPE_ELEM` set defaults, but env does NOT persist
across separate Bash calls — re-export each call or pass flags explicitly.
Get IDs from `list-documents` → `find-part-studios`, or a cad.onshape.com URL
(`.../documents/{doc}/w/{workspace}/e/{element}`).

### Output
JSON on stdout: `{"ok": true, "result": ...}` or
`{"ok": false, "error": ..., "detail": ...}` (read `detail.message`). Creation
commands return ids in `result`; capture and reuse them.

---

## 2. Selecting edges/faces (the key idea)

Geometry is chosen with a **FeatureScript query**, evaluated server-side — you
rarely need raw IDs. fillet/chamfer/shell/boolean/mirror/patterns share:
`--all`, `--feature <featureId>`, `--circular`, `--query "<FeatureScript>"`,
`--edges id1,id2` / `--faces id1,id2`.
Common: all bodies `query = qAllModifiableSolidBodies();`; faces of a feature
`query = qCreatedBy(makeId("FID"), EntityType.FACE);`.
Plane IDs: **Front = JCC, Top = JDC, Right = JEC**.

---

## 3. Commands (74)

### Documents, discovery & versioning
- `list-documents [--limit N] [--filter all|owned|created|shared]`
- `search-documents <query>`, `get-document --doc D`,
  `get-document-summary --doc D`
- `get-elements --doc D --ws W [--type PARTSTUDIO]`,
  `find-part-studios --doc D --ws W [--name PAT]`
- `get-parts`, `get-features [--configuration C]`, `get-body-details`, `get-assembly`
- `get-feature-specs` — authoritative parameter schemas for every feature (use before raw `add-feature`)
- `get-sketch-info [--sketch SID]`
- `get-variables`, `set-variable --name x --expression "1 in"`
- `create-document --name "X" --public`, `delete-document --doc D`
  — new/delete a document. ⚠️ **Free Onshape accounts can only create PUBLIC
  documents — always pass `--public`; a private document returns HTTP 409.**
  `create-document` returns `result.id` and `result.defaultWorkspace.id`.
- `update-document --doc D [--name N] [--description X]`
- `get-workspaces --doc D`, `list-versions --doc D`
- `create-version --doc D --ws W --name v1` — make a version before cross-document inserts & drawings

### Part studio management
`create-part-studio --name "X"` (returns `result.response.id`),
`delete-feature --feature FID`, `delete-element`,
`eval-featurescript --script '<FS>'`.

### Raw feature access (power tools)
When a built-in command doesn't cover a feature, discover its params with
`get-feature-specs`, then POST the feature JSON directly. The envelope is a
`BTFeatureDefinitionCall-1406` wrapping a `BTMFeature-134`; geometry is selected
with FeatureScript queries.
- `add-feature (--json '<envelope>' | --json-file FILE)`
- `update-feature --feature FID (--json ... | --json-file FILE)`
- `rollback --index N` (`-1` = end of feature list)

### Sketching (inches)
`sketch-rectangle --plane Top --corner1 0,0 --corner2 2,1`,
`sketch-circle --plane Front --center 0,0 --radius 0.5`,
`sketch-line --start 0,0 --end 1,0`,
`create-sketch --plane Front --entities '<JSON: line|circle|rectangle>'`.

### Solids
`extrude --sketch FID --depth 0.5 [--op NEW|ADD|REMOVE|INTERSECT]`,
`hole --sketch FID --depth 1`, `thicken --sketch FID --thickness 0.1`,
`revolve --sketch FID --axis-ids EDGEID` (experimental).

### Edge/face treatments
`fillet --all --radius 0.06` (also `--feature`/`--circular`/`--query`/`--edges`),
`chamfer --all --width 0.08`, `shell --thickness 0.06 --query '<faces>'`.

### Multi-body & patterns
`boolean --op UNION|SUBTRACTION|INTERSECTION --tools '<query>'`,
`mirror --entities '<query>' --plane-ids JEC`,
`linear-pattern --entities '<query>' --direction-ids EDGEID --distance 1 --count 3`,
`circular-pattern --entities '<query>' --axis-ids EDGEID --count 6`,
`offset-plane --base-ids JCC --offset 1.0`.

### Images (PNG output)
`thumbnail-info --elem E` (lists rendered sizes + hrefs),
`get-thumbnail --elem E --out preview.png [--size 600x340|300x300|70x40]`
(downloads the rendered thumbnail; Onshape renders them async, so a brand-new
element may briefly have none — retry shortly),
`shaded-view --elem E --out render.png [--kind partstudios|assemblies] [--width 600] [--height 340] [--view-matrix "<12 floats>"] [--no-edges] [--configuration C]`
(server-rendered isometric shaded image — great for an agent to *see* what it built).

### Geometry / export
`get-edges`, `find-circular-edges [--radius R]`, `find-edges-by-feature --feature FID`,
`mass-properties`, `export-stl --out part.stl [--resolution coarse|medium|fine]`,
`export --out part.step --format STEP` (also IGES/3MF/PARASOLID).

---

## 4. Worked example — existing document → part → STL

```bash
# Create a new public document (free accounts must use --public), or use an
# existing one (list-documents). Returns result.id + result.defaultWorkspace.id.
onshape-cli create-document --name "Part" --public   # -> DOC + WS
DOC=...; WS=...
ELEM=$(onshape-cli create-part-studio --doc $DOC --ws $WS --name "Part" | jq -r .result.response.id)

SK=$(onshape-cli sketch-rectangle --doc $DOC --ws $WS --elem $ELEM --plane Top --corner1 0,0 --corner2 3,2 | jq -r .result.featureId)
EX=$(onshape-cli extrude --doc $DOC --ws $WS --elem $ELEM --sketch $SK --depth 0.25 | jq -r .result.featureId)
onshape-cli fillet --doc $DOC --ws $WS --elem $ELEM --feature $EX --radius 0.1
onshape-cli export-stl --doc $DOC --ws $WS --elem $ELEM --out part.stl
```

---

## 5. Status

**Verified working:** create/delete part studio, sketch, extrude, hole, thicken,
fillet (`--all`/`--feature`/`--circular`), chamfer, shell (with a face query),
boolean (union), mirror, linear-pattern, circular-pattern, get-edges,
find-edges-by-feature, mass-properties, export-stl, export STEP, all discovery,
variables, delete-feature, delete-element.

**Documents (free-account note):** `create-document`/`delete-document` are
verified working **with `--public`**. On a free Onshape account a *private*
document (the default) returns HTTP 409 — always pass `--public`. Paid accounts
can create private docs too.

**Patterns need a real edge** for `--direction-ids`/`--axis-ids` (from
`get-edges`); a construction-line query won't resolve.

**Experimental:** `revolve`, `offset-plane` — may be rejected on regen; check the
returned `featureStatus` or use the Onshape UI.

---

## 6. Gotchas
- Prefer query-based selection over fetching IDs; fetch IDs only for pattern
  direction/axis.
- Don't chamfer/shell **all** edges of an already-filleted body.
- `shell` needs ≥1 face to remove.
- `export-stl` is fast/synchronous (best for printing); `export` uses the async
  translation API for STEP/3MF/IGES/PARASOLID.
- Lengths are inches, angles degrees.

## 7. Source & extending
`onshape_cli/cli.py` (dispatcher), `onshape_cli/builders/advanced.py` (feature
builders + helpers `feature_call`/`p_query`/`p_quantity`/`p_enum`/`p_bool`),
`onshape_cli/api/`. Confirm a feature's parameters from the authoritative
`featurespecs` endpoint (`scripts/introspect2.py` dumps them), add a `build_*` and
a subcommand, then verify with `scripts/final_test.py <doc> <ws>`.
