import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_BASE_URL = "https://cad.onshape.com";
const KEYCHAIN_SERVICE = "onshape-cli";

export type StoreMode = "auto" | "file" | "keychain";

export interface Credentials {
  accessKey: string;
  secretKey: string;
  baseUrl: string;
}

interface CredentialFile {
  backend?: string;
  access_key?: string;
  secret_key?: string;
  base_url?: string;
  account?: string;
}

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

export function redactSecret(secret: string): string {
  return secret.length > 8 ? `${secret.slice(0, 3)}...${secret.slice(-3)}` : "***";
}

export function accountForBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    try {
      return new URL(`https://${baseUrl}`).hostname;
    } catch {
      return baseUrl;
    }
  }
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function readJson(path: string): CredentialFile {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeSecureJson(path: string, data: CredentialFile): void {
  mkdirSync(dirname(path), { recursive: true });
  try {
    chmodSync(dirname(path), 0o700);
  } catch {
    // chmod is best-effort on some platforms.
  }
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  try {
    chmodSync(path, 0o600);
  } catch {
    // chmod is best-effort on some platforms.
  }
}

function loadKeyringEntry(account: string): { getPassword(): string | null; setPassword(value: string): void; deleteCredential(): boolean } {
  try {
    // Optional dependency. Keep it lazy so headless/CI installs can use file storage.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const keyring = require("@napi-rs/keyring") as typeof import("@napi-rs/keyring");
    return new keyring.Entry(KEYCHAIN_SERVICE, account);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CredentialError(message);
  }
}

export class CredentialStore {
  configPath(): string {
    return process.env.ONSHAPE_CONFIG ? expandHome(process.env.ONSHAPE_CONFIG) : join(homedir(), ".onshape", "credentials.json");
  }

  xdgConfigPath(): string | null {
    if (platform() !== "linux" || !process.env.XDG_CONFIG_HOME) return null;
    return join(expandHome(process.env.XDG_CONFIG_HOME), "onshape", "credentials.json");
  }

  resolve(overrides: Partial<Credentials> = {}): Credentials {
    const fileCreds = this.firstFileCredentials();
    const mcpCreds = this.mcpCredentials();
    const sourceBase = fileCreds?.baseUrl ?? mcpCreds?.baseUrl ?? DEFAULT_BASE_URL;
    const accessKey =
      overrides.accessKey ?? process.env.ONSHAPE_ACCESS_KEY ?? fileCreds?.accessKey ?? mcpCreds?.accessKey;
    const secretKey =
      overrides.secretKey ?? process.env.ONSHAPE_SECRET_KEY ?? fileCreds?.secretKey ?? mcpCreds?.secretKey;
    const baseUrl = overrides.baseUrl ?? process.env.ONSHAPE_BASE_URL ?? sourceBase;

    if (!accessKey || !secretKey) {
      throw new CredentialError(
        "No credentials. Run 'onshape login', set ONSHAPE_ACCESS_KEY / ONSHAPE_SECRET_KEY, or pass --access-key/--secret-key.",
      );
    }
    return { accessKey, secretKey, baseUrl };
  }

  save(creds: Credentials, store: StoreMode = "auto"): Record<string, unknown> {
    if (store !== "auto" && store !== "file" && store !== "keychain") {
      throw new CredentialError("store must be one of: auto, file, keychain");
    }

    if (store === "auto" || store === "keychain") {
      try {
        return this.saveKeychain(creds);
      } catch (error) {
        if (store === "keychain") throw error;
      }
    }

    writeSecureJson(this.configPath(), {
      backend: "file",
      access_key: creds.accessKey,
      secret_key: creds.secretKey,
      base_url: creds.baseUrl,
    });
    return { saved: true, backend: "file", path: this.configPath() };
  }

  clear(): Record<string, unknown> {
    const path = this.configPath();
    const data = readJson(path);
    const existed = existsSync(path);
    if (existed) rmSync(path);

    let keychainDeleted = false;
    if (data.backend === "keychain") {
      const account = data.account ?? accountForBaseUrl(data.base_url ?? DEFAULT_BASE_URL);
      try {
        keychainDeleted = loadKeyringEntry(account).deleteCredential();
      } catch {
        keychainDeleted = false;
      }
    }
    return { cleared: existed || keychainDeleted, path, keychain_deleted: keychainDeleted };
  }

  describe(): Record<string, unknown> {
    const path = this.configPath();
    const data = readJson(path);
    if (!data.access_key) return { configured: false, path, base_url: DEFAULT_BASE_URL };

    const backend = data.backend ?? (data.secret_key ? "file" : undefined);
    const baseUrl = data.base_url ?? DEFAULT_BASE_URL;
    const result: Record<string, unknown> = {
      configured: true,
      path,
      base_url: baseUrl,
      backend,
      source: "file",
      access_key: data.access_key,
    };

    let secret = data.secret_key;
    if (backend === "keychain") {
      const account = data.account ?? accountForBaseUrl(baseUrl);
      result.account = account;
      try {
        const raw = loadKeyringEntry(account).getPassword();
        secret = raw ? (JSON.parse(raw) as CredentialFile).secret_key : undefined;
        result.keychain_available = true;
      } catch {
        result.keychain_available = false;
      }
    }
    if (secret) result.secret_key = redactSecret(secret);
    return result;
  }

  private saveKeychain(creds: Credentials): Record<string, unknown> {
    const account = accountForBaseUrl(creds.baseUrl);
    const value = JSON.stringify({
      access_key: creds.accessKey,
      secret_key: creds.secretKey,
      base_url: creds.baseUrl,
    });
    loadKeyringEntry(account).setPassword(value);
    writeSecureJson(this.configPath(), {
      backend: "keychain",
      access_key: creds.accessKey,
      base_url: creds.baseUrl,
      account,
    });
    return { saved: true, backend: "keychain", path: this.configPath(), account };
  }

  private firstFileCredentials(): Credentials | null {
    for (const path of [this.configPath(), this.xdgConfigPath()]) {
      if (!path) continue;
      const creds = this.credentialsFromFile(path);
      if (creds) return creds;
    }
    return null;
  }

  private credentialsFromFile(path: string): Credentials | null {
    const data = readJson(path);
    const baseUrl = data.base_url ?? DEFAULT_BASE_URL;
    if (data.backend === "keychain") {
      const account = data.account ?? accountForBaseUrl(baseUrl);
      try {
        const raw = loadKeyringEntry(account).getPassword();
        if (!raw) return null;
        const stored = JSON.parse(raw) as CredentialFile;
        if (!stored.secret_key) return null;
        return {
          accessKey: stored.access_key ?? data.access_key ?? "",
          secretKey: stored.secret_key,
          baseUrl: stored.base_url ?? baseUrl,
        };
      } catch {
        return null;
      }
    }
    if (data.access_key && data.secret_key) {
      return { accessKey: data.access_key, secretKey: data.secret_key, baseUrl };
    }
    return null;
  }

  private mcpCredentials(): Credentials | null {
    const data = readJson(join(homedir(), ".claude", "mcp.json")) as Record<string, any>;
    const env = data?.mcpServers?.onshape?.env;
    if (!env?.ONSHAPE_ACCESS_KEY || !env?.ONSHAPE_SECRET_KEY) return null;
    return {
      accessKey: env.ONSHAPE_ACCESS_KEY,
      secretKey: env.ONSHAPE_SECRET_KEY,
      baseUrl: env.ONSHAPE_BASE_URL ?? DEFAULT_BASE_URL,
    };
  }
}
