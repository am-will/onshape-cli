"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnshapeClient = exports.HttpError = void 0;
const node_url_1 = require("node:url");
const promises_1 = require("node:timers/promises");
const READ_RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_READ_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 10_000;
class HttpError extends Error {
    status;
    detail;
    constructor(status, detail) {
        super(`HTTP ${status}`);
        this.name = "HttpError";
        this.status = status;
        this.detail = detail;
    }
}
exports.HttpError = HttpError;
class OnshapeClient {
    creds;
    constructor(creds) {
        this.creds = creds;
    }
    async get(path, params) {
        const url = new URL(path, this.creds.baseUrl);
        if (params) {
            const search = new node_url_1.URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined)
                    search.set(key, String(value));
            }
            url.search = search.toString();
        }
        return this.requestJson(url);
    }
    async post(path, data) {
        const response = await this.fetchWithAuthRedirects(new URL(path, this.creds.baseUrl), {
            Accept: "application/json;charset=UTF-8; qs=0.09",
            "Content-Type": "application/json;charset=UTF-8; qs=0.09",
        }, "POST", data === undefined ? undefined : JSON.stringify(data));
        if (!response.ok) {
            throw new HttpError(response.status, await responseDetail(response));
        }
        return responseJsonOrStatus(response, "ok");
    }
    async delete(path) {
        const response = await this.fetchWithAuthRedirects(new URL(path, this.creds.baseUrl), {
            Accept: "application/json;charset=UTF-8; qs=0.09",
        }, "DELETE");
        if (!response.ok) {
            throw new HttpError(response.status, await responseDetail(response));
        }
        return responseJsonOrStatus(response, "deleted");
    }
    async requestJson(url) {
        for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
            const response = await this.fetchWithAuthRedirects(url, {
                Accept: "application/json;charset=UTF-8; qs=0.09",
            });
            if (response.ok) {
                return response.json();
            }
            if (!READ_RETRY_STATUSES.has(response.status) || attempt === MAX_READ_ATTEMPTS) {
                throw new HttpError(response.status, await responseDetail(response));
            }
            await (0, promises_1.setTimeout)(retryDelayMs(response, attempt));
        }
        throw new Error("unreachable read retry state");
    }
    async fetchWithAuthRedirects(url, headers, method = "GET", body) {
        const auth = Buffer.from(`${this.creds.accessKey}:${this.creds.secretKey}`).toString("base64");
        const requestHeaders = { ...headers, Authorization: `Basic ${auth}` };
        let current = url;
        for (let hop = 0; hop < 5; hop += 1) {
            const response = await fetch(current, { method, body, headers: requestHeaders, redirect: "manual" });
            if (![301, 302, 303, 307, 308].includes(response.status))
                return response;
            const location = response.headers.get("location");
            if (!location)
                return response;
            current = new URL(location, current);
        }
        return fetch(current, { method, body, headers: requestHeaders, redirect: "manual" });
    }
}
exports.OnshapeClient = OnshapeClient;
async function responseDetail(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    }
    catch {
        return text.slice(0, 1000);
    }
}
async function responseJsonOrStatus(response, key) {
    const text = await response.text();
    if (!text)
        return { [key]: true, status: response.status };
    try {
        return JSON.parse(text);
    }
    catch {
        return { [key]: true, status: response.status, text: text.slice(0, 500) };
    }
}
function retryDelayMs(response, attempt) {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
        }
        const dateMs = Date.parse(retryAfter);
        if (Number.isFinite(dateMs)) {
            return Math.min(Math.max(dateMs - Date.now(), 0), MAX_RETRY_DELAY_MS);
        }
    }
    return Math.min(500 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}
