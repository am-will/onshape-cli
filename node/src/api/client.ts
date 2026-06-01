import { URLSearchParams } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import type { Credentials } from "../credentials";

const READ_RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_READ_ATTEMPTS = 8;
const MAX_RETRY_DELAY_MS = 30_000;

export class HttpError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, detail: unknown) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.detail = detail;
  }
}

export class OnshapeClient {
  constructor(private readonly creds: Credentials) {}

  async get(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    const url = new URL(path, this.creds.baseUrl);
    if (params) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) search.set(key, String(value));
      }
      url.search = search.toString();
    }
    return this.requestJson(url);
  }

  async post(path: string, data?: unknown): Promise<unknown> {
    const response = await this.fetchWithAuthRedirects(new URL(path, this.creds.baseUrl), {
      Accept: "application/json;charset=UTF-8; qs=0.09",
      "Content-Type": "application/json;charset=UTF-8; qs=0.09",
    }, "POST", data === undefined ? undefined : JSON.stringify(data));
    if (!response.ok) {
      throw new HttpError(response.status, await responseDetail(response));
    }
    return responseJsonOrStatus(response, "ok");
  }

  async delete(path: string): Promise<unknown> {
    const response = await this.fetchWithAuthRedirects(new URL(path, this.creds.baseUrl), {
      Accept: "application/json;charset=UTF-8; qs=0.09",
    }, "DELETE");
    if (!response.ok) {
      throw new HttpError(response.status, await responseDetail(response));
    }
    return responseJsonOrStatus(response, "deleted");
  }

  private async requestJson(url: URL): Promise<unknown> {
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
      await sleep(retryDelayMs(response, attempt));
    }
    throw new Error("unreachable read retry state");
  }

  private async fetchWithAuthRedirects(
    url: URL,
    headers: Record<string, string>,
    method = "GET",
    body?: BodyInit,
  ): Promise<Response> {
    const auth = Buffer.from(`${this.creds.accessKey}:${this.creds.secretKey}`).toString("base64");
    const requestHeaders = { ...headers, Authorization: `Basic ${auth}` };
    let current = url;
    for (let hop = 0; hop < 5; hop += 1) {
      const response = await fetch(current, { method, body, headers: requestHeaders, redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      current = new URL(location, current);
    }
    return fetch(current, { method, body, headers: requestHeaders, redirect: "manual" });
  }
}

async function responseDetail(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 1000);
  }
}

async function responseJsonOrStatus(response: Response, key: string): Promise<unknown> {
  const text = await response.text();
  if (!text) return { [key]: true, status: response.status };
  try {
    return JSON.parse(text);
  } catch {
    return { [key]: true, status: response.status, text: text.slice(0, 500) };
  }
}

function retryDelayMs(response: Response, attempt: number): number {
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
  return Math.min(1000 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}
