import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import type { OnshapeClient } from "./client";

// Isometric camera (3x4 row-major view matrix) — a sensible default.
const ISO_VIEW = "0.707,0.707,0,0,-0.408,0.408,0.816,0,0.577,-0.577,0.577,0";

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** STL/STEP/3MF export, thumbnails, shaded renders, and mass properties.
 *  Port of onshape_cli/api/export.py. */
export class ExportManager {
  constructor(private readonly client: OnshapeClient) {}

  async massProperties(documentId: string, workspaceId: string, elementId: string, configuration?: string): Promise<unknown> {
    return this.client.get(`/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/massproperties`, {
      configuration,
    });
  }

  async exportStl(
    documentId: string,
    workspaceId: string,
    elementId: string,
    outputPath: string,
    opts: { binary?: boolean; units?: string; resolution?: string; scale?: number; configuration?: string } = {},
  ): Promise<string> {
    const path = `/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/stl`;
    const { buffer } = await this.client.getBinary(
      path,
      {
        mode: opts.binary === false ? "text" : "binary",
        units: opts.units ?? "inch",
        grouping: "true",
        scale: opts.scale ?? 1.0,
        resolution: opts.resolution ?? "medium",
        configuration: opts.configuration,
      },
      "application/vnd.onshape.v1+octet-stream",
    );
    writeFileSync(outputPath, buffer);
    return outputPath;
  }

  async exportTranslation(
    documentId: string,
    workspaceId: string,
    elementId: string,
    outputPath: string,
    opts: {
      formatName?: string;
      elementKind?: string;
      configuration?: string;
      pollInterval?: number;
      timeout?: number;
    } = {},
  ): Promise<string> {
    const formatName = opts.formatName ?? "STEP";
    const elementKind = opts.elementKind ?? "partstudios";
    const pollInterval = opts.pollInterval ?? 1.5;
    const timeout = opts.timeout ?? 120.0;

    const createPath = `/api/v6/${elementKind}/d/${documentId}/w/${workspaceId}/e/${elementId}/translations`;
    const body: Record<string, unknown> = { formatName, storeInDocument: false, flattenAssemblies: false };
    if (opts.configuration) body.configuration = opts.configuration;

    const job = (await this.client.post(createPath, body)) as Record<string, any>;
    const translationId = isRecord(job) ? job.id : undefined;
    if (!translationId) throw new Error(`Translation not started: ${JSON.stringify(job)}`);

    let elapsed = 0;
    let state = (isRecord(job) && job.requestState) || "ACTIVE";
    let result: Record<string, any> = job;
    while (state === "ACTIVE" && elapsed < timeout) {
      await sleep(pollInterval * 1000);
      elapsed += pollInterval;
      result = (await this.client.get(`/api/v6/translations/${translationId}`)) as Record<string, any>;
      state = (isRecord(result) && result.requestState) || "ACTIVE";
    }
    if (state !== "DONE") throw new Error(`Translation failed/timeout (state=${state}): ${JSON.stringify(result)}`);

    const externalIds: string[] = (isRecord(result) && Array.isArray(result.resultExternalDataIds) ? result.resultExternalDataIds : []) as string[];
    if (!externalIds.length) throw new Error(`No result data: ${JSON.stringify(result)}`);
    const resultDid = (isRecord(result) && result.resultDocumentId) || documentId;
    const { buffer } = await this.client.getBinary(`/api/v6/documents/d/${resultDid}/externaldata/${externalIds[0]}`);
    writeFileSync(outputPath, buffer);
    return outputPath;
  }

  async thumbnailInfo(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/thumbnails/d/${documentId}/w/${workspaceId}/e/${elementId}`);
  }

  async getThumbnail(
    documentId: string,
    workspaceId: string,
    elementId: string,
    outputPath: string,
    opts: { size?: string } = {},
  ): Promise<string> {
    const size = opts.size ?? "600x340";
    const info = (await this.thumbnailInfo(documentId, workspaceId, elementId)) as Record<string, any>;
    const sizes: Array<Record<string, any>> = isRecord(info) && Array.isArray(info.sizes) ? info.sizes : [];
    if (!sizes.length) {
      throw new Error(
        "No thumbnail available yet — Onshape renders thumbnails asynchronously; retry shortly after the element is created/edited.",
      );
    }
    const chosen = sizes.find((s) => s.size === size) ?? sizes[0];
    const href = chosen.href;
    if (!href) throw new Error(`Thumbnail entry has no href: ${JSON.stringify(chosen)}`);
    const { buffer } = await this.client.getBinaryUrl(String(href));
    writeFileSync(outputPath, buffer);
    return outputPath;
  }

  async shadedView(
    documentId: string,
    workspaceId: string,
    elementId: string,
    outputPath: string,
    opts: {
      elementKind?: string;
      width?: number;
      height?: number;
      viewMatrix?: string;
      showEdges?: boolean;
      configuration?: string;
    } = {},
  ): Promise<string> {
    const elementKind = opts.elementKind ?? "partstudios";
    const path = `/api/v6/${elementKind}/d/${documentId}/w/${workspaceId}/e/${elementId}/shadedviews`;
    const params: Record<string, string | number | boolean | undefined> = {
      viewMatrix: opts.viewMatrix ?? ISO_VIEW,
      outputWidth: opts.width ?? 600,
      outputHeight: opts.height ?? 340,
      pixelSize: 0,
    };
    if (opts.showEdges ?? true) {
      params.edges = "show";
      params.showAllParts = "true";
    }
    if (opts.configuration) params.configuration = opts.configuration;
    const resp = (await this.client.get(path, params)) as Record<string, any>;
    const images: string[] = isRecord(resp) && Array.isArray(resp.images) ? resp.images : [];
    if (!images.length) throw new Error(`No shaded image returned: ${JSON.stringify(resp)}`);
    writeFileSync(outputPath, Buffer.from(images[0], "base64"));
    return outputPath;
  }
}
