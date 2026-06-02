import type { OnshapeClient } from "./client";

/** Element/part properties. Port of onshape_cli/api/metadata.py. */
export class MetadataManager {
  constructor(private readonly client: OnshapeClient) {}

  async getElementMetadata(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}`);
  }

  async getPartMetadata(documentId: string, workspaceId: string, elementId: string, partId: string): Promise<unknown> {
    return this.client.get(`/api/v6/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}/p/${partId}`);
  }

  /** Set element (or part) properties. `properties` is [{propertyId, value}, ...].
   *  POST (PATCH returns 405); only editable, non-null properties are accepted. */
  async setElementMetadata(
    documentId: string,
    workspaceId: string,
    elementId: string,
    properties: Array<Record<string, unknown>>,
    partId?: string,
  ): Promise<unknown> {
    const path = partId
      ? `/api/v6/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}/p/${partId}`
      : `/api/v6/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}`;
    return this.client.post(path, { properties });
  }
}
