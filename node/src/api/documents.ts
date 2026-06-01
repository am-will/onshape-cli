import type { OnshapeClient } from "./client";

export class DocumentManager {
  constructor(private readonly client: OnshapeClient) {}

  async listDocuments(options: {
    filterType?: number;
    sortBy?: string;
    sortOrder?: string;
    limit?: number;
    offset?: number;
  }): Promise<unknown[]> {
    const response = await this.client.get("/api/v6/documents", {
      sortColumn: options.sortBy ?? "modifiedAt",
      sortOrder: options.sortOrder ?? "desc",
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
      filter: options.filterType,
    });
    return normalizeDocumentList(response);
  }

  async searchDocuments(query: string, limit = 20, documentFilter = 0): Promise<unknown[]> {
    const response = await this.client.get("/api/v6/documents", {
      q: query,
      limit,
      filter: documentFilter || undefined,
    });
    return normalizeDocumentList(response);
  }

  async getDocument(documentId: string): Promise<unknown> {
    return normalizeDocument(await this.client.get(`/api/v6/documents/${documentId}`));
  }

  async createDocument(name: string, isPublic = false, description?: string): Promise<unknown> {
    return this.client.post("/api/v6/documents", {
      name,
      isPublic,
      ...(description ? { description } : {}),
    });
  }

  async deleteDocument(documentId: string): Promise<unknown> {
    return this.client.delete(`/api/v6/documents/${documentId}`);
  }

  async updateDocument(documentId: string, name?: string, description?: string): Promise<unknown> {
    return this.client.post(`/api/v6/documents/${documentId}`, {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
    });
  }

  async getVersions(documentId: string): Promise<unknown> {
    return this.client.get(`/api/v6/documents/d/${documentId}/versions`);
  }

  async createVersion(documentId: string, workspaceId: string, name: string, description?: string): Promise<unknown> {
    return this.client.post(`/api/v6/documents/d/${documentId}/versions`, {
      documentId,
      workspaceId,
      name,
      ...(description ? { description } : {}),
    });
  }

  async getWorkspaces(documentId: string): Promise<unknown[]> {
    const response = await this.client.get(`/api/v6/documents/d/${documentId}/workspaces`);
    const items = Array.isArray(response) ? response : [];
    return items.map(normalizeWorkspace);
  }

  async getElements(documentId: string, workspaceId: string, elementType?: string): Promise<unknown[]> {
    const response = await this.client.get(`/api/v6/documents/d/${documentId}/w/${workspaceId}/elements`);
    const items = Array.isArray(response) ? response : [];
    return items.map(normalizeElement).filter((element) => {
      if (!elementType) return true;
      const normalizedElementType = String(element.element_type ?? "").replaceAll(" ", "").toUpperCase();
      const normalizedFilter = elementType.replaceAll(" ", "").toUpperCase();
      return normalizedElementType === normalizedFilter;
    });
  }

  async findPartStudios(documentId: string, workspaceId: string, namePattern?: string): Promise<unknown[]> {
    const elements = await this.getElements(documentId, workspaceId, "PARTSTUDIO");
    if (!namePattern) return elements;
    const pattern = namePattern.toLowerCase();
    return elements.filter((element) => String((element as Record<string, unknown>).name ?? "").toLowerCase().includes(pattern));
  }

  async getDocumentSummary(documentId: string): Promise<unknown> {
    const document = await this.getDocument(documentId);
    const workspaces = await this.getWorkspaces(documentId);
    const workspaceDetails = [];
    for (const workspace of workspaces) {
      const workspaceRecord = workspace as Record<string, unknown>;
      const elements = await this.getElements(documentId, String(workspaceRecord.id));
      workspaceDetails.push({ workspace, elements });
    }
    return { document, workspaces, workspace_details: workspaceDetails };
  }
}

export function normalizeDocumentList(response: unknown): unknown[] {
  const items = isRecord(response) && Array.isArray(response.items) ? response.items : [];
  return items.map(normalizeDocument).filter(Boolean);
}

export function normalizeDocument(response: unknown): Record<string, unknown> | null {
  if (!isRecord(response)) return null;
  const owner = isRecord(response.owner) ? response.owner : {};
  const thumbnail = isRecord(response.thumbnail) ? response.thumbnail.href : null;
  return {
    id: response.id ?? null,
    name: response.name ?? null,
    created_at: response.createdAt ?? null,
    modified_at: response.modifiedAt ?? null,
    owner_id: owner.id ?? "",
    owner_name: owner.name ?? null,
    public: response.public ?? false,
    description: response.description ?? null,
    thumbnail,
  };
}

function normalizeWorkspace(response: unknown): Record<string, unknown> {
  const item = isRecord(response) ? response : {};
  return {
    id: item.id ?? null,
    name: item.name ?? null,
    is_main: item.isMain ?? false,
    created_at: item.createdAt ?? null,
    modified_at: item.modifiedAt ?? null,
  };
}

function normalizeElement(response: unknown): Record<string, unknown> {
  const item = isRecord(response) ? response : {};
  return {
    id: item.id ?? null,
    name: item.name ?? null,
    element_type: item.type ?? "UNKNOWN",
    data_type: item.dataType ?? null,
    thumbnail: item.thumbnail ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
