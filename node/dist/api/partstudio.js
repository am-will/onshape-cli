"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PartStudioManager = void 0;
exports.loadJson = loadJson;
const node_fs_1 = require("node:fs");
class PartStudioManager {
    client;
    constructor(client) {
        this.client = client;
    }
    async getFeatures(documentId, workspaceId, elementId, configuration) {
        return this.client.get(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features`, {
            configuration,
        });
    }
    async getFeatureSpecs(documentId, workspaceId, elementId) {
        return this.client.get(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/featurespecs`);
    }
    async getSketchInfo(documentId, workspaceId, elementId, sketchId) {
        return this.client.get(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/sketches`, {
            includeGeometry: "true",
            sketchId,
        });
    }
    async getBodyDetails(documentId, workspaceId, elementId) {
        return this.client.get(`/api/v6/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/bodydetails`, {
            includeTopology: "true",
        });
    }
    async getParts(documentId, workspaceId, elementId) {
        return this.client.get(`/api/v9/parts/d/${documentId}/w/${workspaceId}/e/${elementId}`);
    }
    async createPartStudio(documentId, workspaceId, name) {
        return this.client.post(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}`, { name });
    }
    async deleteFeature(documentId, workspaceId, elementId, featureId) {
        return this.client.delete(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features/featureid/${featureId}`);
    }
    async addFeature(documentId, workspaceId, elementId, feature) {
        return this.client.post(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features`, feature);
    }
    async updateFeature(documentId, workspaceId, elementId, featureId, feature) {
        return this.client.post(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features/featureid/${featureId}`, feature);
    }
    async rollback(documentId, workspaceId, elementId, index) {
        return this.client.post(`/api/v9/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/features/rollback`, {
            rollbackIndex: index,
        });
    }
    async validateFeature(documentId, workspaceId, elementId, featureId) {
        const features = await this.getFeatures(documentId, workspaceId, elementId);
        const states = isRecord(features) && isRecord(features.featureStates) ? features.featureStates : {};
        const state = isRecord(states[featureId]) ? states[featureId] : {};
        const status = typeof state.featureStatus === "string" ? state.featureStatus : null;
        if (status === "ERROR") {
            throw new Error(`Feature ${featureId} regenerated with status ERROR.`);
        }
        return { featureId, featureStatus: status };
    }
    async validatePartStudio(documentId, workspaceId, elementId, expectations = {}) {
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
exports.PartStudioManager = PartStudioManager;
function loadJson(inline, file) {
    const raw = file ? (0, node_fs_1.readFileSync)(file, "utf8") : inline;
    if (!raw)
        throw new Error("Expected JSON via --json or --json-file");
    return JSON.parse(raw);
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
