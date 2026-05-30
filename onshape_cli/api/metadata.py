"""Metadata (properties) support for Onshape elements and parts."""

from typing import Any, Dict, List, Optional

from .client import OnshapeClient


class MetadataManager:
    """Manager for Onshape metadata / properties."""

    def __init__(self, client: OnshapeClient):
        self.client = client

    async def get_element_metadata(
        self, document_id: str, workspace_id: str, element_id: str
    ) -> Dict[str, Any]:
        """Get metadata/properties for an element (tab)."""
        path = f"/api/v6/metadata/d/{document_id}/w/{workspace_id}/e/{element_id}"
        return await self.client.get(path)

    async def get_part_metadata(
        self, document_id: str, workspace_id: str, element_id: str, part_id: str
    ) -> Dict[str, Any]:
        """Get metadata/properties for a single part."""
        path = (
            f"/api/v6/metadata/d/{document_id}/w/{workspace_id}/e/{element_id}"
            f"/p/{part_id}"
        )
        return await self.client.get(path)

    async def set_element_metadata(
        self,
        document_id: str,
        workspace_id: str,
        element_id: str,
        properties: List[Dict[str, Any]],
        part_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Set element (or part) properties.

        ``properties`` is a list of ``{"propertyId": "...", "value": ...}``. Common
        property ids can be discovered from the corresponding GET call.
        """
        if part_id:
            path = (
                f"/api/v6/metadata/d/{document_id}/w/{workspace_id}/e/{element_id}"
                f"/p/{part_id}"
            )
        else:
            path = f"/api/v6/metadata/d/{document_id}/w/{workspace_id}/e/{element_id}"
        # Metadata writes use POST (PATCH returns 405). Only `editable` properties
        # with a non-null value are accepted; discover ids via get_*_metadata.
        return await self.client.post(path, data={"properties": properties})
