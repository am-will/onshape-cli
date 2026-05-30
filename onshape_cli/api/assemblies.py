"""Assembly management for Onshape (create, insert instances, mates, BOM, mass props).

Mates, mate connectors, groups, and patterns are all *assembly features* added
through the single ``POST .../features`` endpoint -- there is no per-mate-type
endpoint. ``add_feature`` therefore takes a raw feature definition; the helpers in
``builders/advanced.py`` (build_assembly_mate / build_assembly_mate_connector) emit
the right envelopes for the common cases.
"""

from typing import Any, Dict, List, Optional

from .client import OnshapeClient


class AssemblyManager:
    """Manager for Onshape assemblies."""

    def __init__(self, client: OnshapeClient):
        self.client = client

    # ---- create / read ----
    async def create_assembly(
        self, document_id: str, workspace_id: str, name: str
    ) -> Dict[str, Any]:
        """Create a new assembly tab in a document."""
        path = f"/api/v6/assemblies/d/{document_id}/w/{workspace_id}"
        return await self.client.post(path, data={"name": name})

    async def get_features(
        self, document_id: str, workspace_id: str, element_id: str
    ) -> Dict[str, Any]:
        """Get the assembly's features (mates, mate connectors, groups, patterns)."""
        path = f"/api/v6/assemblies/d/{document_id}/w/{workspace_id}/e/{element_id}/features"
        return await self.client.get(path)

    async def get_bom(
        self,
        document_id: str,
        workspace_id: str,
        element_id: str,
        *,
        indented: bool = True,
        multi_level: bool = False,
        generate_if_absent: bool = True,
    ) -> Dict[str, Any]:
        """Get the Bill of Materials for an assembly (creates a BOM element if absent)."""
        path = f"/api/v6/assemblies/d/{document_id}/w/{workspace_id}/e/{element_id}/bom"
        params = {
            "indented": str(indented).lower(),
            "multiLevel": str(multi_level).lower(),
            "generateIfAbsent": str(generate_if_absent).lower(),
        }
        return await self.client.get(path, params=params)

    async def mass_properties(
        self, document_id: str, workspace_id: str, element_id: str
    ) -> Dict[str, Any]:
        """Get mass/volume/centroid/inertia for the whole assembly."""
        path = (
            f"/api/v6/assemblies/d/{document_id}/w/{workspace_id}/e/{element_id}"
            "/massproperties"
        )
        return await self.client.get(path)

    # ---- write ----
    async def insert_instance(
        self,
        document_id: str,
        workspace_id: str,
        element_id: str,
        *,
        source_document_id: str,
        source_element_id: str,
        part_id: Optional[str] = None,
        source_version_id: Optional[str] = None,
        is_assembly: bool = False,
        is_whole_part_studio: bool = False,
        configuration: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Insert a part / Part Studio / sub-assembly instance into an assembly.

        For a single part pass ``part_id``; for an entire Part Studio set
        ``is_whole_part_studio=True``; for a sub-assembly set ``is_assembly=True``.
        Inserting from another document requires ``source_version_id``.
        """
        body: Dict[str, Any] = {
            "documentId": source_document_id,
            "elementId": source_element_id,
        }
        if source_version_id:
            body["versionId"] = source_version_id
        if part_id:
            body["partId"] = part_id
            body["includePartTypes"] = ["PARTS"]
        if is_assembly:
            body["isAssembly"] = True
        if is_whole_part_studio:
            body["isWholePartStudio"] = True
        if configuration:
            body["configuration"] = configuration
        path = f"/api/v6/assemblies/d/{document_id}/w/{workspace_id}/e/{element_id}/instances"
        return await self.client.post(path, data=body)

    async def add_feature(
        self, document_id: str, workspace_id: str, element_id: str, feature: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Add an assembly feature (mate, mate connector, group, pattern). Raw envelope."""
        path = f"/api/v6/assemblies/d/{document_id}/w/{workspace_id}/e/{element_id}/features"
        return await self.client.post(path, data=feature)

    async def delete_instance(
        self, document_id: str, workspace_id: str, element_id: str, node_id: str
    ) -> Dict[str, Any]:
        """Delete an instance occurrence by node id."""
        path = (
            f"/api/v6/assemblies/d/{document_id}/w/{workspace_id}/e/{element_id}"
            f"/instance/nodeid/{node_id}"
        )
        return await self.client.delete(path)

    async def transform_occurrences(
        self,
        document_id: str,
        workspace_id: str,
        element_id: str,
        occurrence_paths: List[List[str]],
        transform: List[float],
        *,
        is_relative: bool = True,
    ) -> Dict[str, Any]:
        """Apply a 4x4 (16-float, row-major) transform to the given occurrences.

        ``occurrence_paths`` is a list of paths (each a list of instance ids from
        ``get_assembly``). The transform's 4th column is translation in meters.
        """
        body = {
            "isRelative": is_relative,
            "occurrences": [{"path": p} for p in occurrence_paths],
            "transform": transform,
        }
        path = (
            f"/api/v6/assemblies/d/{document_id}/w/{workspace_id}/e/{element_id}"
            "/occurrencetransforms"
        )
        # Verified live: occurrencetransforms is POST (PATCH returns 405).
        return await self.client.post(path, data=body)
