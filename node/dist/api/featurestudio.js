"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeatureStudioManager = void 0;
exports.loadText = loadText;
const node_fs_1 = require("node:fs");
class FeatureStudioManager {
    client;
    constructor(client) {
        this.client = client;
    }
    async create(documentId, workspaceId, name) {
        return this.client.post(`/api/v6/featurestudios/d/${documentId}/w/${workspaceId}`, { name });
    }
    async getContents(documentId, workspaceId, elementId) {
        return this.client.get(`/api/v6/featurestudios/d/${documentId}/w/${workspaceId}/e/${elementId}`);
    }
    async setContents(documentId, workspaceId, elementId, contents) {
        return this.client.post(`/api/v6/featurestudios/d/${documentId}/w/${workspaceId}/e/${elementId}`, { contents });
    }
    async getSpecs(documentId, workspaceId, elementId) {
        return this.client.get(`/api/v6/featurestudios/d/${documentId}/w/${workspaceId}/e/${elementId}/featurespecs`);
    }
}
exports.FeatureStudioManager = FeatureStudioManager;
function loadText(inline, file) {
    const raw = file ? (0, node_fs_1.readFileSync)(file, "utf8") : inline;
    if (!raw)
        throw new Error("Expected text via --contents or --contents-file");
    return raw;
}
