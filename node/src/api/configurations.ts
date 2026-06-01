import type { OnshapeClient } from "./client";

/** Element configurations. Port of onshape_cli/api/configurations.py. */
export class ConfigurationManager {
  constructor(private readonly client: OnshapeClient) {}

  async getConfiguration(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    return this.client.get(`/api/v6/elements/d/${documentId}/w/${workspaceId}/e/${elementId}/configuration`);
  }

  /** Encode [{parameterId, parameterValue}, ...] -> {encodedId, queryParam}. No ws segment. */
  async encodeConfiguration(
    documentId: string,
    elementId: string,
    parameters: Array<Record<string, string>>,
  ): Promise<unknown> {
    return this.client.post(`/api/v6/elements/d/${documentId}/e/${elementId}/configurationencodings`, { parameters });
  }
}
