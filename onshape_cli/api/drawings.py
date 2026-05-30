"""Drawing support for Onshape.

The Drawings API surface is deliberately small: one endpoint creates a drawing,
one (``modify``) does all editing via a typed ``jsonRequests`` batch, two are
read-only (views list + view geometry), and export goes through the drawing
translation endpoint.

Note: drawing creation references the source by *version* (``externalDocumentVersionId``),
not workspace -- create a version first (``create-version``). On free accounts this
flow may be restricted; treat create/export as experimental until verified.
"""

from typing import Any, Dict, Optional

from .client import OnshapeClient


class DrawingManager:
    """Manager for Onshape drawings."""

    def __init__(self, client: OnshapeClient):
        self.client = client

    async def create_drawing(
        self,
        document_id: str,
        workspace_id: str,
        *,
        name: str,
        source_element_id: str,
        source_version_id: str,
        source_document_id: Optional[str] = None,
        part_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a drawing of a part / Part Studio / assembly (from a version)."""
        body: Dict[str, Any] = {
            "drawingName": name,
            "externalDocumentId": source_document_id or document_id,
            "externalDocumentVersionId": source_version_id,
            "elementId": source_element_id,
        }
        if part_id:
            body["partId"] = part_id
        path = f"/api/v6/drawings/d/{document_id}/w/{workspace_id}/create"
        return await self.client.post(path, data=body)

    async def get_views(
        self, document_id: str, workspace_id: str, element_id: str
    ) -> Dict[str, Any]:
        """List all views in a drawing."""
        path = f"/api/v6/drawings/d/{document_id}/w/{workspace_id}/e/{element_id}/views"
        return await self.client.get(path)

    async def modify(
        self,
        document_id: str,
        workspace_id: str,
        element_id: str,
        json_requests: list,
        description: str = "API edit",
    ) -> Dict[str, Any]:
        """Add/edit views, dimensions, and annotations via a ``jsonRequests`` batch."""
        path = f"/api/v6/drawings/d/{document_id}/w/{workspace_id}/e/{element_id}/modify"
        body = {"description": description, "jsonRequests": json_requests}
        return await self.client.post(path, data=body)

    async def translation_formats(
        self, document_id: str, workspace_id: str, element_id: str
    ) -> Dict[str, Any]:
        """List available drawing export formats."""
        path = (
            f"/api/v6/drawings/d/{document_id}/w/{workspace_id}/e/{element_id}"
            "/translationformats"
        )
        return await self.client.get(path)
