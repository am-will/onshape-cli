#!/usr/bin/env python3
"""End-to-end smoke test for the Onshape CLI / builders against the LIVE API.

Creates throwaway Part Studios, exercises every feature builder, and records
PASS/FAIL for each. Run with the venv python:

    ./venv/bin/python scripts/smoke_test.py <documentId> <workspaceId>

Writes a report to /tmp/onshape_cli_test_report.txt and prints it.
Credentials come from env or ~/.claude/mcp.json (same as the CLI).
"""

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from onshape_cli.cli import load_credentials  # noqa: E402
from onshape_cli.api.client import OnshapeClient  # noqa: E402
from onshape_cli.api.partstudio import PartStudioManager  # noqa: E402
from onshape_cli.api.edges import EdgeQuery  # noqa: E402
from onshape_cli.api.export import ExportManager  # noqa: E402
from onshape_cli.builders.sketch import SketchBuilder, SketchPlane  # noqa: E402
from onshape_cli.builders.extrude import ExtrudeBuilder, ExtrudeType  # noqa: E402
from onshape_cli.builders import advanced as adv  # noqa: E402


class _Args:
    access_key = None
    secret_key = None


REPORT = []


def log(line):
    print(line, flush=True)
    REPORT.append(line)


async def add(ps, doc, ws, elem, feature, label):
    """Add a feature, then read features to confirm it built OK."""
    try:
        resp = await ps.add_feature(doc, ws, elem, feature)
        fid = resp.get("feature", {}).get("featureId")
        feats = await ps.get_features(doc, ws, elem)
        st = feats.get("featureStates", {}).get(fid, {}).get("featureStatus", "?")
        ok = st == "OK"
        log(f"[{'PASS' if ok else 'FAIL'}] {label}: featureId={fid} status={st}")
        return fid if ok else None
    except Exception as exc:  # noqa: BLE001
        try:
            detail = exc.response.json().get("message", "")  # type: ignore[attr-defined]
        except Exception:
            detail = str(exc)
        log(f"[FAIL] {label}: {type(exc).__name__}: {detail}")
        return None


async def main():
    doc, ws = sys.argv[1], sys.argv[2]
    creds = load_credentials(_Args())
    async with OnshapeClient(creds) as client:
        ps = PartStudioManager(client)
        edges = EdgeQuery(client)
        exporter = ExportManager(client)

        studio = await ps.create_part_studio(doc, ws, f"SmokeTest {int(time.time())}")
        elem = studio["id"]
        log(f"# Part Studio: {elem}")

        async def plane(name):
            return await ps.get_plane_id(doc, ws, elem, name)

        top = await plane("Top")
        sb = SketchBuilder("Base", SketchPlane.TOP, top)
        sb.add_rectangle((0, 0), (2, 1))
        sk = await add(ps, doc, ws, elem, sb.build(top), "create-sketch(rectangle)")
        ex = await add(ps, doc, ws, elem,
                       ExtrudeBuilder("Box", sk, 0.5, ExtrudeType.NEW).build(), "extrude")

        await add(ps, doc, ws, elem,
                  adv.build_fillet("FilletFeat", 0.08, feature_id=ex), "fillet --feature")
        await add(ps, doc, ws, elem,
                  adv.build_chamfer("ChamferAll", 0.05, select_all=True), "chamfer --all")

        try:
            e = await edges.get_edges(doc, ws, elem)
            n = len(e.get("edges", []))
            log(f"[{'PASS' if n else 'FAIL'}] get-edges: {n} edges classified")
        except Exception as exc:  # noqa: BLE001
            log(f"[FAIL] get-edges: {exc}")
        try:
            ef = await edges.find_edges_by_feature(doc, ws, elem, ex)
            log(f"[PASS] find-edges-by-feature: {len(ef)} items")
        except Exception as exc:  # noqa: BLE001
            log(f"[FAIL] find-edges-by-feature: {exc}")

        await add(ps, doc, ws, elem,
                  adv.build_shell("Shell", 0.06,
                                  query_string='query = qNthElement(qCreatedBy(makeId("%s"), EntityType.FACE), 0);' % ex),
                  "shell")

        sb2 = SketchBuilder("B2", SketchPlane.TOP, top)
        sb2.add_rectangle((1.5, 0.25), (2.5, 0.75))
        sk2 = await add(ps, doc, ws, elem, sb2.build(top), "sketch2")
        await add(ps, doc, ws, elem,
                  ExtrudeBuilder("Box2", sk2, 0.5, ExtrudeType.NEW).build(), "extrude2(new body)")
        await add(ps, doc, ws, elem,
                  adv.build_boolean("Union", operation_type="UNION", tools_query=adv.q_all_bodies()),
                  "boolean union")

        await add(ps, doc, ws, elem,
                  adv.build_mirror("Mirror", entities_query=adv.q_all_bodies(),
                                   mirror_plane_ids=["JEC"]), "mirror")

        # revolve in its own studio
        rstudio = await ps.create_part_studio(doc, ws, f"SmokeRevolve {int(time.time())}")
        relem = rstudio["id"]
        rp = await ps.get_plane_id(doc, ws, relem, "Front")
        rsb = SketchBuilder("Prof", SketchPlane.FRONT, rp)
        rsb.add_line((0.5, 0), (1, 0))
        rsb.add_line((1, 0), (1, 1))
        rsb.add_line((1, 1), (0.5, 1))
        rsb.add_line((0.5, 1), (0.5, 0))
        rsk = await add(ps, doc, ws, relem, rsb.build(rp), "revolve:sketch")
        axis = 'query = qCreatedBy(makeId("Y"), EntityType.LINE);'
        await add(ps, doc, ws, relem,
                  adv.build_revolve("Revolve", sketch_feature_id=rsk, axis_query=axis),
                  "revolve")

        try:
            mp = await exporter.mass_properties(doc, ws, elem)
            log(f"[PASS] mass-properties: keys={list(mp.keys())}")
        except Exception as exc:  # noqa: BLE001
            log(f"[FAIL] mass-properties: {exc}")
        try:
            out = await exporter.export_stl(doc, ws, elem, "/tmp/smoke.stl")
            sz = Path(out).stat().st_size
            log(f"[{'PASS' if sz > 0 else 'FAIL'}] export-stl: {sz} bytes")
        except Exception as exc:  # noqa: BLE001
            log(f"[FAIL] export-stl: {exc}")
        try:
            out = await exporter.export_translation(doc, ws, elem, "/tmp/smoke.step",
                                                    format_name="STEP", timeout=90)
            sz = Path(out).stat().st_size
            log(f"[{'PASS' if sz > 0 else 'FAIL'}] export STEP: {sz} bytes")
        except Exception as exc:  # noqa: BLE001
            log(f"[FAIL] export STEP: {exc}")

    Path("/tmp/onshape_cli_test_report.txt").write_text("\n".join(REPORT) + "\n")
    fails = sum(1 for x in REPORT if x.startswith("[FAIL]"))
    passes = sum(1 for x in REPORT if x.startswith("[PASS]"))
    print(f"\n==== {passes} PASS / {fails} FAIL ====")


if __name__ == "__main__":
    asyncio.run(main())
