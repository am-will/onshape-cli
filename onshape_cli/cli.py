"""Onshape CLI - a standalone command-line replacement for the MCP server.

Every capability of the MCP server (plus fixed fillet, chamfer, shell, patterns,
boolean, revolve, export, mass properties, and feature delete/update) is exposed
as a subcommand. Output is JSON on stdout so agents can parse it.

Credentials are read from (in order):
  1. --access-key / --secret-key flags
  2. ONSHAPE_ACCESS_KEY / ONSHAPE_SECRET_KEY env vars
  3. ~/.claude/mcp.json  (the "onshape" server's env block)

Document/workspace/element default to ONSHAPE_DOC / ONSHAPE_WS / ONSHAPE_ELEM
env vars when the corresponding flags are omitted.

Examples:
  onshape-cli list-documents --limit 5
  onshape-cli get-features --doc D --ws W --elem E
  onshape-cli fillet --doc D --ws W --elem E --all --radius 0.06
  onshape-cli fillet --doc D --ws W --elem E --feature FID --radius 0.06
  onshape-cli chamfer --doc D --ws W --elem E --all --width 0.08
  onshape-cli export-stl --doc D --ws W --elem E --out part.stl
  onshape-cli mass-properties --doc D --ws W --elem E
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from loguru import logger

# Keep stdout pure JSON: silence the library's debug logging.
logger.remove()

from .api.client import OnshapeClient, OnshapeCredentials
from .api.documents import DocumentManager
from .api.partstudio import PartStudioManager
from .api.variables import VariableManager
from .api.edges import EdgeQuery
from .api.export import ExportManager
from .api.assemblies import AssemblyManager
from .api.configurations import ConfigurationManager
from .api.drawings import DrawingManager
from .api.metadata import MetadataManager
from .api.featurestudio import FeatureStudioManager
from .builders.sketch import SketchBuilder, SketchPlane
from .builders.extrude import ExtrudeBuilder, ExtrudeType
from .builders.thicken import ThickenBuilder
from .builders import advanced as adv


# ---------------------------------------------------------------------------
# Credentials & output helpers
# ---------------------------------------------------------------------------

def load_credentials(args) -> OnshapeCredentials:
    access = args.access_key or os.environ.get("ONSHAPE_ACCESS_KEY")
    secret = args.secret_key or os.environ.get("ONSHAPE_SECRET_KEY")
    base = os.environ.get("ONSHAPE_BASE_URL", "https://cad.onshape.com")
    if not (access and secret):
        cfg = Path.home() / ".claude" / "mcp.json"
        if cfg.exists():
            try:
                data = json.loads(cfg.read_text())
                env = data["mcpServers"]["onshape"]["env"]
                access = access or env.get("ONSHAPE_ACCESS_KEY")
                secret = secret or env.get("ONSHAPE_SECRET_KEY")
            except Exception:
                pass
    if not (access and secret):
        emit_error("No credentials. Set ONSHAPE_ACCESS_KEY / ONSHAPE_SECRET_KEY "
                   "or pass --access-key/--secret-key.")
        sys.exit(2)
    return OnshapeCredentials(access_key=access, secret_key=secret, base_url=base)


def _json_default(o: Any):
    if hasattr(o, "model_dump"):
        return o.model_dump()
    return str(o)


def emit(obj: Any) -> None:
    print(json.dumps({"ok": True, "result": obj}, indent=2, default=_json_default))


def emit_error(msg: str, detail: Any = None) -> None:
    print(json.dumps({"ok": False, "error": msg, "detail": detail}, indent=2, default=str))


def dwe(args):
    """Resolve document/workspace/element from flags or env."""
    doc = args.doc or os.environ.get("ONSHAPE_DOC")
    ws = args.ws or os.environ.get("ONSHAPE_WS")
    elem = getattr(args, "elem", None) or os.environ.get("ONSHAPE_ELEM")
    return doc, ws, elem


def new_feature_id(response: Dict[str, Any]) -> Optional[str]:
    """Pull the created feature's ID out of an add-feature response."""
    if isinstance(response, dict):
        feat = response.get("feature")
        if isinstance(feat, dict):
            return feat.get("featureId")
    return None


# ---------------------------------------------------------------------------
# Command handlers (each async, receives client + args)
# ---------------------------------------------------------------------------

