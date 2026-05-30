#!/usr/bin/env python3
"""Final verification of the fixed/added features on clean geometry."""

import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from onshape_cli.cli import load_credentials
from onshape_cli.api.client import OnshapeClient
from onshape_cli.api.partstudio import PartStudioManager
from onshape_cli.api.edges import EdgeQuery
from onshape_cli.api.export import ExportManager
from onshape_cli.builders.sketch import SketchBuilder, SketchPlane
from onshape_cli.builders.extrude import ExtrudeBuilder, ExtrudeType
from onshape_cli.builders import advanced as adv

REPORT = []


def log(s):
    print(s, flush=True)
    REPORT.append(s)


class _A:
    access_key = None
    secret_key = None


async def box(ps, doc, ws, two=False):
    elem = (await ps.create_part_studio(doc, ws, f"Fin {int(time.time()*1000)%100000}"))["id"]
    top = await ps.get_plane_id(doc, ws, elem, "Top")
    sb = SketchBuilder("B", SketchPlane.TOP, top); sb.add_rectangle((0, 0), (2, 1))
    sk = (await ps.add_feature(doc, ws, elem, sb.build(top)))["feature"]["featureId"]
    ex = (await ps.add_feature(doc, ws, elem, ExtrudeBuilder("Box", sk, 0.5, ExtrudeType.NEW).build()))["feature"]["featureId"]
    if two:
        sb2 = SketchBuilder("B2", SketchPlane.TOP, top); sb2.add_rectangle((1.5, 0.25), (2.5, 0.75))
        sk2 = (await ps.add_feature(doc, ws, elem, sb2.build(top)))["feature"]["featureId"]
        await ps.add_feature(doc, ws, elem, ExtrudeBuilder("Box2", sk2, 0.5, ExtrudeType.NEW).build())
    return elem, ex


async def try_feat(ps, doc, ws, elem, feat, label):
    try:
        resp = await ps.add_feature(doc, ws, elem, feat)
    except Exception as exc:  # noqa: BLE001
        try:
            msg = exc.response.json().get("message")
        except Exception:
            msg = str(exc)
        log(f"[FAIL] {label}: HTTP {msg}")
        return None
    fid = resp.get("feature", {}).get("featureId")
    feats = await ps.get_features(doc, ws, elem)
    st = feats.get("featureStates", {}).get(fid, {}).get("featureStatus", "?")
    notices = ""
    for f in feats.get("features", []):
        if f.get("featureId") == fid:
            for n in f.get("notices", []):
                notices += (n.get("message") or "") + ";"
    log(f"[{'PASS' if st == 'OK' else 'FAIL'}] {label}: {st} {notices}")
    return fid


