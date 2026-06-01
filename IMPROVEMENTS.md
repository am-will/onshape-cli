# Onshape CLI — improvements identified (2026-05-31 monitor-stand run)

Concrete fixes/additions surfaced while recreating a monitor stand. Each is small
and independently testable. Apply in a clean session and verify by **importing the
module** (`python -c "import ...; assert hasattr(...)"`), not by reading tool stdout.

## 1. `search-documents` always returns 0  (BUG, high priority)
`DocumentManager.search_documents` hits `/api/v5/globaltreenodes/search`, which
returns no items for ordinary name queries.
**Fix:** query `/api/v6/documents` with `{"q": query, "limit": ...}` (add
`"filter": document_filter` only when truthy) and parse `response["items"]` the
same way `list_documents` does. Verified live that `?q=` returns matches.

## 2. `DocumentInfo` is too strict  (latent BUG)
`created_at` / `modified_at` are required `datetime` fields. The `/documents`
list endpoint nulls/omits fields per-document; one missing field raises and the
whole document is dropped (a `try/except … continue` then silently eats it).
**Fix:** make every field except `id` optional with defaults, and add
`extra = "ignore"` to the model Config. (Belt-and-suspenders: this also future-
proofs against new/renamed response fields.)
Also harden owner access: `(d.get("owner") or {}).get("id", "")` — `owner` can be
null.

## 3. Add a `measure` command  (ergonomics — biggest time-saver)
Checking a build's real dimensions currently means hand-writing an `evBox3d`
FeatureScript and decoding the BTFSValue tree by hand (error-prone; caused several
detours this run).
**Add** `PartStudioManager.measure(d,w,e)` returning clean JSON:
`{"bodies", "bbox": {"x","y","z","min","max"}, "volume_in3"}` in inches, with
`{"bodies": 0}` when empty. Wire a `measure` subcommand. FeatureScript used:
```
function(context is Context, queries){
  var bs = evaluateQuery(context, qAllModifiableSolidBodies());
  if (size(bs) == 0) { return { bodies: 0 }; }
  var b = evBox3d(context, { topology: qAllModifiableSolidBodies(), tight: true });
  var vol = 0; for (var x in bs) { vol += evVolume(context, { entities: x }); }
  return { bodies: size(bs),
    minx: b.minCorner[0]/inch, miny: b.minCorner[1]/inch, minz: b.minCorner[2]/inch,
    maxx: b.maxCorner[0]/inch, maxy: b.maxCorner[1]/inch, maxz: b.maxCorner[2]/inch,
    vol_in3: vol/(inch*inch*inch) };
}
```

## 4. Decode FeatureScript values by default
Add `api/fsvalue.py:decode_fs_value(v)` (maps->dict, arrays->list, scalars->value;
returns non-dicts unchanged). Have `eval-featurescript` return decoded JSON in
`result.value` by default, with `--raw` for the raw BTFSValue tree. Reuse it in
`measure`.

## 5. FeatureScript errors were silently swallowed → `null`  (BUG, fixed 2026-06-01)
`/featurescript` returns **HTTP 200** with `result: null` and the real reason in
`notices` (e.g. a SEMANTIC error). The CLI decoded `result` and emitted
`{"value": null}` (and `measure` reported `{"bodies": 0}`), hiding the cause.
Surfaced during the stand build: an inline measure script used `vol` as both a
local variable and a map key — FeatureScript rejects that
(*"Cannot use vol as map key … Use (vol) or 'vol' to disambiguate"*) — but all the
agent saw was `null`, which looked like a regen/timing flake. (Root cause was a
bug in the *caller's* script, not the tool; the tool's fault was hiding it. The
built-in `measure` script was always fine — its key is `vol_in3`, no collision.)
**Fix:** added `api/fsvalue.py:featurescript_messages(resp)` (parses `notices` →
`[{type, message}]`) and `FeatureScriptError`. `eval-featurescript` now raises it
when `result is null` with notices (clear `ok:false` + `detail.notices`, exit 1)
and attaches non-fatal notices as `warnings`; `measure` raises instead of
reporting 0 bodies. Verified live: a `vol`-as-key script now returns the exact
error message; valid evals and `measure` unaffected.
**Lesson:** a `null` result from `eval-featurescript`/`measure` almost always
means a FeatureScript error — read `detail.notices` for the message.

## 6. Things that are NOT bugs (don't "fix" them)
- **`list-documents`** works; a transient `0` right after `/login` was auth
  propagation, not a code defect.
- **`extrude --op ADD/REMOVE`** works (re-tested NEW->ADD->REMOVE clean). An
  earlier spurious `-1.0in` extent came from corrupted inline `--entities` shell
  input, not the builder.

## Workflow lessons (worth surfacing in SKILL.md)
- Build a part as **one closed-line profile sketch + one `extrude --op NEW`**
  rather than chaining ADD/REMOVE — fewer features, fewer surprises.
- When scripting, **drive the API in a single process** and capture
  `result.id` / `defaultWorkspace.id` once; threading IDs through many separate
  shell calls is fragile.
- **Search before create** (`search-documents`/`list-documents`) so re-runs don't
  spawn `Name (1)`, `Name (1) (1)` duplicates.
- To **edit** an existing model, target its `--doc/--ws/--elem` directly; never
  recreate it (that's how you avoid overwriting/duplicating the original).
