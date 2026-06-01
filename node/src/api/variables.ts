import type { OnshapeClient } from "./client";

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Part Studio variable table. Port of onshape_cli/api/variables.py. */
export class VariableManager {
  constructor(private readonly client: OnshapeClient) {}

  async getVariables(documentId: string, workspaceId: string, elementId: string): Promise<unknown[]> {
    const response = await this.client.get(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/variables`);
    const items = Array.isArray(response) ? response : [];
    return items.map((item) => ({
      name: isRecord(item) ? item.name ?? "" : "",
      expression: isRecord(item) ? item.expression ?? "" : "",
      description: isRecord(item) ? item.description ?? null : null,
    }));
  }

  async setVariable(
    documentId: string,
    workspaceId: string,
    elementId: string,
    name: string,
    expression: string,
    description?: string,
  ): Promise<unknown> {
    const data: Record<string, unknown> = { name, expression };
    if (description) data.description = description;
    return this.client.post(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/variables`, data);
  }
}