async def main():
    doc, ws = sys.argv[1], sys.argv[2]
    creds = load_credentials(_A())
    created = []
    async with OnshapeClient(creds) as client:
        ps = PartStudioManager(client)
        edges = EdgeQuery(client)
        exporter = ExportManager(client)

        # boolean union (2 bodies)
        elem, ex = await box(ps, doc, ws, two=True); created.append(elem)
        await try_feat(ps, doc, ws, elem,
                       adv.build_boolean("U", operation_type="UNION", tools_query=adv.q_all_bodies()),
                       "boolean union")

        # mirror about Right plane
        elem, ex = await box(ps, doc, ws); created.append(elem)
        await try_feat(ps, doc, ws, elem,
                       adv.build_mirror("M", entities_query=adv.q_all_bodies(), mirror_plane_ids=["JEC"]),
                       "mirror PART about Right")

        # revolve
        elem = (await ps.create_part_studio(doc, ws, f"FinRev {int(time.time())%100000}"))["id"]; created.append(elem)
        fr = await ps.get_plane_id(doc, ws, elem, "Front")
        ax = SketchBuilder("Axis", SketchPlane.FRONT, fr); ax.add_line((0, 0), (0, 2), True)
        axfid = (await ps.add_feature(doc, ws, elem, ax.build(fr)))["feature"]["featureId"]
        pr = SketchBuilder("P", SketchPlane.FRONT, fr); pr.add_rectangle((0.5, 0), (1, 1.5))
        prfid = (await ps.add_feature(doc, ws, elem, pr.build(fr)))["feature"]["featureId"]
        await try_feat(ps, doc, ws, elem,
                       adv.build_revolve("R", sketch_feature_id=prfid,
                                         axis_query=f'query = qCreatedBy(makeId("{axfid}"), EntityType.LINE);'),
                       "revolve FULL")

        # get-edges (clean box)
        elem, ex = await box(ps, doc, ws); created.append(elem)
        eres = await edges.get_edges(doc, ws, elem)
        n = eres.get("count", 0)
        log(f"[{'PASS' if n else 'FAIL'}] get-edges: {n} edges")
        # linear pattern: direction = a construction line in a sketch (reliable ref)
        topp = await ps.get_plane_id(doc, ws, elem, "Top")
        dl = SketchBuilder("Dir", SketchPlane.TOP, topp); dl.add_line((0, 0), (1, 0), True)
        dlf = (await ps.add_feature(doc, ws, elem, dl.build(topp)))["feature"]["featureId"]
        await try_feat(ps, doc, ws, elem,
                       adv.build_linear_pattern("LP", entities_query=adv.q_all_bodies(),
                                                direction_query=f'query = qCreatedBy(makeId("{dlf}"), EntityType.LINE);',
                                                distance=0.3, instance_count=3),
                       "linear-pattern")

        # circular pattern about a vertical construction line
        elem = (await ps.create_part_studio(doc, ws, f"FinCirc {int(time.time())%100000}"))["id"]; created.append(elem)
        top = await ps.get_plane_id(doc, ws, elem, "Top")
        sb = SketchBuilder("B", SketchPlane.TOP, top); sb.add_rectangle((1, 0), (1.5, 0.4))
        sk = (await ps.add_feature(doc, ws, elem, sb.build(top)))["feature"]["featureId"]
        await ps.add_feature(doc, ws, elem, ExtrudeBuilder("Box", sk, 0.5, ExtrudeType.NEW).build())
        rt = await ps.get_plane_id(doc, ws, elem, "Right")
        axs = SketchBuilder("Ax", SketchPlane.RIGHT, rt); axs.add_line((0, 0), (0, 1), True)
        axfid = (await ps.add_feature(doc, ws, elem, axs.build(rt)))["feature"]["featureId"]
        await try_feat(ps, doc, ws, elem,
                       adv.build_circular_pattern("CP", entities_query=adv.q_all_bodies(),
                                                  axis_query=f'query = qCreatedBy(makeId("{axfid}"), EntityType.LINE);',
                                                  instance_count=4),
                       "circular-pattern")

        # export-stl (clean box)
        elem, ex = await box(ps, doc, ws); created.append(elem)
        try:
            out = await exporter.export_stl(doc, ws, elem, "/tmp/fin.stl")
            sz = Path(out).stat().st_size
            log(f"[{'PASS' if sz > 0 else 'FAIL'}] export-stl: {sz} bytes")
        except Exception as exc:  # noqa: BLE001
            log(f"[FAIL] export-stl: {exc}")

        # delete-element (cleanup all created)
        ok = 0
        for e in created:
            try:
                await client.delete(f"/api/v9/elements/d/{doc}/w/{ws}/e/{e}")
                ok += 1
            except Exception as exc:  # noqa: BLE001
                log(f"  delete fail {e}: {exc}")
        log(f"[{'PASS' if ok == len(created) else 'FAIL'}] delete-element: {ok}/{len(created)} cleaned")

    Path("/tmp/final.txt").write_text("\n".join(REPORT) + "\n")
    p = sum(1 for x in REPORT if x.startswith("[PASS]"))
    f = sum(1 for x in REPORT if x.startswith("[FAIL]"))
    log(f"==== {p} PASS / {f} FAIL ====")
    print("DONE_FINAL")


if __name__ == "__main__":
    asyncio.run(main())
