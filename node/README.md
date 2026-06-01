# onshape (Node CLI)

Command-line automation for [Onshape](https://www.onshape.com) CAD, as an npm package.
Build and inspect parametric models — sketches, extrudes, holes, fillets, chamfers,
shells, booleans, mirrors, patterns — query geometry, read mass properties, drive
assemblies and drawings, and export **STL / STEP / 3MF** straight from your terminal.

This is a Node/TypeScript port of [`onshape-cli`](https://github.com/am-will/onshape-cli)
with **full command parity**: the same command names, the same flags, and the same JSON
contract. It talks directly to the Onshape REST API over HTTP Basic auth and emits JSON.

## Install

```bash
npm install -g onshape      # global `onshape` command
# or
npx onshape <command>       # run without installing
```

Requires Node ≥ 18. The optional `@napi-rs/keyring` dependency enables OS-keychain
credential storage; without it credentials fall back to a `0600` file.

## Authenticate

Create an API key pair at https://dev.onshape.com → **API keys**, then save it once:

```bash
onshape login                 # import from env / ~/.claude/mcp.json, or prompt, then save
onshape config show           # show saved credentials (secret redacted)
onshape logout                # delete saved credentials
```

Credentials resolve in this order: `--access-key`/`--secret-key` flags →
`ONSHAPE_ACCESS_KEY`/`ONSHAPE_SECRET_KEY` env vars → `~/.onshape/credentials.json`
(or `ONSHAPE_CONFIG`) → Linux `$XDG_CONFIG_HOME/onshape/credentials.json` → the
`onshape` block of `~/.claude/mcp.json`. `ONSHAPE_BASE_URL`/`--base-url` overrides the
API base URL.

## Quickstart

```bash
# find a document and part studio
onshape list-documents --limit 5
onshape get-document-summary --doc <documentId>

# target a part studio once
export ONSHAPE_DOC=... ONSHAPE_WS=... ONSHAPE_ELEM=...

# build: sketch -> extrude -> fillet -> export
SK=$(onshape sketch-rectangle --plane Top --corner1 0,0 --corner2 3,2 | jq -r .result.featureId)
EX=$(onshape extrude --sketch "$SK" --depth 0.25 | jq -r .result.featureId)
onshape fillet --feature "$EX" --radius 0.1
onshape export-stl --out bracket.stl
```

Every command prints `{"ok": true, "result": ...}` or
`{"ok": false, "error": ..., "detail": ...}`.

## Selecting geometry

Edges/faces are chosen with a **FeatureScript query**, evaluated server-side. `fillet`,
`chamfer`, `shell`, `boolean`, `mirror`, and the patterns all accept:

| flag | selects |
|---|---|
| `--all` | every edge of every solid body |
| `--feature FID` | every edge created by that feature |
| `--circular` | every circular/arc edge |
| `--query "<FeatureScript>"` | any custom query |
| `--edges id1,id2` | explicit deterministic IDs |

Patterns need a real edge for `--direction-ids`/`--axis-ids` (from `get-edges`).

## Commands

Run `onshape --help` for the grouped list. Categories:

- **Documents & discovery:** `list-documents`, `search-documents`, `get-document`,
  `get-document-summary`, `create-document`, `delete-document`, `update-document`,
  `get-elements`, `find-part-studios`, `get-workspaces`, `list-versions`,
  `create-version`, `get-parts`, `get-features`, `get-feature-specs`,
  `get-sketch-info`, `get-body-details`, `get-assembly`
- **Part studio management:** `create-part-studio`, `delete-feature`, `delete-element`,
  `add-feature`, `update-feature`, `rollback`, `validate-partstudio`
- **Sketching:** `create-sketch`, `sketch-rectangle`, `sketch-circle`, `sketch-line`,
  `sketch-circle-axis`, `sketch-candy-cane-path`
- **Solids & modifiers:** `extrude`, `hole`, `thicken`, `revolve`, `sweep`, `draft`,
  `fillet`, `chamfer`, `shell`
- **Patterns & boolean:** `boolean`, `boolean-union`, `mirror`, `linear-pattern`,
  `circular-pattern`, `offset-plane`
- **Geometry / measure:** `get-edges`, `find-circular-edges`, `find-edges-by-feature`,
  `measure`, `eval-featurescript`, `mass-properties`
- **Variables & configurations:** `get-variables`, `set-variable`, `get-configuration`,
  `encode-configuration`
- **Export & images:** `export-stl`, `export`, `thumbnail-info`, `get-thumbnail`,
  `shaded-view`
- **Assemblies:** `create-assembly`, `insert-instance`, `get-assembly-features`,
  `assembly-add-feature`, `assembly-mate-connector`, `assembly-mate`, `assembly-group`,
  `get-bom`, `assembly-mass-properties`, `delete-instance`, `transform-instance`
- **Drawings:** `create-drawing`, `get-drawing-views`, `export-drawing`
- **Feature studios:** `create-feature-studio`, `get-feature-studio`,
  `set-feature-studio`, `get-feature-studio-specs`
- **Metadata:** `get-metadata`, `set-metadata`

> Sketch/feature dimensions are in **inches**. Free Onshape accounts can only create
> **public** documents (`create-document --public`; private → HTTP 409). Cross-document
> inserts and drawings reference geometry by **version**, so run `create-version` first.
> `revolve`/`offset-plane` payloads are spec-shaped but can regen-reject — check the
> returned `featureStatus`.

## License

[MIT](../LICENSE) © 2026 William Ryan.

*Not affiliated with or endorsed by Onshape / PTC.*
