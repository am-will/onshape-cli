#!/usr/bin/env python3
"""Dump raw feature specs to files and print clean param summaries."""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from onshape_cli.cli import load_credentials
from onshape_cli.api.client import OnshapeClient

WANT = {"boolean", "mirror", "revolve", "fillet", "chamfer", "shell",
        "linearPattern", "circularPattern", "extrude"}


class _A:
    access_key = None
    secret_key = None


async def main():
    doc, ws, elem = sys.argv[1], sys.argv[2], sys.argv[3]
    creds = load_credentials(_A())
    async with OnshapeClient(creds) as client:
        specs = await client.get(
            f"/api/v9/partstudios/d/{doc}/w/{ws}/e/{elem}/featurespecs")
        Path("/tmp/specs.json").write_text(json.dumps(specs))

        # discover structure
        if isinstance(specs, dict):
            items = specs.get("featureSpecs") or specs.get("specs") or []
            print("specs top-level keys:", list(specs.keys()))
        else:
            items = specs
        print("num specs:", len(items))

        out = []
        for spec in items:
            ftype = (spec.get("featureTypeName") or spec.get("featureType")
                     or spec.get("name"))
            if ftype not in WANT:
                continue
            out.append(f"\n## {ftype}")
            # parameters can be under several keys
            pspec = (spec.get("parameterSpec") or spec.get("parameters")
                     or spec.get("featureSpec", {}).get("parameters") or [])
            for p in pspec:
                pid = p.get("parameterId") or p.get("name")
                bt = p.get("btType", "")
                line = f"   {pid}  [{bt}]"
                if "Enum" in bt:
                    enum_name = p.get("enumName")
                    vals = [e.get("value") for e in
                            (p.get("enumValues") or p.get("options") or [])]
                    line += f"  enum={enum_name} {vals}"
                if p.get("defaultValue") is not None:
                    line += f"  default={p.get('defaultValue')}"
                out.append(line)
        summary = "\n".join(out)
        Path("/tmp/specs_summary.txt").write_text(summary)
        print(summary)
    print("\nDONE_INTRO2")


if __name__ == "__main__":
    asyncio.run(main())
