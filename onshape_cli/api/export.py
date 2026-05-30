"""Export, mass-properties, and translation helpers for Onshape."""

import asyncio
from typing import Any, Dict, List, Optional

from .client import OnshapeClient


class ExportManager:
    """Handles STL/STEP/3MF export and mass-properties queries."""

    def __init__(self, client: OnshapeClient):
        self.client = client

    async def mass_properties(
        self, document_id: str, workspace_id: str, element_id: str
    ) -> Dict[str, Any]:
        """Get mass properties (volume, mass, centroid) for a Part Studio."""
        path = (
            f"/api/v6/partstudios/d/{document_id}/w/{workspace_id}/e/{element_id}"
            "/massproperties"
        )
        return await self.client.get(path)

    async def export_stl(
        self,
        document_id: str,
        workspace_id: str,
        element_id: str,
        output_path: str,
        *,
        binary: bool = True,
        units: str = "inch",
        resolution: str = "medium",
        scale: float = 1.0,
    ) -> str:
        """Export a Part Studio to an STL file on disk (synchronous endpoint).

        Returns the output path written.
        """
        path = (
            f"/api/v6/partstudios/d/{document_id}/w/{workspace_id}/e/{element_id}/stl"
        )
        params = {
            "mode": "binary" if binary else "text",
            "units": units,
            "grouping": "true",
            "scale": scale,
            "resolution": resolution,
        }
        url = f"{self.client.base_url}{path}"
        headers = {
            "Authorization": self.client._get_auth_header(),
            "Accept": "application/vnd.onshape.v1+octet-stream",
        }
        self.client._ensure_client()
        # Onshape 307-redirects STL to a regional host (e.g. cad-usw2). httpx
        # strips the Authorization header on cross-host redirects, so follow the
        # redirect manually and re-attach auth each hop.
        resp = await self.client._client.get(
            url, params=params, headers=headers, follow_redirects=False
        )
        hops = 0
        while resp.status_code in (301, 302, 303, 307, 308) and hops < 5:
            location = resp.headers["location"]
            resp = await self.client._client.get(
                location, headers=headers, follow_redirects=False
            )
            hops += 1
        resp.raise_for_status()
        with open(output_path, "wb") as fh:
            fh.write(resp.content)
        return output_path

    async def export_translation(
        self,
        document_id: str,
        workspace_id: str,
        element_id: str,
        output_path: str,
        *,
        format_name: str = "STEP",
        poll_interval: float = 1.5,
        timeout: float = 120.0,
    ) -> str:
        """Export via the asynchronous translation API (STEP, IGES, 3MF, PARASOLID...).

        Creates a translation job, polls until DONE, then downloads the result.
        """
        # 1) Kick off the translation
        create_path = (
            f"/api/v6/partstudios/d/{document_id}/w/{workspace_id}/e/{element_id}"
            "/translations"
        )
        body = {
            "formatName": format_name,
            "storeInDocument": False,
            "flattenAssemblies": False,
        }
        job = await self.client.post(create_path, data=body)
        translation_id = job.get("id")
        if not translation_id:
            raise RuntimeError(f"Translation not started: {job}")

        # 2) Poll for completion
        elapsed = 0.0
        state = job.get("requestState", "ACTIVE")
        result: Dict[str, Any] = job
        while state == "ACTIVE" and elapsed < timeout:
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            result = await self.client.get(f"/api/v6/translations/{translation_id}")
            state = result.get("requestState", "ACTIVE")

        if state != "DONE":
            raise RuntimeError(f"Translation failed/timeout (state={state}): {result}")

        # 3) Download the external data
        external_ids: List[str] = result.get("resultExternalDataIds", [])
        if not external_ids:
            raise RuntimeError(f"No result data: {result}")
        result_did = result.get("resultDocumentId", document_id)
        dl_path = f"/api/v6/documents/d/{result_did}/externaldata/{external_ids[0]}"
        url = f"{self.client.base_url}{dl_path}"
        headers = {"Authorization": self.client._get_auth_header()}
        self.client._ensure_client()
        resp = await self.client._client.get(url, headers=headers, follow_redirects=True)
        resp.raise_for_status()
        with open(output_path, "wb") as fh:
            fh.write(resp.content)
        return output_path
