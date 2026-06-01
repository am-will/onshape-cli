"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const promises_1 = require("node:readline/promises");
const node_process_1 = require("node:process");
const credentials_1 = require("./credentials");
const client_1 = require("./api/client");
const documents_1 = require("./api/documents");
const edges_1 = require("./api/edges");
const partstudio_1 = require("./api/partstudio");
const output_1 = require("./output");
async function main(argv) {
    try {
        await run(argv);
    }
    catch (error) {
        if (error instanceof credentials_1.CredentialError) {
            (0, output_1.emitError)(error.message);
            process.exitCode = 2;
            return;
        }
        if (error instanceof output_1.CliError) {
            (0, output_1.emitError)(error.message, error.detail);
            process.exitCode = error.exitCode;
            return;
        }
        if (error instanceof client_1.HttpError) {
            (0, output_1.emitError)(`HTTP ${error.status}`, error.detail);
            process.exitCode = 1;
            return;
        }
        throw error;
    }
}
async function run(argv) {
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
            (0, output_1.emit)(new credentials_1.CredentialStore().clear());
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
        case "get-parts":
        case "get-features":
        case "get-feature-specs":
        case "get-sketch-info":
        case "get-body-details":
        case "create-part-studio":
        case "delete-feature":
        case "delete-element":
        case "add-feature":
        case "update-feature":
        case "rollback":
        case "get-edges":
        case "find-circular-edges":
        case "find-edges-by-feature":
        case "mass-properties":
            await handleReadCommand(parsed);
            return;
        default:
            throw new output_1.CliError(`Unknown command: ${parsed.command}`, null, 2);
    }
}
function parseArgs(argv) {
    const options = {};
    const positionals = [];
    let command = null;
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (item.startsWith("--")) {
            const eq = item.indexOf("=");
            const rawKey = item.slice(2, eq === -1 ? undefined : eq);
            const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            if (eq !== -1) {
                options[key] = item.slice(eq + 1);
            }
            else if (argv[index + 1] && !argv[index + 1].startsWith("-")) {
                options[key] = argv[index + 1];
                index += 1;
            }
            else {
                options[key] = true;
            }
        }
        else if (item.startsWith("-") && item.length > 1) {
            options[item.slice(1)] = true;
        }
        else if (!command) {
            command = item;
        }
        else {
            positionals.push(item);
        }
    }
    return { command, positionals, options };
}
async function handleConfig(parsed) {
    const action = parsed.positionals[0];
    const store = new credentials_1.CredentialStore();
    switch (action) {
        case "path":
            (0, output_1.emit)({ path: store.configPath() });
            return;
        case "show":
            (0, output_1.emit)(store.describe());
            return;
        case "clear":
            (0, output_1.emit)(store.clear());
            return;
        case "set": {
            const accessKey = stringOption(parsed.options, "accessKey");
            const secretKey = stringOption(parsed.options, "secretKey");
            if (!accessKey || !secretKey) {
                throw new output_1.CliError("config set requires --access-key and --secret-key in the Node CLI.", null, 2);
            }
            const creds = {
                accessKey,
                secretKey,
                baseUrl: stringOption(parsed.options, "baseUrl") ?? credentials_1.DEFAULT_BASE_URL,
            };
            const result = store.save(creds, storeMode(parsed.options));
            (0, output_1.emit)({ ...result, verified: null });
            return;
        }
        default:
            throw new output_1.CliError("Usage: onshape config set|show|path|clear", null, 2);
    }
}
async function handleLogin(options) {
    let accessKey = stringOption(options, "accessKey") ?? process.env.ONSHAPE_ACCESS_KEY;
    let secretKey = stringOption(options, "secretKey") ?? process.env.ONSHAPE_SECRET_KEY;
    const baseUrl = stringOption(options, "baseUrl") ?? process.env.ONSHAPE_BASE_URL ?? credentials_1.DEFAULT_BASE_URL;
    if ((!accessKey || !secretKey) && !process.stdin.isTTY) {
        throw new output_1.CliError("login cannot prompt in a non-interactive terminal. Pass --access-key and --secret-key.", null, 2);
    }
    if (!accessKey || !secretKey) {
        if (!options.noBrowser) {
            const open = await Promise.resolve().then(() => __importStar(require("open")));
            await open.default("https://dev.onshape.com/keys");
        }
        const rl = (0, promises_1.createInterface)({ input: node_process_1.stdin, output: node_process_1.stdout });
        try {
            accessKey = accessKey ?? (await rl.question("Onshape access key: "));
            secretKey = secretKey ?? (await rl.question("Onshape secret key: "));
        }
        finally {
            rl.close();
        }
    }
    if (!accessKey || !secretKey) {
        throw new output_1.CliError("Both an access key and a secret key are required.", null, 2);
    }
    const creds = { accessKey, secretKey, baseUrl };
    let verified = null;
    let verifyError;
    if (!options.noVerify) {
        try {
            await new client_1.OnshapeClient(creds).get("/api/v6/documents", { limit: 1 });
            verified = true;
        }
        catch (error) {
            verified = false;
            verifyError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        }
    }
    const result = {
        ...new credentials_1.CredentialStore().save(creds, storeMode(options)),
        verified,
    };
    if (verifyError)
        result.verifyError = verifyError;
    (0, output_1.emit)(result);
}
async function handleReadCommand(parsed) {
    const creds = resolveCredentials(parsed.options);
    const client = new client_1.OnshapeClient(creds);
    const docs = new documents_1.DocumentManager(client);
    const partstudios = new partstudio_1.PartStudioManager(client);
    const edges = new edges_1.EdgeQuery(client);
    switch (parsed.command) {
        case "list-documents": {
            const filterMap = { all: undefined, owned: 1, created: 4, shared: 5 };
            const filter = stringOption(parsed.options, "filter") ?? "all";
            (0, output_1.emit)(await docs.listDocuments({
                filterType: filterMap[filter],
                limit: numberOption(parsed.options, "limit", 20),
                sortBy: stringOption(parsed.options, "sortBy") ?? "modifiedAt",
                sortOrder: stringOption(parsed.options, "sortOrder") ?? "desc",
            }));
            return;
        }
        case "search-documents":
            (0, output_1.emit)(await docs.searchDocuments(parsed.positionals[0] ?? missing("query"), numberOption(parsed.options, "limit", 20)));
            return;
        case "get-document":
            (0, output_1.emit)(await docs.getDocument(requiredOption(parsed.options, "doc")));
            return;
        case "get-document-summary":
            (0, output_1.emit)(await docs.getDocumentSummary(requiredOption(parsed.options, "doc")));
            return;
        case "create-document":
            (0, output_1.emit)(await docs.createDocument(requiredOption(parsed.options, "name"), Boolean(parsed.options.public), stringOption(parsed.options, "description")));
            return;
        case "delete-document":
            (0, output_1.emit)(await docs.deleteDocument(requiredOption(parsed.options, "doc")));
            return;
        case "update-document":
            (0, output_1.emit)(await docs.updateDocument(requiredOption(parsed.options, "doc"), stringOption(parsed.options, "name"), stringOption(parsed.options, "description")));
            return;
        case "get-elements": {
            const { doc, ws } = docWorkspace(parsed.options);
            (0, output_1.emit)(await docs.getElements(doc, ws, stringOption(parsed.options, "type")));
            return;
        }
        case "find-part-studios": {
            const { doc, ws } = docWorkspace(parsed.options);
            (0, output_1.emit)(await docs.findPartStudios(doc, ws, stringOption(parsed.options, "name")));
            return;
        }
        case "get-workspaces":
            (0, output_1.emit)(await docs.getWorkspaces(requiredOption(parsed.options, "doc")));
            return;
        case "list-versions":
            (0, output_1.emit)(await docs.getVersions(requiredOption(parsed.options, "doc")));
            return;
        case "create-version": {
            const { doc, ws } = docWorkspace(parsed.options);
            (0, output_1.emit)(await docs.createVersion(doc, ws, requiredOption(parsed.options, "name"), stringOption(parsed.options, "description")));
            return;
        }
        case "get-features": {
            const { doc, ws, elem } = dwe(parsed.options);
            (0, output_1.emit)(await partstudios.getFeatures(doc, ws, elem, stringOption(parsed.options, "configuration")));
            return;
        }
        case "get-feature-specs": {
            const { doc, ws, elem } = dwe(parsed.options);
            (0, output_1.emit)(await partstudios.getFeatureSpecs(doc, ws, elem));
            return;
        }
        case "get-sketch-info": {
            const { doc, ws, elem } = dwe(parsed.options);
            (0, output_1.emit)(await partstudios.getSketchInfo(doc, ws, elem, stringOption(parsed.options, "sketch")));
            return;
        }
        case "get-body-details": {
            const { doc, ws, elem } = dwe(parsed.options);
            (0, output_1.emit)(await partstudios.getBodyDetails(doc, ws, elem));
            return;
        }
        case "get-parts": {
            const { doc, ws, elem } = dwe(parsed.options);
            (0, output_1.emit)(await partstudios.getParts(doc, ws, elem));
            return;
        }
        case "create-part-studio": {
            const { doc, ws } = docWorkspace(parsed.options);
            (0, output_1.emit)(await partstudios.createPartStudio(doc, ws, requiredOption(parsed.options, "name")));
            return;
        }
        case "delete-feature": {
            const { doc, ws, elem } = dwe(parsed.options);
            (0, output_1.emit)(await partstudios.deleteFeature(doc, ws, elem, requiredOption(parsed.options, "feature")));
            return;
        }
        case "delete-element": {
            const { doc, ws, elem } = dwe(parsed.options);
            (0, output_1.emit)(await client.delete(`/api/v9/elements/d/${doc}/w/${ws}/e/${elem}`));
            return;
        }
        case "add-feature": {
            const { doc, ws, elem } = dwe(parsed.options);
            const feature = requiredJson(parsed.options);
            (0, output_1.emit)(await withFeatureId(partstudios.addFeature(doc, ws, elem, feature)));
            return;
        }
        case "update-feature": {
            const { doc, ws, elem } = dwe(parsed.options);
            const feature = requiredJson(parsed.options);
            (0, output_1.emit)(await partstudios.updateFeature(doc, ws, elem, requiredOption(parsed.options, "feature"), feature));
            return;
        }
        case "rollback": {
            const { doc, ws, elem } = dwe(parsed.options);
            (0, output_1.emit)(await partstudios.rollback(doc, ws, elem, requiredNumberOption(parsed.options, "index")));
            return;
        }
        case "get-edges": {
            const { doc, ws, elem } = dwe(parsed.options);
            (0, output_1.emit)(await edges.getEdges(doc, ws, elem));
            return;
        }
        case "find-circular-edges": {
            const { doc, ws, elem } = dwe(parsed.options);
            (0, output_1.emit)(await edges.findCircularEdges(doc, ws, elem, optionalNumberOption(parsed.options, "radius")));
            return;
        }
        case "find-edges-by-feature": {
            const { doc, ws, elem } = dwe(parsed.options);
            (0, output_1.emit)(await edges.findEdgesByFeature(doc, ws, elem, requiredOption(parsed.options, "feature")));
            return;
        }
        case "mass-properties": {
            const { doc, ws, elem } = dwe(parsed.options);
            (0, output_1.emit)(await client.get(`/api/v6/partstudios/d/${doc}/w/${ws}/e/${elem}/massproperties`, {
                configuration: stringOption(parsed.options, "configuration"),
            }));
            return;
        }
    }
}
async function withFeatureId(responsePromise) {
    const response = await responsePromise;
    const featureId = isRecord(response) && isRecord(response.feature) ? response.feature.featureId ?? null : null;
    return { featureId, response };
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function resolveCredentials(options) {
    return new credentials_1.CredentialStore().resolve({
        accessKey: stringOption(options, "accessKey"),
        secretKey: stringOption(options, "secretKey"),
        baseUrl: stringOption(options, "baseUrl"),
    });
}
function dwe(options) {
    return {
        doc: stringOption(options, "doc") ?? process.env.ONSHAPE_DOC ?? missing("doc"),
        ws: stringOption(options, "ws") ?? process.env.ONSHAPE_WS ?? missing("ws"),
        elem: stringOption(options, "elem") ?? process.env.ONSHAPE_ELEM ?? missing("elem"),
    };
}
function docWorkspace(options) {
    return {
        doc: stringOption(options, "doc") ?? process.env.ONSHAPE_DOC ?? missing("doc"),
        ws: stringOption(options, "ws") ?? process.env.ONSHAPE_WS ?? missing("ws"),
    };
}
function stringOption(options, key) {
    const value = options[key];
    return typeof value === "string" ? value : undefined;
}
function numberOption(options, key, fallback) {
    const value = stringOption(options, key);
    return value === undefined ? fallback : Number(value);
}
function optionalNumberOption(options, key) {
    const value = stringOption(options, key);
    if (value === undefined)
        return undefined;
    const number = Number(value);
    if (!Number.isFinite(number))
        throw new output_1.CliError(`--${key} must be a number`, null, 2);
    return number;
}
function requiredNumberOption(options, key) {
    const value = stringOption(options, key);
    if (value === undefined)
        missing(key);
    const number = Number(value);
    if (!Number.isFinite(number))
        throw new output_1.CliError(`--${key} must be a number`, null, 2);
    return number;
}
function requiredOption(options, key) {
    return stringOption(options, key) ?? missing(key);
}
function requiredJson(options) {
    try {
        return (0, partstudio_1.loadJson)(stringOption(options, "json"), stringOption(options, "jsonFile"));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new output_1.CliError(message, null, 2);
    }
}
function missing(key) {
    throw new output_1.CliError(`Missing required option --${key}`, null, 2);
}
function storeMode(options) {
    const value = stringOption(options, "store") ?? "auto";
    if (value === "auto" || value === "file" || value === "keychain")
        return value;
    throw new output_1.CliError("--store must be one of: auto, file, keychain", null, 2);
}
function printHelp() {
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
  get-parts
  get-features
  get-feature-specs
  get-sketch-info
  get-body-details
  create-part-studio
  delete-feature
  delete-element
  add-feature
  update-feature
  rollback
  get-edges
  find-circular-edges
  find-edges-by-feature
  mass-properties
`);
}
