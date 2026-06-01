import { readFileSync } from "node:fs";

import type { OnshapeClient } from "./client";

export interface FeatureValidation {
  featureId: string;
  featureStatus: string | null;
}

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

  async validateFeature(
    documentId: string,
    workspaceId: string,
    elementId: string,
    featureId: string,
  ): Promise<FeatureValidation> {
    const features = await this.getFeatures(documentId, workspaceId, elementId);
    const states = isRecord(features) && isRecord(features.featureStates) ? features.featureStates : {};
    const state = isRecord(states[featureId]) ? states[featureId] : {};
    const status = typeof state.featureStatus === "string" ? state.featureStatus : null;
    if (status === "ERROR") {
      throw new Error(`Feature ${featureId} regenerated with status ERROR.`);
    }
    return { featureId, featureStatus: status };
  }

  async validatePartStudio(
    documentId: string,
    workspaceId: string,
    elementId: string,
    expectations: { parts?: number; bodies?: number } = {},
  ): Promise<Record<string, unknown>> {
    const partsRaw = await this.getParts(documentId, workspaceId, elementId);
    const parts = Array.isArray(partsRaw) ? partsRaw : [];
    const massRaw = await this.client.get(`/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/massproperties`);
    const bodiesRecord = isRecord(massRaw) && isRecord(massRaw.bodies) ? massRaw.bodies : {};
    const bodyCount = Object.keys(bodiesRecord).length;

    if (expectations.parts !== undefined && parts.length !== expectations.parts) {
      throw new Error(`Expected ${expectations.parts} part(s), found ${parts.length}.`);
    }
    if (expectations.bodies !== undefined && bodyCount !== expectations.bodies) {
      throw new Error(`Expected ${expectations.bodies} bod(y/ies), found ${bodyCount}.`);
    }

    return {
      parts: parts.length,
      bodies: bodyCount,
      partIds: parts.map((part) => (isRecord(part) ? part.partId : undefined)).filter(Boolean),
    };
  }
}

export function loadJson(inline?: string, file?: string): unknown {
  const raw = file ? readFileSync(file, "utf8") : inline;
  if (!raw) throw new Error("Expected JSON via --json or --json-file");
  return JSON.parse(raw);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
