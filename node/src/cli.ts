import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { CredentialError, CredentialStore, DEFAULT_BASE_URL, type Credentials, type StoreMode } from "./credentials";
import { HttpError, OnshapeClient } from "./api/client";
import { DocumentManager } from "./api/documents";
import { CliError, emit, emitError } from "./output";

type Options = Record<string, string | boolean>;

interface ParsedArgs {
  command: string | null;
  positionals: string[];
  options: Options;
}

export async function main(argv: string[]): Promise<void> {
  try {
    await run(argv);
  } catch (error) {
    if (error instanceof CredentialError) {
      emitError(error.message);
      process.exitCode = 2;
      return;
    }
    if (error instanceof CliError) {
      emitError(error.message, error.detail);
      process.exitCode = error.exitCode;
      return;
    }
    if (error instanceof HttpError) {
      emitError(`HTTP ${error.status}`, error.detail);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

async function run(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.options.help || parsed.options.h || !parsed.command) {
    printHelp();
    return;
  }

  switch (parsed.command) {
    case "config":
      await handleConfig(parsed);
      return;
    case "login":
      await handleLogin(parsed.options);
      return;
    case "logout":
      emit(new CredentialStore().clear());
      return;
    case "list-documents":
    case "search-documents":
    case "get-document":
    case "get-document-summary":
    case "create-document":
    case "delete-document":
    case "update-document":
    case "get-elements":
    case "find-part-studios":
    case "get-workspaces":
    case "list-versions":
    case "create-version":
    case "get-features":
    case "mass-properties":
      await handleReadCommand(parsed);
      return;
    default:
      throw new CliError(`Unknown command: ${parsed.command}`, null, 2);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const options: Options = {};
  const positionals: string[] = [];
  let command: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--")) {
      const eq = item.indexOf("=");
      const rawKey = item.slice(2, eq === -1 ? undefined : eq);
      const key = rawKey.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      if (eq !== -1) {
        options[key] = item.slice(eq + 1);
      } else if (argv[index + 1] && !argv[index + 1].startsWith("-")) {
        options[key] = argv[index + 1];
        index += 1;
      } else {
        options[key] = true;
      }
    } else if (item.startsWith("-") && item.length > 1) {
      options[item.slice(1)] = true;
    } else if (!command) {
      command = item;
    } else {
      positionals.push(item);
    }
  }

  return { command, positionals, options };
}

async function handleConfig(parsed: ParsedArgs): Promise<void> {
  const action = parsed.positionals[0];
  const store = new CredentialStore();
  switch (action) {
    case "path":
      emit({ path: store.configPath() });
      return;
    case "show":
      emit(store.describe());
      return;
    case "clear":
      emit(store.clear());
      return;
    case "set": {
      const accessKey = stringOption(parsed.options, "accessKey");
      const secretKey = stringOption(parsed.options, "secretKey");
      if (!accessKey || !secretKey) {
        throw new CliError("config set requires --access-key and --secret-key in the Node CLI.", null, 2);
      }
      const creds = {
        accessKey,
        secretKey,
        baseUrl: stringOption(parsed.options, "baseUrl") ?? DEFAULT_BASE_URL,
      };
      const result = store.save(creds, storeMode(parsed.options));
      emit({ ...result, verified: null });
      return;
    }
    default:
      throw new CliError("Usage: onshape config set|show|path|clear", null, 2);
  }
}

async function handleLogin(options: Options): Promise<void> {
  let accessKey = stringOption(options, "accessKey") ?? process.env.ONSHAPE_ACCESS_KEY;
  let secretKey = stringOption(options, "secretKey") ?? process.env.ONSHAPE_SECRET_KEY;
  const baseUrl = stringOption(options, "baseUrl") ?? process.env.ONSHAPE_BASE_URL ?? DEFAULT_BASE_URL;

  if ((!accessKey || !secretKey) && !process.stdin.isTTY) {
    throw new CliError("login cannot prompt in a non-interactive terminal. Pass --access-key and --secret-key.", null, 2);
  }

  if (!accessKey || !secretKey) {
    if (!options.noBrowser) {
      const open = await import("open");
      await open.default("https://dev.onshape.com/keys");
    }
    const rl = createInterface({ input, output });
    try {
      accessKey = accessKey ?? (await rl.question("Onshape access key: "));
      secretKey = secretKey ?? (await rl.question("Onshape secret key: "));
    } finally {
      rl.close();
    }
  }

  if (!accessKey || !secretKey) {
    throw new CliError("Both an access key and a secret key are required.", null, 2);
  }

  const creds = { accessKey, secretKey, baseUrl };
  let verified: boolean | null = null;
  let verifyError: string | undefined;
  if (!options.noVerify) {
    try {
      await new OnshapeClient(creds).get("/api/v6/documents", { limit: 1 });
      verified = true;
    } catch (error) {
      verified = false;
      verifyError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  }

  const result: Record<string, unknown> = {
    ...new CredentialStore().save(creds, storeMode(options)),
    verified,
  };
  if (verifyError) result.verifyError = verifyError;
  emit(result);
}

async function handleReadCommand(parsed: ParsedArgs): Promise<void> {
  const creds = resolveCredentials(parsed.options);
  const client = new OnshapeClient(creds);
  const docs = new DocumentManager(client);

  switch (parsed.command) {
    case "list-documents": {
      const filterMap: Record<string, number | undefined> = { all: undefined, owned: 1, created: 4, shared: 5 };
      const filter = stringOption(parsed.options, "filter") ?? "all";
      emit(
        await docs.listDocuments({
          filterType: filterMap[filter],
          limit: numberOption(parsed.options, "limit", 20),
          sortBy: stringOption(parsed.options, "sortBy") ?? "modifiedAt",
          sortOrder: stringOption(parsed.options, "sortOrder") ?? "desc",
        }),
      );
      return;
    }
    case "search-documents":
      emit(await docs.searchDocuments(parsed.positionals[0] ?? missing("query"), numberOption(parsed.options, "limit", 20)));
      return;
    case "get-document":
      emit(await docs.getDocument(requiredOption(parsed.options, "doc")));
      return;
    case "get-document-summary":
      emit(await docs.getDocumentSummary(requiredOption(parsed.options, "doc")));
      return;
    case "create-document":
      emit(
        await docs.createDocument(
          requiredOption(parsed.options, "name"),
          Boolean(parsed.options.public),
          stringOption(parsed.options, "description"),
        ),
      );
      return;
    case "delete-document":
      emit(await docs.deleteDocument(requiredOption(parsed.options, "doc")));
      return;
    case "update-document":
      emit(
        await docs.updateDocument(
          requiredOption(parsed.options, "doc"),
          stringOption(parsed.options, "name"),
          stringOption(parsed.options, "description"),
        ),
      );
      return;
    case "get-elements": {
      const { doc, ws } = docWorkspace(parsed.options);
      emit(await docs.getElements(doc, ws, stringOption(parsed.options, "type")));
      return;
    }
    case "find-part-studios": {
      const { doc, ws } = docWorkspace(parsed.options);
      emit(await docs.findPartStudios(doc, ws, stringOption(parsed.options, "name")));
      return;
    }
    case "get-workspaces":
      emit(await docs.getWorkspaces(requiredOption(parsed.options, "doc")));
      return;
    case "list-versions":
      emit(await docs.getVersions(requiredOption(parsed.options, "doc")));
      return;
    case "create-version": {
      const { doc, ws } = docWorkspace(parsed.options);
      emit(await docs.createVersion(doc, ws, requiredOption(parsed.options, "name"), stringOption(parsed.options, "description")));
      return;
    }
    case "get-features": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await client.get(`/api/v9/partstudios/d/${doc}/w/${ws}/e/${elem}/features`, {
          configuration: stringOption(parsed.options, "configuration"),
        }),
      );
      return;
    }
    case "mass-properties": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await client.get(`/api/v6/partstudios/d/${doc}/w/${ws}/e/${elem}/massproperties`, {
          configuration: stringOption(parsed.options, "configuration"),
        }),
      );
      return;
    }
  }
}