async def run(args) -> None:
    creds = load_credentials(args)
    async with OnshapeClient(creds) as client:
        docs = DocumentManager(client)
        ps = PartStudioManager(client)
        variables = VariableManager(client)
        edges = EdgeQuery(client)
        exporter = ExportManager(client)
        asm = AssemblyManager(client)
        configs = ConfigurationManager(client)
        drawings = DrawingManager(client)
        meta = MetadataManager(client)
        fstudio = FeatureStudioManager(client)
        cmd = args.command

        def _load_json(inline, file_attr):
            """Load JSON from an inline string or a file path."""
            raw = inline
            if file_attr:
                raw = Path(file_attr).read_text()
            return json.loads(raw)

        # ---- Discovery ----
        if cmd == "list-documents":
            filter_map = {"all": None, "owned": 1, "created": 4, "shared": 5}
            emit(await docs.list_documents(
                filter_type=filter_map.get(args.filter), limit=args.limit,
                sort_by=args.sort_by, sort_order=args.sort_order))
        elif cmd == "search-documents":
            emit(await docs.search_documents(args.query, limit=args.limit))
        elif cmd == "get-document":
            emit(await docs.get_document(args.doc))
        elif cmd == "get-document-summary":
            emit(await docs.get_document_summary(args.doc))
        elif cmd == "create-document":
            emit(await docs.create_document(args.name, is_public=args.public,
                                            description=args.description))
        elif cmd == "delete-document":
            emit(await docs.delete_document(args.doc))
        elif cmd == "get-elements":
            doc, ws, _ = dwe(args)
            emit(await docs.get_elements(doc, ws, element_type=args.type))
        elif cmd == "find-part-studios":
            doc, ws, _ = dwe(args)
            emit(await docs.find_part_studios(doc, ws, name_pattern=args.name))
        elif cmd == "get-parts":
            doc, ws, elem = dwe(args)
            emit(await ps.get_parts(doc, ws, elem))
        elif cmd == "get-features":
            doc, ws, elem = dwe(args)
            emit(await ps.get_features(doc, ws, elem,
                                      configuration=getattr(args, "configuration", None)))
        elif cmd == "get-feature-specs":
            doc, ws, elem = dwe(args)
            emit(await ps.get_feature_specs(doc, ws, elem))
        elif cmd == "get-sketch-info":
            doc, ws, elem = dwe(args)
            emit(await ps.get_sketch_info(doc, ws, elem, sketch_id=args.sketch))
        elif cmd == "get-assembly":
            doc, ws, elem = dwe(args)
            emit(await docs.get_assembly(doc, ws, elem))
        elif cmd == "get-body-details":
            doc, ws, elem = dwe(args)
            emit(await ps.get_body_details(doc, ws, elem))

        # ---- Document versioning / metadata ----
        elif cmd == "update-document":
            emit(await docs.update_document(args.doc, name=args.name,
                                            description=args.description))
        elif cmd == "list-versions":
            emit(await docs.get_versions(args.doc))
        elif cmd == "create-version":
            doc, ws, _ = dwe(args)
            emit(await docs.create_version(doc, ws, args.name,
                                           description=args.description))
        elif cmd == "get-workspaces":
            emit(await docs.get_workspaces(args.doc))

        # ---- Variables ----
        elif cmd == "get-variables":
            doc, ws, elem = dwe(args)
            res = await variables.get_variables(doc, ws, elem)
            emit([v.model_dump() for v in res])
        elif cmd == "set-variable":
            doc, ws, elem = dwe(args)
            emit(await variables.set_variable(
                doc, ws, elem, args.name, args.expression, args.description))

        # ---- Part studio management ----
        elif cmd == "create-part-studio":
            doc, ws, _ = dwe(args)
            emit(await ps.create_part_studio(doc, ws, args.name))
        elif cmd == "delete-feature":
            doc, ws, elem = dwe(args)
            emit(await ps.delete_feature(doc, ws, elem, args.feature))
        elif cmd == "delete-element":
            doc, ws, elem = dwe(args)
            emit(await client.delete(f"/api/v9/elements/d/{doc}/w/{ws}/e/{elem}"))
        elif cmd == "eval-featurescript":
            doc, ws, elem = dwe(args)
            script = args.script
            if args.script_file:
                script = Path(args.script_file).read_text()
            resp = await ps.evaluate_feature_script(doc, ws, elem, script)
            if getattr(args, "raw", False):
                emit(resp)
            else:
                from .api.fsvalue import decode_fs_value
                emit({"value": decode_fs_value(resp.get("result", {})),
                      "console": (resp.get("console") or "")})
        elif cmd == "measure":
            doc, ws, elem = dwe(args)
            emit(await ps.measure(doc, ws, elem))

        # ---- Sketches ----
        elif cmd == "create-sketch":
            await _create_sketch(ps, args)
        elif cmd in ("sketch-rectangle", "sketch-circle", "sketch-line"):
            await _create_simple_sketch(ps, args, cmd)

        # ---- Solid features ----
        elif cmd in ("extrude", "hole"):
            doc, ws, elem = dwe(args)
            op = ExtrudeType.REMOVE if cmd == "hole" else ExtrudeType[args.op]
            builder = ExtrudeBuilder(name=args.name, sketch_feature_id=args.sketch,
                                     depth=args.depth, operation_type=op)
            if args.depth_var:
                builder.set_depth(args.depth, args.depth_var)
            resp = await ps.add_feature(doc, ws, elem, builder.build())
            emit({"featureId": new_feature_id(resp), "response": resp})
        elif cmd == "thicken":
            doc, ws, elem = dwe(args)
            builder = ThickenBuilder(name=args.name, sketch_feature_id=args.sketch,
                                     thickness=args.thickness)
            resp = await ps.add_feature(doc, ws, elem, builder.build())
            emit({"featureId": new_feature_id(resp), "response": resp})
        elif cmd == "fillet":
            doc, ws, elem = dwe(args)
            feat = adv.build_fillet(
                name=args.name, radius=args.radius,
                edge_ids=_split(args.edges), feature_id=args.feature,
                select_all=args.all, circular=args.circular,
                query_string=args.query, fillet_type=args.type)
            resp = await ps.add_feature(doc, ws, elem, feat)
            emit({"featureId": new_feature_id(resp), "response": resp})
        elif cmd == "chamfer":
            doc, ws, elem = dwe(args)
            feat = adv.build_chamfer(
                name=args.name, width=args.width,
                edge_ids=_split(args.edges), feature_id=args.feature,
                select_all=args.all, circular=args.circular,
                query_string=args.query, chamfer_type=args.type, angle=args.angle)
            resp = await ps.add_feature(doc, ws, elem, feat)
            emit({"featureId": new_feature_id(resp), "response": resp})
        elif cmd == "shell":
            doc, ws, elem = dwe(args)
            feat = adv.build_shell(
                name=args.name, thickness=args.thickness,
                face_ids=_split(args.faces), query_string=args.query,
                inward=not args.outward)
            resp = await ps.add_feature(doc, ws, elem, feat)
            emit({"featureId": new_feature_id(resp), "response": resp})
        elif cmd == "revolve":
            doc, ws, elem = dwe(args)
            feat = adv.build_revolve(
                name=args.name, sketch_feature_id=args.sketch,
                axis_query=args.axis, axis_ids=_split(args.axis_ids),
                operation_type=args.op, revolve_type=args.type, angle=args.angle)
            resp = await ps.add_feature(doc, ws, elem, feat)
            emit({"featureId": new_feature_id(resp), "response": resp})
        elif cmd == "boolean":
            doc, ws, elem = dwe(args)
            feat = adv.build_boolean(
                name=args.name, operation_type=args.op,
                tools_query=args.tools, tool_ids=_split(args.tool_ids),
                targets_query=args.targets, keep_tools=args.keep_tools)
            resp = await ps.add_feature(doc, ws, elem, feat)
            emit({"featureId": new_feature_id(resp), "response": resp})
        elif cmd == "mirror":
            doc, ws, elem = dwe(args)
            feat = adv.build_mirror(
                name=args.name, pattern_type=args.type,
                entities_query=args.entities,
                mirror_plane_ids=_split(args.plane_ids),
                mirror_plane_query=args.plane_query)
            resp = await ps.add_feature(doc, ws, elem, feat)
            emit({"featureId": new_feature_id(resp), "response": resp})
        elif cmd == "linear-pattern":
            doc, ws, elem = dwe(args)
            feat = adv.build_linear_pattern(
                name=args.name, pattern_type=args.type,
                entities_query=args.entities, direction_query=args.direction,
                direction_ids=_split(args.direction_ids),
                distance=args.distance, instance_count=args.count,
                opposite=args.opposite)
            resp = await ps.add_feature(doc, ws, elem, feat)
            emit({"featureId": new_feature_id(resp), "response": resp})
        elif cmd == "circular-pattern":
            doc, ws, elem = dwe(args)
            feat = adv.build_circular_pattern(
                name=args.name, pattern_type=args.type,
                entities_query=args.entities, axis_query=args.axis,
                axis_ids=_split(args.axis_ids),
                instance_count=args.count, angle=args.angle,
                equal_spacing=not args.no_equal_spacing)
            resp = await ps.add_feature(doc, ws, elem, feat)
            emit({"featureId": new_feature_id(resp), "response": resp})
        elif cmd == "offset-plane":
            doc, ws, elem = dwe(args)
            feat = adv.build_offset_plane(
                name=args.name, base_plane_ids=_split(args.base_ids),
                base_plane_query=args.base_query, offset=args.offset)
            resp = await ps.add_feature(doc, ws, elem, feat)
            emit({"featureId": new_feature_id(resp), "response": resp})

        # ---- Edges ----
        elif cmd == "get-edges":
            doc, ws, elem = dwe(args)
            emit(await edges.get_edges(doc, ws, elem))
        elif cmd == "find-circular-edges":
            doc, ws, elem = dwe(args)
            emit(await edges.find_circular_edges(doc, ws, elem, radius=args.radius))
        elif cmd == "find-edges-by-feature":
            doc, ws, elem = dwe(args)
            emit(await edges.find_edges_by_feature(doc, ws, elem, args.feature))

        # ---- Raw feature access (power tools) ----
        elif cmd == "add-feature":
            doc, ws, elem = dwe(args)
            feature = _load_json(args.json, args.json_file)
            resp = await ps.add_feature(doc, ws, elem, feature)
            emit({"featureId": new_feature_id(resp), "response": resp})
        elif cmd == "update-feature":
            doc, ws, elem = dwe(args)
            feature = _load_json(args.json, args.json_file)
            emit(await ps.update_feature(doc, ws, elem, args.feature, feature))
        elif cmd == "rollback":
            doc, ws, elem = dwe(args)
            emit(await ps.set_rollback(doc, ws, elem, args.index))
        elif cmd == "draft":
            doc, ws, elem = dwe(args)
            feat = adv.build_draft(name=args.name, angle=args.angle,
                                   neutral_plane_query=args.neutral,
                                   face_query=args.faces)
            resp = await ps.add_feature(doc, ws, elem, feat)
            emit({"featureId": new_feature_id(resp), "response": resp})

        # ---- Configurations ----
        elif cmd == "get-configuration":
            doc, ws, elem = dwe(args)
            emit(await configs.get_configuration(doc, ws, elem))
        elif cmd == "encode-configuration":
            doc, ws, elem = dwe(args)
            params = _load_json(args.params, args.params_file)
            emit(await configs.encode_configuration(doc, elem, params))

        # ---- Assemblies (write) ----
        elif cmd == "create-assembly":
            doc, ws, _ = dwe(args)
            emit(await asm.create_assembly(doc, ws, args.name))
        elif cmd == "insert-instance":
            doc, ws, elem = dwe(args)
            emit(await asm.insert_instance(
                doc, ws, elem,
                source_document_id=args.src_doc or doc,
                source_element_id=args.src_elem,
                part_id=args.part,
                source_version_id=args.src_version,
                is_assembly=args.is_assembly,
                is_whole_part_studio=args.whole_studio,
                configuration=args.configuration))
        elif cmd == "get-assembly-features":
            doc, ws, elem = dwe(args)
            emit(await asm.get_features(doc, ws, elem))
        elif cmd == "assembly-add-feature":
            doc, ws, elem = dwe(args)
            feature = _load_json(args.json, args.json_file)
            emit(await asm.add_feature(doc, ws, elem, feature))
        elif cmd == "assembly-mate-connector":
            doc, ws, elem = dwe(args)
            feat = adv.build_assembly_mate_connector(
                name=args.name, occurrence_id=args.occurrence,
                inference_type=args.inference)
            resp = await asm.add_feature(doc, ws, elem, feat)
            emit({"featureId": new_feature_id(resp), "response": resp})
        elif cmd == "assembly-mate":
            doc, ws, elem = dwe(args)
            feat = adv.build_assembly_mate(
                name=args.name, mate_type=args.type,
                mate_connector_ids=_split(args.connectors))
            resp = await asm.add_feature(doc, ws, elem, feat)
            emit({"featureId": new_feature_id(resp), "response": resp})
        elif cmd == "assembly-group":
            doc, ws, elem = dwe(args)
            feat = adv.build_assembly_group(
                name=args.name, occurrence_ids=_split(args.occurrences))
            resp = await asm.add_feature(doc, ws, elem, feat)
            emit({"featureId": new_feature_id(resp), "response": resp})
        elif cmd == "get-bom":
            doc, ws, elem = dwe(args)
            emit(await asm.get_bom(doc, ws, elem, multi_level=args.multi_level))
        elif cmd == "assembly-mass-properties":
            doc, ws, elem = dwe(args)
            emit(await asm.mass_properties(doc, ws, elem))
        elif cmd == "delete-instance":
            doc, ws, elem = dwe(args)
            emit(await asm.delete_instance(doc, ws, elem, args.node))
        elif cmd == "transform-instance":
            doc, ws, elem = dwe(args)
            paths = _load_json(args.paths, None)
            transform = _load_json(args.transform, None)
            emit(await asm.transform_occurrences(doc, ws, elem, paths, transform,
                                                 is_relative=not args.absolute))

        # ---- Drawings ----
        elif cmd == "create-drawing":
            doc, ws, _ = dwe(args)
            emit(await drawings.create_drawing(
                doc, ws, name=args.name, source_element_id=args.src_elem,
                source_version_id=args.src_version, source_document_id=args.src_doc,
                part_id=args.part))
        elif cmd == "get-drawing-views":
            doc, ws, elem = dwe(args)
            emit(await drawings.get_views(doc, ws, elem))
        elif cmd == "export-drawing":
            doc, ws, elem = dwe(args)
            path = await exporter.export_translation(
                doc, ws, elem, args.out, format_name=args.format,
                element_kind="drawings")
            emit({"written": path, "format": args.format})

        # ---- Metadata ----
        elif cmd == "get-metadata":
            doc, ws, elem = dwe(args)
            if args.part:
                emit(await meta.get_part_metadata(doc, ws, elem, args.part))
            else:
                emit(await meta.get_element_metadata(doc, ws, elem))
        elif cmd == "set-metadata":
            doc, ws, elem = dwe(args)
            properties = _load_json(args.properties, args.properties_file)
            emit(await meta.set_element_metadata(doc, ws, elem, properties,
                                                 part_id=args.part))

        # ---- Feature Studio (custom FeatureScript) ----
        elif cmd == "create-feature-studio":
            doc, ws, _ = dwe(args)
            emit(await fstudio.create(doc, ws, args.name))
        elif cmd == "get-feature-studio":
            doc, ws, elem = dwe(args)
            emit(await fstudio.get_contents(doc, ws, elem))
        elif cmd == "set-feature-studio":
            doc, ws, elem = dwe(args)
            contents = args.contents
            if args.contents_file:
                contents = Path(args.contents_file).read_text()
            emit(await fstudio.set_contents(doc, ws, elem, contents))

        # ---- Export & analysis ----
        elif cmd == "mass-properties":
            doc, ws, elem = dwe(args)
            emit(await exporter.mass_properties(doc, ws, elem,
                                                configuration=args.configuration))
        elif cmd == "export-stl":
            doc, ws, elem = dwe(args)
            path = await exporter.export_stl(doc, ws, elem, args.out,
                                             binary=not args.ascii, resolution=args.resolution,
                                             configuration=args.configuration)
            emit({"written": path})
        elif cmd == "export":
            doc, ws, elem = dwe(args)
            path = await exporter.export_translation(doc, ws, elem, args.out,
                                                     format_name=args.format,
                                                     element_kind=args.kind,
                                                     configuration=args.configuration)
            emit({"written": path, "format": args.format})
        elif cmd == "thumbnail-info":
            doc, ws, elem = dwe(args)
            emit(await exporter.thumbnail_info(doc, ws, elem))
        elif cmd == "get-thumbnail":
            doc, ws, elem = dwe(args)
            path = await exporter.get_thumbnail(doc, ws, elem, args.out, size=args.size)
            emit({"written": path, "size": args.size})
        elif cmd == "shaded-view":
            doc, ws, elem = dwe(args)
            path = await exporter.shaded_view(
                doc, ws, elem, args.out, element_kind=args.kind,
                width=args.width, height=args.height, view_matrix=args.view_matrix,
                show_edges=not args.no_edges, configuration=args.configuration)
            emit({"written": path})
        else:
            emit_error(f"Unknown command: {cmd}")
            sys.exit(2)


