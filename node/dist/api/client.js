"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnshapeClient = exports.HttpError = void 0;
const node_url_1 = require("node:url");
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
    async requestJson(url) {
        const response = await this.fetchWithAuthRedirects(url, {
            Accept: "application/json;charset=UTF-8; qs=0.09",
        });
        if (!response.ok) {
            throw new HttpError(response.status, await responseDetail(response));
        }
        return response.json();
    }
    async fetchWithAuthRedirects(url, headers) {
        const auth = Buffer.from(`${this.creds.accessKey}:${this.creds.secretKey}`).toString("base64");
        const requestHeaders = { ...headers, Authorization: `Basic ${auth}` };
        let current = url;
        for (let hop = 0; hop < 5; hop += 1) {
            const response = await fetch(current, { headers: requestHeaders, redirect: "manual" });
            if (![301, 302, 303, 307, 308].includes(response.status))
                return response;
            const location = response.headers.get("location");
            if (!location)
                return response;
            current = new URL(location, current);
        }
        return fetch(current, { headers: requestHeaders, redirect: "manual" });
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