function resolveCredentials(options: Options): Credentials {
  return new CredentialStore().resolve({
    accessKey: stringOption(options, "accessKey"),
    secretKey: stringOption(options, "secretKey"),
    baseUrl: stringOption(options, "baseUrl"),
  });
}

function dwe(options: Options): { doc: string; ws: string; elem: string } {
  return {
    doc: stringOption(options, "doc") ?? process.env.ONSHAPE_DOC ?? missing("doc"),
    ws: stringOption(options, "ws") ?? process.env.ONSHAPE_WS ?? missing("ws"),
    elem: stringOption(options, "elem") ?? process.env.ONSHAPE_ELEM ?? missing("elem"),
  };
}

function docWorkspace(options: Options): { doc: string; ws: string } {
  return {
    doc: stringOption(options, "doc") ?? process.env.ONSHAPE_DOC ?? missing("doc"),
    ws: stringOption(options, "ws") ?? process.env.ONSHAPE_WS ?? missing("ws"),
  };
}

function stringOption(options: Options, key: string): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

function numberOption(options: Options, key: string, fallback: number): number {
  const value = stringOption(options, key);
  return value === undefined ? fallback : Number(value);
}

function requiredOption(options: Options, key: string): string {
  return stringOption(options, key) ?? missing(key);
}

function missing(key: string): never {
  throw new CliError(`Missing required option --${key}`, null, 2);
}

function storeMode(options: Options): StoreMode {
  const value = stringOption(options, "store") ?? "auto";
  if (value === "auto" || value === "file" || value === "keychain") return value;
  throw new CliError("--store must be one of: auto, file, keychain", null, 2);
}

function printHelp(): void {
  console.log(`onshape

Usage:
  onshape <command> [options]

Commands:
  login
  logout
  config set|show|path|clear
  list-documents
  search-documents
  get-document
  get-document-summary
  create-document
  delete-document
  update-document
  get-elements
  find-part-studios
  get-workspaces
  list-versions
  create-version
  get-features
  mass-properties
`);
}