def _split(val: Optional[str]) -> Optional[List[str]]:
    if not val:
        return None
    return [x.strip() for x in val.split(",") if x.strip()]


async def _create_sketch(ps: PartStudioManager, args) -> None:
    doc, ws, elem = dwe(args)
    entities = json.loads(args.entities)
    plane = SketchPlane[args.plane.upper()]
    plane_id = await ps.get_plane_id(doc, ws, elem, plane.value)
    builder = SketchBuilder(name=args.name, plane=plane, plane_id=plane_id)
    for e in entities:
        t = e["type"]
        if t == "line":
            builder.add_line(tuple(e["start"]), tuple(e["end"]),
                             e.get("construction", False))
        elif t == "circle":
            builder.add_circle(tuple(e["center"]), e["radius"],
                               e.get("construction", False))
        elif t == "rectangle":
            builder.add_rectangle(tuple(e["corner1"]), tuple(e["corner2"]))
        elif t == "arc":
            if not hasattr(builder, "add_arc"):
                raise ValueError("arc entities not supported by this sketch builder yet; "
                                 "use line/circle/rectangle")
            builder.add_arc(tuple(e["start"]), tuple(e["end"]), tuple(e["mid"]),
                            e.get("construction", False))
    resp = await ps.add_feature(doc, ws, elem, builder.build(plane_id))
    emit({"featureId": new_feature_id(resp), "response": resp})


