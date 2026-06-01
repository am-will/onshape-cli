"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeatureScriptError = void 0;
exports.featurescriptMessages = featurescriptMessages;
exports.decodeFsValue = decodeFsValue;
exports.unwrapFeatureScriptResult = unwrapFeatureScriptResult;
class FeatureScriptError extends Error {
    notices;
    constructor(notices) {
        super(String(notices[0]?.message ?? "unknown FeatureScript error"));
        this.notices = notices;
        this.name = "FeatureScriptError";
    }
}
exports.FeatureScriptError = FeatureScriptError;
function featurescriptMessages(response) {
    if (!isRecord(response) || !Array.isArray(response.notices))
        return [];
    return response.notices
        .filter((notice) => isRecord(notice) && Boolean(notice.message))
        .map((notice) => ({ type: notice.type, message: notice.message }));
}
function decodeFsValue(value) {
    if (!isRecord(value))
        return value;
    const btType = String(value.btType ?? "");
    const payload = value.value === undefined && isRecord(value.message) ? value.message : value;
    if (btType.includes("BTFSValueMap") && !btType.includes("Entry")) {
        const out = {};
        const entries = Array.isArray(payload.value) ? payload.value : [];
        for (const entry of entries) {
            if (!isRecord(entry))
                continue;
            out[String(decodeFsValue(entry.key))] = decodeFsValue(entry.value);
        }
        return out;
    }
    if (btType.includes("BTFSValueArray")) {
        const items = Array.isArray(payload.value) ? payload.value : [];
        return items.map(decodeFsValue);
    }
    return payload.value;
}
function unwrapFeatureScriptResult(response) {
    if (!isRecord(response) || response.result === null || response.result === undefined)
        return null;
    return decodeFsValue(response.result);
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
