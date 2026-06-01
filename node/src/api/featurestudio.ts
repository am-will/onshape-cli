import { readFileSync } from "node:fs";

import type { OnshapeClient } from "./client";

export class FeatureStudioManager {
  constructor(private readonly client: OnshapeClient) {}

  async create(documentId: string, workspaceId: string, name: string): Promise<unknown> {
    return this.client.post(`/api/v6/featurestudios/d/${documentId}/w/${workspaceId}`, { name });
  }

  async getContents(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/featurestudios/d/${documentId}/w/${workspaceId}/e/${elementId}`);
  }

  async setContents(documentId: string, workspaceId: string, elementId: string, contents: string): Promise<unknown> {
    return this.client.post(`/api/v6/featurestudios/d/${documentId}/w/${workspaceId}/e/${elementId}`, { contents });
  }

  async getSpecs(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/featurestudios/d/${documentId}/w/${workspaceId}/e/${elementId}/featurespecs`);
  }
}

export function loadText(inline?: string, file?: string): string {
  const raw = file ? readFileSync(file, "utf8") : inline;
  if (!raw) throw new Error("Expected text via --contents or --contents-file");
  return raw;
}
