"""Export, mass-properties, and translation helpers for Onshape."""

import asyncio
from typing import Any, Dict, List, Optional

from .client import OnshapeClient


class ExportManager:
    """Handles STL/STEP/3MF export and mass-properties queries."""

    def __init__(self, client: OnshapeClient):
        self.client = client

    async def mass_properties(
        self,
        document_id: str,
        workspace_id: str,
        element_id: str,
        configuration: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get mass properties (volume, mass, centroid) for a Part Studio."""
        path = (
            f"/api/v6/partstudios/d/{document_id}/w/{workspace_id}/e/{element_id}"
            "/massproperties"
        )
        params = {"configuration": configuration} if configuration else None
        return await self.client.get(path, params=params)

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
        configuration: Optional[str] = None,
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
        if configuration:
            params["configuration"] = configuration
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
        element_kind: str = "partstudios",
        configuration: Optional[str] = None,
        poll_interval: float = 1.5,
        timeout: float = 120.0,
    ) -> str:
        """Export via the asynchronous translation API (STEP, IGES, 3MF, PARASOLID...).

        Creates a translation job, polls until DONE, then downloads the result.
        ``element_kind`` is ``partstudios``, ``assemblies``, or ``drawings``.
        """
        # 1) Kick off the translation
        create_path = (
            f"/api/v6/{element_kind}/d/{document_id}/w/{workspace_id}/e/{element_id}"
            "/translations"
        )
        body = {
            "formatName": format_name,
            "storeInDocument": False,
            "flattenAssemblies": False,
        }
        if configuration:
            body["configuration"] = configuration
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

    async def thumbnail_info(
        self, document_id: str, workspace_id: str, element_id: str
    ) -> Dict[str, Any]:
        """List an element's available thumbnail sizes + hrefs.

        Onshape renders thumbnails asynchronously, so a freshly-created element may
        return an empty ``sizes`` list until rendering catches up.
        """
        path = f"/api/v6/thumbnails/d/{document_id}/w/{workspace_id}/e/{element_id}"
        return await self.client.get(path)

    async def get_thumbnail(
        self,
        document_id: str,
        workspace_id: str,
        element_id: str,
        output_path: str,
        *,
        size: str = "600x340",
    ) -> str:
        """Download an element's rendered thumbnail PNG to disk.

        Picks the requested ``size`` (or the first available), then downloads its
        ``href`` following the regional redirect with auth re-attached (httpx drops
        it on cross-host redirects). Raises if no thumbnail exists yet.
        """
        info = await self.thumbnail_info(document_id, workspace_id, element_id)
        sizes = info.get("sizes", []) or []
        if not sizes:
            raise RuntimeError(
                "No thumbnail available yet — Onshape renders thumbnails "
                "asynchronously; retry shortly after the element is created/edited."
            )
        chosen = next((s for s in sizes if s.get("size") == size), None) or sizes[0]
        href = chosen.get("href")
        if not href:
            raise RuntimeError(f"Thumbnail entry has no href: {chosen}")
        headers = {"Authorization": self.client._get_auth_header(), "Accept": "*/*"}
        self.client._ensure_client()
        resp = await self.client._client.get(href, headers=headers, follow_redirects=False)
        hops = 0
        while resp.status_code in (301, 302, 303, 307, 308) and hops < 5:
            resp = await self.client._client.get(
                resp.headers["location"], headers=headers, follow_redirects=False
            )
            hops += 1
        resp.raise_for_status()
        with open(output_path, "wb") as fh:
            fh.write(resp.content)
        return output_path

    # Isometric camera (3x4 row-major view matrix) — a sensible default.
    _ISO_VIEW = "0.707,0.707,0,0,-0.408,0.408,0.816,0,0.577,-0.577,0.577,0"

    async def shaded_view(
        self,
        document_id: str,
        workspace_id: str,
        element_id: str,
        output_path: str,
        *,
        element_kind: str = "partstudios",
        width: int = 600,
        height: int = 340,
        view_matrix: Optional[str] = None,
        show_edges: bool = True,
        configuration: Optional[str] = None,
    ) -> str:
        """Render a shaded PNG of a part studio or assembly and write it to disk.

        ``/shadedviews`` returns ``{"images": [base64-png, ...]}``; we decode the
        first image. ``view_matrix`` is a 12-value (3x4 row-major) camera; the
        default is isometric. ``element_kind`` is ``partstudios`` or ``assemblies``.
        """
        import base64

        path = (
            f"/api/v6/{element_kind}/d/{document_id}/w/{workspace_id}/e/{element_id}"
            "/shadedviews"
        )
        params: Dict[str, Any] = {
            "viewMatrix": view_matrix or self._ISO_VIEW,
            "outputWidth": width,
            "outputHeight": height,
            "pixelSize": 0,
        }
        if show_edges:
            params["edges"] = "show"
            params["showAllParts"] = "true"
        if configuration:
            params["configuration"] = configuration
        resp = await self.client.get(path, params=params)
        images = resp.get("images", []) if isinstance(resp, dict) else []
        if not images:
            raise RuntimeError(f"No shaded image returned: {resp}")
        with open(output_path, "wb") as fh:
            fh.write(base64.b64decode(images[0]))
        return output_path
