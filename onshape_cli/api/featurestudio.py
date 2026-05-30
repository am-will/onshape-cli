"""Feature Studio support -- create and edit custom FeatureScript elements.

A Feature Studio holds FeatureScript source that defines custom features. Once
imported into a Part Studio, those custom features can be added like any other
feature via the part-studio add-feature endpoint.
"""

from typing import Any, Dict

from .client import OnshapeClient


class FeatureStudioManager:
    """Manager for Onshape Feature Studios."""

    def __init__(self, client: OnshapeClient):
        self.client = client

    async def create(
        self, document_id: str, workspace_id: str, name: str
    ) -> Dict[str, Any]:
        """Create a new Feature Studio tab."""
        path = f"/api/v6/featurestudios/d/{document_id}/w/{workspace_id}"
        return await self.client.post(path, data={"name": name})

    async def get_contents(
        self, document_id: str, workspace_id: str, element_id: str
    ) -> Dict[str, Any]:
        """Get the FeatureScript source text of a Feature Studio."""
        path = f"/api/v6/featurestudios/d/{document_id}/w/{workspace_id}/e/{element_id}"
        return await self.client.get(path)

    async def set_contents(
        self, document_id: str, workspace_id: str, element_id: str, contents: str
    ) -> Dict[str, Any]:
        """Replace the FeatureScript source text of a Feature Studio."""
        path = f"/api/v6/featurestudios/d/{document_id}/w/{workspace_id}/e/{element_id}"
        return await self.client.post(path, data={"contents": contents})

    async def get_specs(
        self, document_id: str, workspace_id: str, element_id: str
    ) -> Dict[str, Any]:
        """Get the feature specs (custom feature definitions) a Feature Studio exports."""
        path = (
            f"/api/v6/featurestudios/d/{document_id}/w/{workspace_id}/e/{element_id}"
            "/featurespecs"
        )
        return await self.client.get(path)
