import { readFileSync } from "node:fs";

import type { OnshapeClient } from "./client";

export class PartStudioManager {
  constructor(private readonly client: OnshapeClient) {}

  async getFeatures(documentId: string, workspaceId: string, elementId: string, configuration?: string): Promise<unknown> {
    return this.client.get(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features`, {
      configuration,
    });
  }

  async getFeatureSpecs(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/featurespecs`);
  }

  async getSketchInfo(
    documentId: string,
    workspaceId: string,
    elementId: string,
    sketchId?: string,
  ): Promise<unknown> {
    return this.client.get(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/sketches`, {
      includeGeometry: "true",
      sketchId,
    });
  }

  async getBodyDetails(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/bodydetails`, {
      includeTopology: "true",
    });
  }

  async getParts(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v9/parts/d/${documentId}/w/${workspaceId}/e/${elementId}`);
  }

  async createPartStudio(documentId: string, workspaceId: string, name: string): Promise<unknown> {
    return this.client.post(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}`, { name });
  }

  async deleteFeature(documentId: string, workspaceId: string, elementId: string, featureId: string): Promise<unknown> {
    return this.client.delete(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features/featureid/${featureId}`);
  }

  async addFeature(documentId: string, workspaceId: string, elementId: string, feature: unknown): Promise<unknown> {
    return this.client.post(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features`, feature);
  }

  async updateFeature(
    documentId: string,
    workspaceId: string,
    elementId: string,
    featureId: string,
    feature: unknown,
  ): Promise<unknown> {
    return this.client.post(
      `/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features/featureid/${featureId}`,
      feature,
    );
  }

  async rollback(documentId: string, workspaceId: string, elementId: string, index: number): Promise<unknown> {
    return this.client.post(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features/rollback`, {
      rollbackIndex: index,
    });
  }
}

export function loadJson(inline?: string, file?: string): unknown {
  const raw = file ? readFileSync(file, "utf8") : inline;
  if (!raw) throw new Error("Expected JSON via --json or --json-file");
  return JSON.parse(raw);
}
