"""Configuration support for Onshape Part Studios / Assemblies.

Workflow:
  1. ``get_configuration`` -> discover each input's parameterId, type, options, default.
  2. ``encode_configuration`` -> turn a list of {parameterId, parameterValue} into the
     canonical encoded string (``encodedId`` for POST bodies, ``queryParam`` for GET URLs).
  3. apply the encoded string via the ``--configuration`` flag on exports / mass-props /
     get-features.
"""

from typing import Any, Dict, List

from .client import OnshapeClient


class ConfigurationManager:
    """Manager for Onshape configurations."""

    def __init__(self, client: OnshapeClient):
        self.client = client

    async def get_configuration(
        self, document_id: str, workspace_id: str, element_id: str
    ) -> Dict[str, Any]:
        """Get the configuration definition (inputs + current values) of an element."""
        path = (
            f"/api/v6/elements/d/{document_id}/w/{workspace_id}/e/{element_id}"
            "/configuration"
        )
        return await self.client.get(path)

    async def encode_configuration(
        self,
        document_id: str,
        element_id: str,
        parameters: List[Dict[str, str]],
    ) -> Dict[str, Any]:
        """Encode ``[{parameterId, parameterValue}, ...]`` into the canonical strings.

        Returns ``{encodedId, queryParam}``: use ``encodedId`` in a POST body's
        ``configuration`` field, or append ``queryParam`` (already ``configuration=...``)
        to a GET URL. Note: no workspace segment on this endpoint.
        """
        path = f"/api/v6/elements/d/{document_id}/e/{element_id}/configurationencodings"
        return await self.client.post(path, data={"parameters": parameters})
