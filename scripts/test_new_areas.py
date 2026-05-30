"""Live integration test for the new Onshape CLI commands.

Creates one public test document, builds geometry, exercises every new command,
then deletes the document. Prints PASS/FAIL per command.
"""
import json
import subprocess
import sys

PY = "./venv/bin/python"
BASE = [PY, "-m", "onshape_mcp.cli"]
results = []


def run(args, expect_ok=True, label=None):
    label = label or args[0]
    proc = subprocess.run(BASE + args, capture_output=True, text=True)
    out = proc.stdout.strip()
    try:
        data = json.loads(out)
    except Exception:
        data = {"ok": False, "error": "non-json", "raw": out[:300], "stderr": proc.stderr[:300]}
    ok = data.get("ok") is True
    status = "PASS" if ok == expect_ok else "FAIL"
    detail = ""
    if not ok:
        detail = str(data.get("error", ""))[:120] + " | " + str(data.get("detail", ""))[:160]
    results.append((status, label, detail))
    print(f"[{status}] {label}  {detail}")
    return data.get("result", data)


print("=== create test document (public) ===")
doc = run(["create-document", "--name", "CLI-DEEP-TEST", "--public"], label="create-document")
did = doc["id"]
wid = doc["defaultWorkspace"]["id"]
print(f"  doc={did} ws={wid}")

# find the default part studio
els = run(["get-elements", "--doc", did, "--ws", wid], label="get-elements")
def _etype(e):
    return (e.get("element_type") or e.get("elementType") or e.get("type") or "").upper()
ps_eid = next(e["id"] for e in els if _etype(e).startswith("PART"))
print(f"  partstudio={ps_eid}")

D = ["--doc", did, "--ws", wid]
E = D + ["--elem", ps_eid]

print("\n=== build geometry (rect + extrude) ===")
sk = run(["sketch-rectangle", *E, "--name", "Base", "--plane", "Top",
          "--corner1", "0,0", "--corner2", "2,1"], label="sketch-rectangle")
sk_fid = sk["featureId"]
ext = run(["extrude", *E, "--name", "Block", "--sketch", sk_fid, "--depth", "0.5"], label="extrude")

print("\n=== feature-access power tools ===")
specs = run(["get-feature-specs", *E], label="get-feature-specs")
print(f"  feature spec count: {len(specs.get('featureSpecs', specs)) if isinstance(specs, dict) else 'n/a'}")
run(["get-sketch-info", *E], label="get-sketch-info")

# raw add-feature: add a fillet via raw JSON envelope
fillet_json = json.dumps({
    "btType": "BTFeatureDefinitionCall-1406",
    "feature": {
        "btType": "BTMFeature-134", "featureType": "fillet", "name": "RawFillet",
        "suppressed": False, "namespace": "",
        "parameters": [
            {"btType": "BTMParameterQueryList-148", "parameterId": "entities",
             "queries": [{"btType": "BTMIndividualQuery-138", "deterministicIds": [],
                          "queryString": "query = qOwnedByBody(qAllModifiableSolidBodies(), EntityType.EDGE);"}]},
            {"btType": "BTMParameterQuantity-147", "parameterId": "radius",
             "expression": "0.05 in", "value": 0.05, "units": ""},
            {"btType": "BTMParameterEnum-145", "parameterId": "filletType",
             "enumName": "FilletType", "value": "EDGE", "namespace": ""},
        ],
    },
})
raw = run(["add-feature", *E, "--json", fillet_json], label="add-feature (raw fillet)")
raw_fid = raw.get("featureId")
print(f"  raw fillet featureId={raw_fid}")

# draft
run(["draft", *E, "--name", "Draft",
     "--neutral", 'query = qCreatedBy(makeId("Top"), EntityType.FACE);',
     "--faces", "query = qNothing();"], expect_ok=False, label="draft (expect maybe fail-empty)")

print("\n=== configurations ===")
run(["get-configuration", *E], label="get-configuration")
run(["encode-configuration", *E, "--params", "[]"], label="encode-configuration (empty)")

print("\n=== mass-properties (with config flag noop) ===")
run(["mass-properties", *E], label="mass-properties")

print("\n=== document versioning ===")
run(["update-document", "--doc", did, "--description", "deep test doc"], label="update-document")
run(["get-workspaces", "--doc", did], label="get-workspaces")
ver = run(["create-version", *D, "--name", "v1"], label="create-version")
vid = ver.get("id")
print(f"  version={vid}")
run(["list-versions", "--doc", did], label="list-versions")

print("\n=== metadata ===")
run(["get-metadata", *E], label="get-metadata (element)")

print("\n=== feature studio ===")
fs = run(["create-feature-studio", *D, "--name", "MyFS"], label="create-feature-studio")
fs_eid = fs.get("id") or fs.get("elementId")
print(f"  featurestudio={fs_eid}")
if fs_eid:
    run(["set-feature-studio", *D, "--elem", fs_eid,
         "--contents", "FeatureScript 2278;\nimport(path : \"onshape/std/geometry.fs\", version : \"2278.0\");\n"],
        label="set-feature-studio")
    run(["get-feature-studio", *D, "--elem", fs_eid], label="get-feature-studio")

print("\n=== assemblies ===")
asmd = run(["create-assembly", *D, "--name", "MyAssembly"], label="create-assembly")
asm_eid = asmd.get("id") or asmd.get("elementId")
print(f"  assembly={asm_eid}")
if asm_eid:
    A = D + ["--elem", asm_eid]
    # find a part id in the part studio
    parts = run(["get-parts", *E], label="get-parts")
    pid = parts[0]["partId"] if parts and isinstance(parts, list) else None
    print(f"  partId={pid}")
    # insert the whole part studio (same-document insert; no version needed in workspace)
    run(["insert-instance", *A, "--src-elem", ps_eid, "--whole-studio"],
        label="insert-instance (whole studio)")
    run(["get-assembly", *A], label="get-assembly (was broken)")
    run(["get-assembly-features", *A], label="get-assembly-features")
    run(["assembly-mass-properties", *A], label="assembly-mass-properties")
    run(["get-bom", *A], label="get-bom")

print("\n=== drawings (experimental) ===")
if vid:
    dr = run(["create-drawing", *D, "--name", "MyDrawing", "--src-elem", ps_eid,
              "--src-version", vid], expect_ok=True, label="create-drawing")
    dr_eid = dr.get("id") or dr.get("elementId")
    print(f"  drawing={dr_eid}")
    if dr_eid:
        run(["get-drawing-views", *D, "--elem", dr_eid], label="get-drawing-views")

print("\n=== CLEANUP: delete test document ===")
run(["delete-document", "--doc", did], label="delete-document")

print("\n================ SUMMARY ================")
passes = sum(1 for s, _, _ in results if s == "PASS")
fails = [(l, d) for s, l, d in results if s == "FAIL"]
print(f"PASS {passes}/{len(results)}")
with open("/tmp/test_summary.json", "w") as fh:
    json.dump([{"status": s, "label": l, "detail": d} for s, l, d in results],
              fh, ensure_ascii=True, indent=2)
if fails:
    print("FAILURES:")
    for l, d in fails:
        print(f"  - {l}: {d}")