async def _create_simple_sketch(ps: PartStudioManager, args, cmd) -> None:
    doc, ws, elem = dwe(args)
    plane = SketchPlane[args.plane.upper()]
    plane_id = await ps.get_plane_id(doc, ws, elem, plane.value)
    builder = SketchBuilder(name=args.name, plane=plane, plane_id=plane_id)
    if cmd == "sketch-rectangle":
        builder.add_rectangle(tuple(args.corner1), tuple(args.corner2))
    elif cmd == "sketch-circle":
        builder.add_circle(tuple(args.center), args.radius)
    elif cmd == "sketch-line":
        builder.add_line(tuple(args.start), tuple(args.end))
    resp = await ps.add_feature(doc, ws, elem, builder.build(plane_id))
    emit({"featureId": new_feature_id(resp), "response": resp})


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="onshape-cli", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--access-key")
    p.add_argument("--secret-key")
    sub = p.add_subparsers(dest="command", required=True)

    def add_dwe(sp, elem=True):
        sp.add_argument("--doc")
        sp.add_argument("--ws")
        if elem:
            sp.add_argument("--elem")

    def floats(n):
        return lambda s: [float(x) for x in s.split(",")][:n]

    # Discovery
    s = sub.add_parser("list-documents")
    s.add_argument("--filter", default="all")
    s.add_argument("--limit", type=int, default=20)
    s.add_argument("--sort-by", default="modifiedAt")
    s.add_argument("--sort-order", default="desc")
    s = sub.add_parser("search-documents"); s.add_argument("query"); s.add_argument("--limit", type=int, default=20)
    s = sub.add_parser("get-document"); s.add_argument("--doc")
    s = sub.add_parser("get-document-summary"); s.add_argument("--doc")
    s = sub.add_parser("create-document"); s.add_argument("--name", required=True)
    s.add_argument("--public", action="store_true"); s.add_argument("--description")
    s = sub.add_parser("delete-document"); s.add_argument("--doc", required=True)
    s = sub.add_parser("get-elements"); add_dwe(s, elem=False); s.add_argument("--type")
    s = sub.add_parser("find-part-studios"); add_dwe(s, elem=False); s.add_argument("--name")
    s = sub.add_parser("get-parts"); add_dwe(s)
    s = sub.add_parser("get-features"); add_dwe(s); s.add_argument("--configuration")
    s = sub.add_parser("get-feature-specs"); add_dwe(s)
    s = sub.add_parser("get-sketch-info"); add_dwe(s); s.add_argument("--sketch")
    s = sub.add_parser("get-assembly"); add_dwe(s)
    s = sub.add_parser("get-body-details"); add_dwe(s)

    # Document versioning
    s = sub.add_parser("update-document"); s.add_argument("--doc", required=True)
    s.add_argument("--name"); s.add_argument("--description")
    s = sub.add_parser("list-versions"); s.add_argument("--doc", required=True)
    s = sub.add_parser("create-version"); add_dwe(s, elem=False)
    s.add_argument("--name", required=True); s.add_argument("--description")
    s = sub.add_parser("get-workspaces"); s.add_argument("--doc", required=True)

    # Raw feature access (power tools)
    s = sub.add_parser("add-feature"); add_dwe(s)
    s.add_argument("--json", help="raw feature JSON (BTFeatureDefinitionCall-1406 envelope)")
    s.add_argument("--json-file", help="path to a file with the feature JSON")
    s = sub.add_parser("update-feature"); add_dwe(s); s.add_argument("--feature", required=True)
    s.add_argument("--json"); s.add_argument("--json-file")
    s = sub.add_parser("rollback"); add_dwe(s)
    s.add_argument("--index", type=int, required=True, help="-1 = end of feature list")
    s = sub.add_parser("draft"); add_dwe(s)
    s.add_argument("--name", default="Draft"); s.add_argument("--angle", type=float, default=3.0)
    s.add_argument("--neutral", required=True, help="FeatureScript query for the neutral plane")
    s.add_argument("--faces", required=True, help="FeatureScript query for faces to draft")

    # Configurations
    s = sub.add_parser("get-configuration"); add_dwe(s)
    s = sub.add_parser("encode-configuration"); add_dwe(s)
    s.add_argument("--params", help='JSON: [{"parameterId":..,"parameterValue":..}]')
    s.add_argument("--params-file")

    # Assemblies (write)
    s = sub.add_parser("create-assembly"); add_dwe(s, elem=False); s.add_argument("--name", required=True)
    s = sub.add_parser("insert-instance"); add_dwe(s)
    s.add_argument("--src-doc", help="source document id (defaults to --doc)")
    s.add_argument("--src-elem", required=True, help="source part studio/assembly element id")
    s.add_argument("--part", help="part id (for a single part)")
    s.add_argument("--src-version", help="source version id (required for cross-document)")
    s.add_argument("--is-assembly", action="store_true")
    s.add_argument("--whole-studio", action="store_true", help="insert the entire Part Studio")
    s.add_argument("--configuration")
    s = sub.add_parser("get-assembly-features"); add_dwe(s)
    s = sub.add_parser("assembly-add-feature"); add_dwe(s)
    s.add_argument("--json"); s.add_argument("--json-file")
    s = sub.add_parser("assembly-mate-connector"); add_dwe(s)
    s.add_argument("--name", default="Mate connector")
    s.add_argument("--occurrence", required=True, help="instance id from get-assembly")
    s.add_argument("--inference", default="CENTROID",
                   help="inferred origin: CENTROID, MID_POINT, etc.")
    s = sub.add_parser("assembly-mate"); add_dwe(s)
    s.add_argument("--name", default="Mate")
    s.add_argument("--type", default="FASTENED",
                   choices=["FASTENED", "SLIDER", "CYLINDRICAL", "REVOLUTE",
                            "PIN_SLOT", "PLANAR", "BALL", "PARALLEL"])
    s.add_argument("--connectors", required=True,
                   help="comma-separated mate connector feature ids (exactly 2)")
    s = sub.add_parser("assembly-group"); add_dwe(s)
    s.add_argument("--name", default="Group")
    s.add_argument("--occurrences", required=True,
                   help="comma-separated instance ids to fix together")
    s = sub.add_parser("get-bom"); add_dwe(s); s.add_argument("--multi-level", action="store_true")
    s = sub.add_parser("assembly-mass-properties"); add_dwe(s)
    s = sub.add_parser("delete-instance"); add_dwe(s); s.add_argument("--node", required=True)
    s = sub.add_parser("transform-instance"); add_dwe(s)
    s.add_argument("--paths", required=True, help="JSON list of occurrence paths, e.g. [[\"id1\"]]")
    s.add_argument("--transform", required=True, help="JSON list of 16 floats (row-major 4x4)")
    s.add_argument("--absolute", action="store_true", help="treat transform as absolute, not relative")

    # Drawings
    s = sub.add_parser("create-drawing"); add_dwe(s, elem=False)
    s.add_argument("--name", required=True)
    s.add_argument("--src-elem", required=True); s.add_argument("--src-version", required=True)
    s.add_argument("--src-doc"); s.add_argument("--part")
    s = sub.add_parser("get-drawing-views"); add_dwe(s)
    s = sub.add_parser("export-drawing"); add_dwe(s)
    s.add_argument("--out", required=True); s.add_argument("--format", default="PDF")

    # Metadata
    s = sub.add_parser("get-metadata"); add_dwe(s); s.add_argument("--part")
    s = sub.add_parser("set-metadata"); add_dwe(s); s.add_argument("--part")
    s.add_argument("--properties", help='JSON: [{"propertyId":..,"value":..}]')
    s.add_argument("--properties-file")

    # Feature Studio
    s = sub.add_parser("create-feature-studio"); add_dwe(s, elem=False); s.add_argument("--name", required=True)
    s = sub.add_parser("get-feature-studio"); add_dwe(s)
    s = sub.add_parser("set-feature-studio"); add_dwe(s)
    s.add_argument("--contents"); s.add_argument("--contents-file")

    # Variables
    s = sub.add_parser("get-variables"); add_dwe(s)
    s = sub.add_parser("set-variable"); add_dwe(s)
    s.add_argument("--name", required=True); s.add_argument("--expression", required=True)
    s.add_argument("--description")

    # Part studio mgmt
    s = sub.add_parser("create-part-studio"); add_dwe(s, elem=False); s.add_argument("--name", required=True)
    s = sub.add_parser("delete-feature"); add_dwe(s); s.add_argument("--feature", required=True)
    s = sub.add_parser("delete-element"); add_dwe(s)
    s = sub.add_parser("eval-featurescript"); add_dwe(s)
    s.add_argument("--script", default=""); s.add_argument("--script-file")
    s.add_argument("--raw", action="store_true",
                   help="return raw BTFSValue tree instead of decoded JSON")
    s = sub.add_parser("measure"); add_dwe(s)

    # Sketch (full)
    s = sub.add_parser("create-sketch"); add_dwe(s)
    s.add_argument("--name", default="Sketch"); s.add_argument("--plane", default="Front")
    s.add_argument("--entities", required=True, help="JSON array of sketch entities")
    # Sketch (simple)
    s = sub.add_parser("sketch-rectangle"); add_dwe(s)
    s.add_argument("--name", default="Sketch"); s.add_argument("--plane", default="Front")
    s.add_argument("--corner1", type=floats(2), required=True)
    s.add_argument("--corner2", type=floats(2), required=True)
    s = sub.add_parser("sketch-circle"); add_dwe(s)
    s.add_argument("--name", default="Sketch"); s.add_argument("--plane", default="Front")
    s.add_argument("--center", type=floats(2), required=True); s.add_argument("--radius", type=float, required=True)
    s = sub.add_parser("sketch-line"); add_dwe(s)
    s.add_argument("--name", default="Sketch"); s.add_argument("--plane", default="Front")
    s.add_argument("--start", type=floats(2), required=True); s.add_argument("--end", type=floats(2), required=True)

    # Extrude / hole
    for name in ("extrude", "hole"):
        s = sub.add_parser(name); add_dwe(s)
        s.add_argument("--name", default=name.capitalize())
        s.add_argument("--sketch", required=True)
        s.add_argument("--depth", type=float, required=True)
        s.add_argument("--depth-var")
        if name == "extrude":
            s.add_argument("--op", default="NEW", choices=["NEW", "ADD", "REMOVE", "INTERSECT"])

    s = sub.add_parser("thicken"); add_dwe(s)
    s.add_argument("--name", default="Thicken"); s.add_argument("--sketch", required=True)
    s.add_argument("--thickness", type=float, required=True)

    # Fillet / chamfer (the fixed ones)
    for name in ("fillet", "chamfer"):
        s = sub.add_parser(name); add_dwe(s)
        s.add_argument("--name", default=name.capitalize())
        s.add_argument("--edges", help="comma-separated deterministic edge IDs")
        s.add_argument("--feature", help="fillet/chamfer all edges of this feature ID")
        s.add_argument("--all", action="store_true", help="all edges of all bodies")
        s.add_argument("--circular", action="store_true", help="all circular edges")
        s.add_argument("--query", help="raw FeatureScript query string")
        if name == "fillet":
            s.add_argument("--radius", type=float, default=0.06)
            s.add_argument("--type", default="EDGE", choices=["EDGE", "FACE", "FULL_ROUND"])
        else:
            s.add_argument("--width", type=float, default=0.08)
            s.add_argument("--type", default="EQUAL_OFFSETS",
                           choices=["EQUAL_OFFSETS", "TWO_OFFSETS", "OFFSET_ANGLE"])
            s.add_argument("--angle", type=float)

    s = sub.add_parser("shell"); add_dwe(s)
    s.add_argument("--name", default="Shell"); s.add_argument("--thickness", type=float, default=0.125)
    s.add_argument("--faces", help="comma-separated face IDs to remove")
    s.add_argument("--query", help="FeatureScript query for faces to remove")
    s.add_argument("--outward", action="store_true")

    s = sub.add_parser("revolve"); add_dwe(s)
    s.add_argument("--name", default="Revolve"); s.add_argument("--sketch", required=True)
    s.add_argument("--axis", help="FeatureScript query for the axis")
    s.add_argument("--axis-ids", help="deterministic edge IDs for the axis (most reliable)")
    s.add_argument("--op", default="NEW", choices=["NEW", "ADD", "REMOVE", "INTERSECT"])
    s.add_argument("--type", default="FULL"); s.add_argument("--angle", type=float, default=360.0)

    s = sub.add_parser("boolean"); add_dwe(s)
    s.add_argument("--name", default="Boolean")
    s.add_argument("--op", default="UNION", choices=["UNION", "SUBTRACTION", "INTERSECTION"])
    s.add_argument("--tools", help="FeatureScript query for tool bodies")
    s.add_argument("--tool-ids", help="comma-separated body IDs")
    s.add_argument("--targets", help="FeatureScript query for targets (subtraction)")
    s.add_argument("--keep-tools", action="store_true")

    s = sub.add_parser("mirror"); add_dwe(s)
    s.add_argument("--name", default="Mirror"); s.add_argument("--type", default="PART")
    s.add_argument("--entities", required=True, help="FeatureScript query for entities")
    s.add_argument("--plane-ids", help="comma-separated plane IDs (e.g. JEC)")
    s.add_argument("--plane-query", help="FeatureScript query for mirror plane")

    s = sub.add_parser("linear-pattern"); add_dwe(s)
    s.add_argument("--name", default="Linear Pattern"); s.add_argument("--type", default="PART")
    s.add_argument("--entities", required=True)
    s.add_argument("--direction", help="FeatureScript query for the direction edge/axis")
    s.add_argument("--direction-ids", help="deterministic edge IDs for direction (most reliable)")
    s.add_argument("--distance", type=float, required=True); s.add_argument("--count", type=int, required=True)
    s.add_argument("--opposite", action="store_true")

    s = sub.add_parser("circular-pattern"); add_dwe(s)
    s.add_argument("--name", default="Circular Pattern"); s.add_argument("--type", default="PART")
    s.add_argument("--entities", required=True)
    s.add_argument("--axis", help="FeatureScript query for the axis edge")
    s.add_argument("--axis-ids", help="deterministic edge IDs for the axis (most reliable)")
    s.add_argument("--count", type=int, required=True); s.add_argument("--angle", type=float, default=360.0)
    s.add_argument("--no-equal-spacing", action="store_true")

    s = sub.add_parser("offset-plane"); add_dwe(s)
    s.add_argument("--name", default="Plane")
    s.add_argument("--base-ids", help="comma-separated base plane IDs")
    s.add_argument("--base-query"); s.add_argument("--offset", type=float, default=1.0)

    # Edges
    s = sub.add_parser("get-edges"); add_dwe(s)
    s = sub.add_parser("find-circular-edges"); add_dwe(s); s.add_argument("--radius", type=float)
    s = sub.add_parser("find-edges-by-feature"); add_dwe(s); s.add_argument("--feature", required=True)

    # Export / analysis
    s = sub.add_parser("mass-properties"); add_dwe(s); s.add_argument("--configuration")
    s = sub.add_parser("export-stl"); add_dwe(s)
    s.add_argument("--out", required=True); s.add_argument("--ascii", action="store_true")
    s.add_argument("--resolution", default="medium", choices=["coarse", "medium", "fine"])
    s.add_argument("--configuration")
    s = sub.add_parser("export"); add_dwe(s)
    s.add_argument("--out", required=True)
    s.add_argument("--format", default="STEP", help="STEP, IGES, 3MF, PARASOLID, ...")
    s.add_argument("--kind", default="partstudios",
                   choices=["partstudios", "assemblies", "drawings"])
    s.add_argument("--configuration")

    # Images (thumbnails + shaded renders)
    s = sub.add_parser("thumbnail-info"); add_dwe(s)
    s = sub.add_parser("get-thumbnail"); add_dwe(s)
    s.add_argument("--out", required=True)
    s.add_argument("--size", default="600x340",
                   help="thumbnail size, e.g. 600x340, 300x300, 70x40")
    s = sub.add_parser("shaded-view"); add_dwe(s)
    s.add_argument("--out", required=True)
    s.add_argument("--kind", default="partstudios",
                   choices=["partstudios", "assemblies"])
    s.add_argument("--width", type=int, default=600)
    s.add_argument("--height", type=int, default=340)
    s.add_argument("--view-matrix",
                   help="12-value 3x4 row-major camera matrix (default: isometric)")
    s.add_argument("--no-edges", action="store_true", help="hide model edges in the render")
    s.add_argument("--configuration")

    return p


def main(argv=None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        asyncio.run(run(args))
    except Exception as exc:  # noqa: BLE001
        import httpx
        if isinstance(exc, httpx.HTTPStatusError):
            try:
                detail = exc.response.json()
            except Exception:
                detail = exc.response.text[:1000]
            emit_error(f"HTTP {exc.response.status_code}", detail)
        else:
            emit_error(f"{type(exc).__name__}: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
