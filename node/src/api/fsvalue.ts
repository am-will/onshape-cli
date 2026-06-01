export class FeatureScriptError extends Error {
  constructor(readonly notices: Array<Record<string, unknown>>) {
    super(String(notices[0]?.message ?? "unknown FeatureScript error"));
    this.name = "FeatureScriptError";
  }
}

export function featurescriptMessages(response: unknown): Array<Record<string, unknown>> {
  if (!isRecord(response) || !Array.isArray(response.notices)) return [];
  return response.notices
    .filter((notice): notice is Record<string, unknown> => isRecord(notice) && Boolean(notice.message))
    .map((notice) => ({ type: notice.type, message: notice.message }));
}

export function decodeFsValue(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const btType = String(value.btType ?? "");
  const payload = value.value === undefined && isRecord(value.message) ? value.message : value;

  if (btType.includes("BTFSValueMap") && !btType.includes("Entry")) {
    const out: Record<string, unknown> = {};
    const entries = Array.isArray(payload.value) ? payload.value : [];
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
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

export function unwrapFeatureScriptResult(response: unknown): unknown {
  if (!isRecord(response) || response.result === null || response.result === undefined) return null;
  return decodeFsValue(response.result);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
