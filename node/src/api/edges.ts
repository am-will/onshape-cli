import type { OnshapeClient } from "./client";
import { unwrapFeatureScriptResult } from "./fsvalue";

const INCH_TO_METER = 0.0254;

export class EdgeQuery {
  constructor(private readonly client: OnshapeClient) {}

  async getEdges(documentId: string, workspaceId: string, elementId: string): Promise<unknown> {
    const response = await this.client.get(`/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/bodydetails`, {
      includeTopology: "true",
    });
    const bodies = isRecord(response) && Array.isArray(response.bodies) ? response.bodies : [];
    const edges = [];
    for (const body of bodies) {
      if (!isRecord(body)) continue;
      const bodyId = body.id;
      const bodyEdges = Array.isArray(body.edges) ? body.edges : [];
      for (const edge of bodyEdges) {
        if (!isRecord(edge)) continue;
        const geom = isRecord(edge.geometry) ? edge.geometry : {};
        let geometryType = geom.type ?? edge.geometryType;
        if (!geometryType) {
          const btType = String(geom.btType ?? "");
          if (geom.radius !== undefined || btType.includes("Circle") || btType.includes("Arc")) {
            geometryType = geom.startPoint !== geom.endPoint && geom.radius !== undefined ? "arc" : "circle";
          } else if (geom.startPoint !== undefined && geom.endPoint !== undefined) {
            geometryType = "line";
          } else {
            geometryType = "unknown";
          }
        }
        const info: Record<string, unknown> = {
          id: edge.id,
          body: bodyId,
          type: String(geometryType).toLowerCase(),
        };
        if (typeof geom.radius === "number") info.radius = geom.radius / INCH_TO_METER;
        edges.push(info);
      }
    }
    return { edges, count: edges.length, bodyCount: bodies.length };
  }

  async findCircularEdges(
    documentId: string,
    workspaceId: string,
    elementId: string,
    radius?: number,
    tolerance = 0.001,
  ): Promise<unknown[]> {
    const result = await this.getEdges(documentId, workspaceId, elementId);
    const edges = isRecord(result) && Array.isArray(result.edges) ? result.edges : [];
    return edges.filter((edge) => {
      if (!isRecord(edge) || typeof edge.radius !== "number") return false;
      return radius === undefined || Math.abs(edge.radius - radius) <= tolerance;
    });
  }

  async findEdgesByFeature(documentId: string, workspaceId: string, elementId: string, featureId: string): Promise<unknown[]> {
    const script = `
        function(context is Context, queries) {
            const feature = qCreatedBy(makeId("${featureId}"), EntityType.EDGE);
            const edges = evaluateQuery(context, feature);

            const edgeIds = [];
            for (var edge in edges) {
                try {
                    const detId = toString(qDeterministicIdQuery(edge));
                    edgeIds = append(edgeIds, detId);
                } catch {}
            }

            return edgeIds;
        }
        `;
    const response = await this.client.post(`/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/featurescript`, {
      script,
    });
    const decoded = unwrapFeatureScriptResult(response);
    return Array.isArray(decoded) ? decoded : [];
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
