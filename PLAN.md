# Plan: cross-platform `login` + key storage, and a parallel Node CLI

## Context

`onshape-cli` is a Python CLI (~4.4k LOC; deps `httpx`/`pydantic`/`loguru`, no native
deps) that wraps the Onshape REST API over HTTP Basic auth and prints a uniform JSON
contract (`{"ok":true,"result":…}` / `{"ok":false,"error":…,"detail":…}`). A `config`
subcommand to save credentials was just added (commit `de39ef5`).

The user wants two things:
1. A friendly, **cross-platform** (macOS/Windows/Linux) way to save the Onshape API
   key + secret — a `login` flow that auto-imports keys it can already find, otherwise
   guides the user through creating + pasting them, and stores them securely.
2. **Keep the Python CLI and add a parallel Node.js CLI** (`npx onshape`) so users can
   choose. The two must share the same credential store (a key saved by one works in the
   other) and the same command/JSON contract.

Onshape API keys can't be auto-issued (the secret is shown once in the browser at
creation), so `login` is "auto-import or guided-paste," not OAuth.

## Decisions (baked into this plan)

- **Storage:** OS keychain when available, `0600` file fallback. macOS Keychain /
  Windows Credential Manager / Linux Secret Service. **Default to keychain on Windows**
  (a plaintext file there isn't ACL-protected; `chmod 0600` is a no-op on Windows).
- **Keychain libs:** Python `keyring` (optional extra, lazy import); Node
  `@napi-rs/keyring` (optional dep, prebuilt binaries — *not* the deprecated `keytar`).
  Both degrade to the file backend if the keychain/D-Bus is missing (headless/CI).
- **Node language:** TypeScript compiled to CommonJS in `node/dist/` (published);
  authored types catch JSON-envelope drift, end users never see TS.
- **Command names (no collision):** Python stays `onshape-cli` (PyPI); Node publishes as
  `onshape` (npm) → `npx onshape` / `npm i -g onshape`. The `onshape-cad` skill invokes
  `onshape-cli` literally and is unaffected.
- **Single source of truth** for the fragile constants both CLIs must reproduce
  identically: `shared/constants.json` + `shared/credentials-spec.json` + golden
  request fixtures in `shared/test-vectors/`.

## Shared credential spec (both CLIs implement identically)

- **Keychain item:** service `onshape-cli`, account = base-url host (e.g.
  `cad.onshape.com`); value = JSON `{access_key, secret_key, base_url}`.
- **Pointer/fallback file:** `~/.onshape/credentials.json` (override `ONSHAPE_CONFIG`;
  on Linux also *read* `$XDG_CONFIG_HOME/onshape/credentials.json`). Adds a `backend`
  field: `"keychain"` → secret omitted, looked up in keychain; `"file"` → creds inline.
- **Resolution order:** flags → `ONSHAPE_ACCESS_KEY`/`SECRET_KEY` env → pointer file
  (keychain or inline per `backend`) → (Linux) XDG file → `~/.claude/mcp.json`. `base_url`:
  `ONSHAPE_BASE_URL` env → pointer `base_url` → `https://cad.onshape.com`.

## Phase 1 — Python credential layer + lock the shared spec (ship first)

- **Subtask 1: shared specs.** Add `shared/credentials-spec.json` and
  `shared/constants.json` before changing behavior, so Python and Node have a stable
  contract to target.
- **Subtask 2: Python credential store.** New `onshape_cli/credentials.py`: a
  `CredentialStore` with `resolve()`, `save(creds, store)`, `clear()`, `describe()`;
  lazy optional `keyring`; the spec above; compatibility with existing inline
  `~/.onshape/credentials.json` files.
- **Subtask 3: Python CLI integration.** Add `login` and `logout`; route
  `config set/show/path/clear` through `CredentialStore`; add
  `--store file|keychain|auto`; make `load_credentials` delegate to the store
  while preserving exit-code-2 behavior and the existing JSON envelope.
  - `login`: auto-import from env / `~/.claude/mcp.json` with a redacted confirm prompt;
    else `webbrowser.open("https://dev.onshape.com/keys")`, read access key (visible) +
    secret (`getpass`), verify via `GET /api/v6/documents?limit=1`, save. Flags
    `--no-browser`, `--no-verify`, `--access-key/--secret-key/--base-url`. Non-TTY/SSH:
    no prompt/browser — emit a clear error unless keys passed as flags.
- **Subtask 4: packaging and docs.** `pyproject.toml`
  `[project.optional-dependencies] keychain = ["keyring>=24"]`; README documents
  `login`/`logout`, `config` compatibility, keychain/file backends, and the exact
  resolution order.
- **README:** document `login`/`logout` and the storage model.
- Independent of the port; shippable on its own.

## Phase 2 — Node scaffold + interoperable credentials + client + a few read commands

- `node/` package (`package.json` name `onshape`, bin `onshape`, `engines node>=18`,
  `open` dep, `@napi-rs/keyring` optional), `tsconfig.json`, `bin/onshape.js` shebang.
- `src/credentials.ts` implementing the **same** spec (interop test: `onshape-cli login`
  then `npx onshape get-document`, and the reverse).
- `src/api/client.ts`: Basic auth + identical `Accept`/`Content-Type` headers + the
  **manual 307-redirect-with-auth-reattach** loop (export.py is the reference).
- Implement `list-documents`, `get-document`, `get-features`, `mass-properties` to prove
  byte-identical JSON `result` and exit codes 0/1/2.

## Phase 3 — Port the remaining ~74 commands (module-by-module, contract-preserving)

Order: `api/documents` → `partstudio` (plane IDs, FeatureScript eval, `measure`,
`notices`→error) → `edges` → `export` (STL 307, translation poll, base64 shaded view) →
`assemblies` → `configurations`/`drawings`/`metadata`/`featurestudio`/`variables`; then
`builders/sketch` → `extrude` → `thicken` → `advanced`. Validate geometry by `measure`
and `shaded-view`, comparing Python vs Node on the same inputs against the golden fixtures.

## Phase 4 — Docs + CI + publish

- README dual-install; CI matrix (macOS/Win/Linux × Py3.10+ / Node 18-22) running the
  shared test-vector parity suite, a command-surface manifest check (fail if the two
  CLIs' command/flag sets diverge), and a headless-Linux file-fallback test.
- Publish — **requires your own logins**: `npm login` for npm, a PyPI token for
  `uv publish`/`twine`. Prepare everything and pause for you to run/authorize these.

## Verification

- **Python (Phase 1):** unit/behavior checks on `CredentialStore` resolution order
  (incl. mcp.json), `login`/`logout`/`config` round-trips in both file and keychain
  modes (macOS), redaction, non-TTY guard. Confirm every existing command still emits
  identical JSON (run a few `--help`/read commands). Manual: `onshape-cli login` end-to-end.
- **Node (Phase 2+):** parity suite asserting byte-identical `result` vs Python on the
  same document for the ported commands; credential interop across both CLIs; the 307,
  FeatureScript-200-`notices`, plane-ID, and inch↔meter cases covered by fixtures.

## Sequencing / where to pause

Implement **Phase 1 first** (the immediate, self-contained win), then **Phase 2**
(Node scaffold + credential parity + a few commands). Check in before the large
**Phase 3** full port and before any **Phase 4** publish (which needs npm/PyPI login).

## Highest risks (mitigations above)

307 auth-strip in Node → silent 403 (manual reattach + fixture); two CLIs drifting on BTM
envelopes/units/plane IDs (shared constants + golden fixtures + surface manifest in CI);
Windows plaintext secret (keychain default + warn on fallback); FeatureScript 200-with-
`notices` mis-ported as success (port `fsvalue` semantics + fixture); keychain absent on
headless/CI (lazy import, try/catch, file fallback).

## Acceptance checklist

- Existing Python commands still parse and still fail missing credentials with exit code
  2 and the standard JSON error envelope.
- `config set/show/path/clear` remains backward-compatible for existing users.
- `login` works with pasted keys, can skip browser/verification, and refuses non-TTY
  prompting unless keys are supplied by flags or env.
- File backend writes `0600` where supported and includes `backend: "file"`.
- Keychain backend writes a pointer file without `secret_key`; absent keychain falls
  back to the file backend in `auto` mode.
- `shared/credentials-spec.json` is specific enough for the Node implementation to
  match Python without reading Python source.

## Implementation log

- 2026-06-01: Reviewed the plan against the current repo. Improvement needed: break
  Phase 1 into independently committable slices and add acceptance criteria before
  implementation.
- 2026-06-01: Added shared credential and constants specs for Phase 1. Verified both
  files parse as JSON.
- 2026-06-01: Added standalone Python `CredentialStore` with file/keychain/auto
  storage, legacy file compatibility, MCP fallback, redaction, and owner-only file
  permissions. Verified file round-trip, clear, missing-credential failure, and MCP
  fallback in a temporary home.
- 2026-06-01: Wired Python CLI credential resolution through `CredentialStore` and
  added `login`/`logout`. Verified config file round-trip, non-TTY login guard,
  explicit-key login, auto fallback to file when `keyring` is absent, explicit
  keychain failure as JSON exit 2, and missing-credential JSON exit 2.
- 2026-06-01: Updated packaging/docs for the Python credential flow. Verified editable
  install metadata, CLI help, shared JSON specs, Python compile, config round-trip,
  logout, explicit-key login, and missing-credential exit 2.
