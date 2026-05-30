"""Edge query utilities for Onshape."""

from typing import Any, Dict, List, Optional
from .client import OnshapeClient


def decode_fs_value(node: Any) -> Any:
    """Recursively decode an Onshape FeatureScript result value into plain Python.

    The ``/featurescript`` endpoint returns deeply nested ``BTFSValue*`` objects.
    This walks them into ordinary dicts / lists / scalars.
    """
    if not isinstance(node, dict):
        return node
    bt = node.get("btType", "")
    if "BTFSValueMap" in bt:
        out: Dict[str, Any] = {}
        for entry in node.get("value", []):
            key = decode_fs_value(entry.get("key"))
            val = decode_fs_value(entry.get("value"))
            out[str(key)] = val
        return out
    if "BTFSValueArray" in bt:
        return [decode_fs_value(v) for v in node.get("value", [])]
    if "BTFSValueWithUnits" in bt:
        # numeric value already scaled to base SI by FS; return raw number
        return node.get("value")
    if "BTFSValueUndefined" in bt:
        return None
    if any(t in bt for t in ("BTFSValueNumber", "BTFSValueString", "BTFSValueBoolean")):
        return node.get("value")
    # Fallback: top-level result wrapper may nest under "message"
    if "message" in node:
        return decode_fs_value(node["message"])
    if "value" in node:
        return decode_fs_value(node["value"])
    return node


def _unwrap_fs_result(response: Dict[str, Any]) -> Any:
    """Pull the decoded value out of a raw featurescript POST response."""
    if not isinstance(response, dict):
        return None
    result = response.get("result")
    if result is None:
        return None
    return decode_fs_value(result)


class EdgeQuery:
    """Helper class for querying and filtering edges in Onshape parts."""

    def __init__(self, client: OnshapeClient):
        """Initialize the edge query helper.

        Args:
            client: Onshape API client
        """
        self.client = client

    async def get_edges(
        self,
        document_id: str,
        workspace_id: str,
        element_id: str,
    ) -> Dict[str, Any]:
        """Get all edges from a Part Studio using FeatureScript.

        Args:
            document_id: Document ID
            workspace_id: Workspace ID
            element_id: Part Studio element ID

        Returns:
            Dictionary containing edge information
        """
        # Use the bodydetails topology endpoint -- it returns edges as plain JSON
        # (id + geometry type + radius for circles), which is far more reliable
        # than decoding nested FeatureScript values.
        path = (
            f"/api/v6/partstudios/d/{document_id}/w/{workspace_id}/e/{element_id}"
            "/bodydetails?includeTopology=true"
        )
        response = await self.client.get(path)
        edges: List[Dict[str, Any]] = []
        bodies = response.get("bodies", []) if isinstance(response, dict) else []
        for body in bodies:
            body_id = body.get("id")
            for edge in body.get("edges", []) or []:
                geom = edge.get("geometry", {}) or {}
                gtype = geom.get("type") or edge.get("geometryType")
                if not gtype:
                    bt = geom.get("btType", "")
                    if "radius" in geom or "Circle" in bt or "Arc" in bt:
                        gtype = "arc" if geom.get("startPoint") != geom.get("endPoint") and "radius" in geom else "circle"
                    elif "startPoint" in geom and "endPoint" in geom:
                        gtype = "line"
                    else:
                        gtype = "unknown"
                info: Dict[str, Any] = {
                    "id": edge.get("id"),
                    "body": body_id,
                    "type": str(gtype).lower(),
                }
                # radius (in metres -> inches) when present (circles/arcs)
                radius = geom.get("radius")
                if radius is not None:
                    info["radius"] = radius / 0.0254
                edges.append(info)
        return {"edges": edges, "count": len(edges), "bodyCount": len(bodies)}

    async def find_circular_edges(
        self,
        document_id: str,
        workspace_id: str,
        element_id: str,
        radius: Optional[float] = None,
        tolerance: float = 0.001,
    ) -> List[str]:
        """Find circular edges, optionally filtered by radius.

        Args:
            document_id: Document ID
            workspace_id: Workspace ID
            element_id: Part Studio element ID
            radius: Optional radius to filter by (in inches)
            tolerance: Radius match tolerance (in inches)

        Returns:
            List of deterministic edge IDs
        """
        all_edges = await self.get_edges(document_id, workspace_id, element_id)

        circular_edges = []
        edges = all_edges.get("edges", []) if isinstance(all_edges, dict) else []

        for edge in edges:
            if not isinstance(edge, dict) or "radius" not in edge:
                continue
            edge_radius = edge["radius"]
            if radius is None or abs(edge_radius - radius) <= tolerance:
                circular_edges.append(edge)

        return circular_edges

    async def find_edges_by_feature(
        self,
        document_id: str,
        workspace_id: str,
        element_id: str,
        feature_id: str,
    ) -> List[str]:
        """Find edges created by a specific feature.

        Args:
            document_id: Document ID
            workspace_id: Workspace ID
            element_id: Part Studio element ID
            feature_id: Feature ID to query

        Returns:
            List of deterministic edge IDs
        """
        script = f"""
        function(context is Context, queries) {{
            const feature = qCreatedBy(makeId("{feature_id}"), EntityType.EDGE);
            const edges = evaluateQuery(context, feature);

            const edgeIds = [];
            for (var edge in edges) {{
                try {{
                    const detId = toString(qDeterministicIdQuery(edge));
                    edgeIds = append(edgeIds, detId);
                }} catch {{}}
            }}

            return edgeIds;
        }}
        """

        path = (
            f"/api/v6/partstudios/d/{document_id}/w/{workspace_id}/e/{element_id}"
            "/featurescript"
        )
        data = {"script": script}
        response = await self.client.post(path, data=data)
        decoded = _unwrap_fs_result(response)
        if isinstance(decoded, list):
            return decoded
        return []
