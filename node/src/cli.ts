import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { CredentialError, CredentialStore, DEFAULT_BASE_URL, type Credentials, type StoreMode } from "./credentials";
import { HttpError, OnshapeClient } from "./api/client";
import { DocumentManager } from "./api/documents";
import { EdgeQuery } from "./api/edges";
import { FeatureStudioManager, loadText } from "./api/featurestudio";
import { loadJson, PartStudioManager } from "./api/partstudio";
import { ExportManager } from "./api/export";
import { VariableManager } from "./api/variables";
import { ConfigurationManager } from "./api/configurations";
import { AssemblyManager } from "./api/assemblies";
import { DrawingManager } from "./api/drawings";
import { MetadataManager } from "./api/metadata";
import { decodeFsValue, featurescriptMessages } from "./api/fsvalue";
import {
  buildBooleanUnion,
  buildCandyCanePathSketch,
  buildCircleAxisSketch,
  buildCircleSketch,
  buildExtrude,
  buildLineSketch,
  buildRectangleSketch,
  buildRevolve,
  buildSketchFromEntities,
  buildSweep,
  buildThicken,
  parsePoint2,
  planeId,
} from "./builders/modeling";
import {
  buildAssemblyGroup,
  buildAssemblyMate,
  buildAssemblyMateConnector,
  buildBoolean,
  buildChamfer,
  buildCircularPattern,
  buildDraft,
  buildFillet,
  buildLinearPattern,
  buildMirror,
  buildOffsetPlaneSelect,
  buildRevolveAxis,
  buildShell,
  type Selection,
} from "./builders/advanced";
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
    case "get-parts":
    case "get-features":
    case "get-feature-specs":
    case "get-sketch-info":
    case "get-body-details":
    case "create-part-studio":
    case "delete-feature":
    case "delete-element":
    case "create-feature-studio":
    case "get-feature-studio":
    case "set-feature-studio":
    case "get-feature-studio-specs":
    case "add-feature":
    case "update-feature":
    case "rollback":
    case "sketch-circle":
    case "sketch-circle-axis":
    case "sketch-candy-cane-path":
    case "extrude":
    case "revolve":
    case "sweep":
    case "offset-plane":
    case "boolean-union":
    case "validate-partstudio":
    case "get-edges":
    case "find-circular-edges":
    case "find-edges-by-feature":
    case "mass-properties":
    case "create-sketch":
    case "sketch-rectangle":
    case "sketch-line":
    case "hole":
    case "thicken":
    case "fillet":
    case "chamfer":
    case "shell":
    case "draft":
    case "boolean":
    case "mirror":
    case "linear-pattern":
    case "circular-pattern":
    case "measure":
    case "eval-featurescript":
    case "get-variables":
    case "set-variable":
    case "get-configuration":
    case "encode-configuration":
    case "export-stl":
    case "export":
    case "thumbnail-info":
    case "get-thumbnail":
    case "shaded-view":
    case "get-assembly":
    case "create-assembly":
    case "insert-instance":
    case "get-assembly-features":
    case "assembly-add-feature":
    case "assembly-mate-connector":
    case "assembly-mate":
    case "assembly-group":
    case "get-bom":
    case "assembly-mass-properties":
    case "delete-instance":
    case "transform-instance":
    case "create-drawing":
    case "get-drawing-views":
    case "export-drawing":
    case "get-metadata":
    case "set-metadata":
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
      } else if (argv[index + 1] && (!argv[index + 1].startsWith("-") || isNegativeValue(argv[index + 1]))) {
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

function isNegativeValue(value: string): boolean {
  return /^-\d/.test(value) || /^-\.\d/.test(value);
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
  const partstudios = new PartStudioManager(client);
  const featurestudios = new FeatureStudioManager(client);
  const edges = new EdgeQuery(client);
  const exports = new ExportManager(client);
  const variables = new VariableManager(client);
  const configurations = new ConfigurationManager(client);
  const assemblies = new AssemblyManager(client);
  const drawings = new DrawingManager(client);
  const metadata = new MetadataManager(client);

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
      emit(await partstudios.getFeatures(doc, ws, elem, stringOption(parsed.options, "configuration")));
      return;
    }
    case "get-feature-specs": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await partstudios.getFeatureSpecs(doc, ws, elem));
      return;
    }
    case "get-sketch-info": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await partstudios.getSketchInfo(doc, ws, elem, stringOption(parsed.options, "sketch")));
      return;
    }
    case "get-body-details": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await partstudios.getBodyDetails(doc, ws, elem));
      return;
    }
    case "get-parts": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await partstudios.getParts(doc, ws, elem));
      return;
    }
    case "create-part-studio": {
      const { doc, ws } = docWorkspace(parsed.options);
      emit(await partstudios.createPartStudio(doc, ws, requiredOption(parsed.options, "name")));
      return;
    }
    case "delete-feature": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await partstudios.deleteFeature(doc, ws, elem, requiredOption(parsed.options, "feature")));
      return;
    }
    case "delete-element": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await client.delete(`/api/v9/elements/d/${doc}/w/${ws}/e/${elem}`));
      return;
    }
    case "create-feature-studio": {
      const { doc, ws } = docWorkspace(parsed.options);
      emit(await featurestudios.create(doc, ws, requiredOption(parsed.options, "name")));
      return;
    }
    case "get-feature-studio": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await featurestudios.getContents(doc, ws, elem));
      return;
    }
    case "set-feature-studio": {
      const { doc, ws, elem } = dwe(parsed.options);
      try {
        emit(
          await featurestudios.setContents(
            doc,
            ws,
            elem,
            loadText(stringOption(parsed.options, "contents"), stringOption(parsed.options, "contentsFile")),
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CliError(message, null, 2);
      }
      return;
    }
    case "get-feature-studio-specs": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await featurestudios.getSpecs(doc, ws, elem));
      return;
    }
    case "add-feature": {
      const { doc, ws, elem } = dwe(parsed.options);
      const feature = requiredJson(parsed.options);
      emit(await addFeatureResult(partstudios, doc, ws, elem, feature, !parsed.options.noValidate));
      return;
    }
    case "update-feature": {
      const { doc, ws, elem } = dwe(parsed.options);
      const feature = requiredJson(parsed.options);
      emit(await partstudios.updateFeature(doc, ws, elem, requiredOption(parsed.options, "feature"), feature));
      return;
    }
    case "rollback": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await partstudios.rollback(doc, ws, elem, requiredNumberOption(parsed.options, "index")));
      return;
    }
    case "sketch-circle": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildCircleSketch({
            name: stringOption(parsed.options, "name") ?? "Sketch circle",
            plane: stringOption(parsed.options, "plane") ?? "Front",
            planeFeatureId: stringOption(parsed.options, "planeFeature"),
            center: parsePointOption(parsed.options, "center"),
            radius: requiredNumberOption(parsed.options, "radius"),
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "sketch-circle-axis": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildCircleAxisSketch({
            name: stringOption(parsed.options, "name") ?? "Sketch circle and axis",
            plane: stringOption(parsed.options, "plane") ?? "Front",
            center: parsePointOption(parsed.options, "center"),
            radius: requiredNumberOption(parsed.options, "radius"),
            axisStart: parsePointOption(parsed.options, "axisStart"),
            axisEnd: parsePointOption(parsed.options, "axisEnd"),
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "sketch-candy-cane-path": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildCandyCanePathSketch({
            name: stringOption(parsed.options, "name") ?? "Candy cane centerline",
            plane: stringOption(parsed.options, "plane") ?? "Front",
            x: numberOption(parsed.options, "x", 0),
            bottom: numberOption(parsed.options, "bottom", 0),
            straightHeight: requiredNumberOption(parsed.options, "straightHeight"),
            hookRadius: requiredNumberOption(parsed.options, "hookRadius"),
            hookAngle: numberOption(parsed.options, "hookAngle", 210),
            segments: numberOption(parsed.options, "segments", 24),
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "extrude": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildExtrude({
            name: stringOption(parsed.options, "name") ?? "Extrude",
            sketchFeatureId: requiredOption(parsed.options, "sketch"),
            depth: requiredNumberOption(parsed.options, "depth"),
            operationType: stringOption(parsed.options, "op") ?? "NEW",
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "revolve": {
      const { doc, ws, elem } = dwe(parsed.options);
      const axisIds = splitList(stringOption(parsed.options, "axisIds"));
      const axisQuery = stringOption(parsed.options, "axis");
      const name = stringOption(parsed.options, "name") ?? "Revolve";
      const sketchFeatureId = requiredOption(parsed.options, "sketch");
      const angle = numberOption(parsed.options, "angle", 360);
      const operationType = stringOption(parsed.options, "op") ?? "NEW";
      const feature =
        axisIds.length || axisQuery
          ? buildRevolveAxis({
              name,
              sketchFeatureId,
              axisIds: axisIds.length ? axisIds : undefined,
              axisQuery,
              operationType,
              revolveType: stringOption(parsed.options, "type") ?? "FULL",
              angle,
            })
          : buildRevolve({ name, sketchFeatureId, angle, operationType });
      emit(await addFeatureResult(partstudios, doc, ws, elem, feature, !parsed.options.noValidate));
      return;
    }
    case "sweep": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildSweep({
            name: stringOption(parsed.options, "name") ?? "Sweep",
            profileSketchFeatureId: requiredOption(parsed.options, "profile"),
            pathSketchFeatureId: requiredOption(parsed.options, "path"),
            operationType: stringOption(parsed.options, "op") ?? "NEW",
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "offset-plane": {
      const { doc, ws, elem } = dwe(parsed.options);
      const baseIds = splitList(stringOption(parsed.options, "baseIds"));
      const basePlane = stringOption(parsed.options, "basePlane");
      const basePlaneIds = baseIds.length ? baseIds : basePlane ? [planeId(basePlane)] : undefined;
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildOffsetPlaneSelect({
            name: stringOption(parsed.options, "name") ?? "Offset plane",
            basePlaneIds,
            basePlaneQuery: stringOption(parsed.options, "baseQuery"),
            offset: numberOption(parsed.options, "offset", 1.0),
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "boolean-union": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await addFeatureResult(partstudios, doc, ws, elem, buildBooleanUnion(), !parsed.options.noValidate));
      return;
    }
    case "validate-partstudio": {
      const { doc, ws, elem } = dwe(parsed.options);
      try {
        emit(
          await partstudios.validatePartStudio(doc, ws, elem, {
            parts: optionalNumberOption(parsed.options, "expectParts"),
            bodies: optionalNumberOption(parsed.options, "expectBodies"),
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CliError(message, null, 1);
      }
      return;
    }
    case "get-edges": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await edges.getEdges(doc, ws, elem));
      return;
    }
    case "find-circular-edges": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await edges.findCircularEdges(doc, ws, elem, optionalNumberOption(parsed.options, "radius")));
      return;
    }
    case "find-edges-by-feature": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await edges.findEdgesByFeature(doc, ws, elem, requiredOption(parsed.options, "feature")));
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

    // ---- sketching ----
    case "create-sketch": {
      const { doc, ws, elem } = dwe(parsed.options);
      let entities: Array<Record<string, unknown>>;
      try {
        const parsedEntities = JSON.parse(requiredOption(parsed.options, "entities"));
        if (!Array.isArray(parsedEntities)) throw new Error("--entities must be a JSON array");
        entities = parsedEntities;
      } catch (error) {
        throw new CliError(error instanceof Error ? error.message : String(error), null, 2);
      }
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildSketchFromEntities({
            name: stringOption(parsed.options, "name") ?? "Sketch",
            plane: stringOption(parsed.options, "plane") ?? "Front",
            entities,
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "sketch-rectangle": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildRectangleSketch({
            name: stringOption(parsed.options, "name") ?? "Sketch",
            plane: stringOption(parsed.options, "plane") ?? "Front",
            corner1: parsePointOption(parsed.options, "corner1"),
            corner2: parsePointOption(parsed.options, "corner2"),
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "sketch-line": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildLineSketch({
            name: stringOption(parsed.options, "name") ?? "Sketch",
            plane: stringOption(parsed.options, "plane") ?? "Front",
            start: parsePointOption(parsed.options, "start"),
            end: parsePointOption(parsed.options, "end"),
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }

    // ---- solids / modifiers ----
    case "hole": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildExtrude({
            name: stringOption(parsed.options, "name") ?? "Hole",
            sketchFeatureId: requiredOption(parsed.options, "sketch"),
            depth: requiredNumberOption(parsed.options, "depth"),
            operationType: "REMOVE",
            depthVariable: stringOption(parsed.options, "depthVar"),
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "thicken": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildThicken({
            name: stringOption(parsed.options, "name") ?? "Thicken",
            sketchFeatureId: requiredOption(parsed.options, "sketch"),
            thickness: requiredNumberOption(parsed.options, "thickness"),
            operationType: stringOption(parsed.options, "op") ?? "NEW",
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "fillet": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildFillet({
            name: stringOption(parsed.options, "name") ?? "Fillet",
            radius: numberOption(parsed.options, "radius", 0.06),
            filletType: stringOption(parsed.options, "type") ?? "EDGE",
            ...selection(parsed.options),
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "chamfer": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildChamfer({
            name: stringOption(parsed.options, "name") ?? "Chamfer",
            width: numberOption(parsed.options, "width", 0.08),
            chamferType: stringOption(parsed.options, "type") ?? "EQUAL_OFFSETS",
            angle: optionalNumberOption(parsed.options, "angle"),
            ...selection(parsed.options),
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "shell": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildShell({
            name: stringOption(parsed.options, "name") ?? "Shell",
            thickness: numberOption(parsed.options, "thickness", 0.125),
            faceIds: splitList(stringOption(parsed.options, "faces")),
            queryString: stringOption(parsed.options, "query"),
            inward: !parsed.options.outward,
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "draft": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildDraft({
            name: stringOption(parsed.options, "name") ?? "Draft",
            angle: numberOption(parsed.options, "angle", 3.0),
            neutralPlaneQuery: requiredOption(parsed.options, "neutral"),
            faceQuery: requiredOption(parsed.options, "faces"),
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }

    // ---- patterns / boolean ----
    case "boolean": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildBoolean({
            name: stringOption(parsed.options, "name") ?? "Boolean",
            operationType: stringOption(parsed.options, "op") ?? "UNION",
            toolIds: splitList(stringOption(parsed.options, "toolIds")),
            toolsQuery: stringOption(parsed.options, "tools"),
            targetsQuery: stringOption(parsed.options, "targets"),
            keepTools: Boolean(parsed.options.keepTools),
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "mirror": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildMirror({
            name: stringOption(parsed.options, "name") ?? "Mirror",
            patternType: stringOption(parsed.options, "type") ?? "PART",
            entitiesQuery: requiredOption(parsed.options, "entities"),
            mirrorPlaneIds: splitList(stringOption(parsed.options, "planeIds")),
            mirrorPlaneQuery: stringOption(parsed.options, "planeQuery"),
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "linear-pattern": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildLinearPattern({
            name: stringOption(parsed.options, "name") ?? "Linear Pattern",
            patternType: stringOption(parsed.options, "type") ?? "PART",
            entitiesQuery: requiredOption(parsed.options, "entities"),
            directionIds: splitList(stringOption(parsed.options, "directionIds")),
            directionQuery: stringOption(parsed.options, "direction"),
            distance: requiredNumberOption(parsed.options, "distance"),
            instanceCount: requiredNumberOption(parsed.options, "count"),
            opposite: Boolean(parsed.options.opposite),
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }
    case "circular-pattern": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addFeatureResult(
          partstudios,
          doc,
          ws,
          elem,
          buildCircularPattern({
            name: stringOption(parsed.options, "name") ?? "Circular Pattern",
            patternType: stringOption(parsed.options, "type") ?? "PART",
            entitiesQuery: requiredOption(parsed.options, "entities"),
            axisIds: splitList(stringOption(parsed.options, "axisIds")),
            axisQuery: stringOption(parsed.options, "axis"),
            instanceCount: requiredNumberOption(parsed.options, "count"),
            angle: numberOption(parsed.options, "angle", 360.0),
            equalSpacing: !parsed.options.noEqualSpacing,
          }),
          !parsed.options.noValidate,
        ),
      );
      return;
    }

    // ---- query / measure ----
    case "measure": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await partstudios.measure(doc, ws, elem));
      return;
    }
    case "eval-featurescript": {
      const { doc, ws, elem } = dwe(parsed.options);
      const scriptFile = stringOption(parsed.options, "scriptFile");
      const script = scriptFile ? loadText(undefined, scriptFile) : stringOption(parsed.options, "script") ?? "";
      const resp = (await partstudios.evaluateFeatureScript(doc, ws, elem, script)) as Record<string, unknown>;
      if (parsed.options.raw) {
        emit(resp);
        return;
      }
      const messages = featurescriptMessages(resp);
      if (!isRecord(resp) || resp.result === null || resp.result === undefined) {
        throw new CliError(String(messages[0]?.message ?? "FeatureScript evaluation failed"), messages, 1);
      }
      const out: Record<string, unknown> = { value: decodeFsValue(resp.result) };
      if (resp.console) out.console = resp.console;
      if (messages.length) out.warnings = messages;
      emit(out);
      return;
    }

    // ---- variables ----
    case "get-variables": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await variables.getVariables(doc, ws, elem));
      return;
    }
    case "set-variable": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await variables.setVariable(
          doc,
          ws,
          elem,
          requiredOption(parsed.options, "name"),
          requiredOption(parsed.options, "expression"),
          stringOption(parsed.options, "description"),
        ),
      );
      return;
    }

    // ---- configurations ----
    case "get-configuration": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await configurations.getConfiguration(doc, ws, elem));
      return;
    }
    case "encode-configuration": {
      const { doc, elem } = dwe(parsed.options);
      const params = loadJsonArray(parsed.options, "params", "paramsFile");
      emit(await configurations.encodeConfiguration(doc, elem, params as Array<Record<string, string>>));
      return;
    }

    // ---- export / images ----
    case "export-stl": {
      const { doc, ws, elem } = dwe(parsed.options);
      const out = requiredOption(parsed.options, "out");
      const written = await exports.exportStl(doc, ws, elem, out, {
        binary: !parsed.options.ascii,
        resolution: stringOption(parsed.options, "resolution") ?? "medium",
        configuration: stringOption(parsed.options, "configuration"),
      });
      emit({ written });
      return;
    }
    case "export": {
      const { doc, ws, elem } = dwe(parsed.options);
      const out = requiredOption(parsed.options, "out");
      const format = stringOption(parsed.options, "format") ?? "STEP";
      const written = await exports.exportTranslation(doc, ws, elem, out, {
        formatName: format,
        elementKind: stringOption(parsed.options, "kind") ?? "partstudios",
        configuration: stringOption(parsed.options, "configuration"),
      });
      emit({ written, format });
      return;
    }
    case "thumbnail-info": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await exports.thumbnailInfo(doc, ws, elem));
      return;
    }
    case "get-thumbnail": {
      const { doc, ws, elem } = dwe(parsed.options);
      const out = requiredOption(parsed.options, "out");
      const size = stringOption(parsed.options, "size") ?? "600x340";
      const written = await exports.getThumbnail(doc, ws, elem, out, { size });
      emit({ written, size });
      return;
    }
    case "shaded-view": {
      const { doc, ws, elem } = dwe(parsed.options);
      const out = requiredOption(parsed.options, "out");
      const written = await exports.shadedView(doc, ws, elem, out, {
        elementKind: stringOption(parsed.options, "kind") ?? "partstudios",
        width: numberOption(parsed.options, "width", 600),
        height: numberOption(parsed.options, "height", 340),
        viewMatrix: stringOption(parsed.options, "viewMatrix"),
        showEdges: !parsed.options.noEdges,
        configuration: stringOption(parsed.options, "configuration"),
      });
      emit({ written });
      return;
    }

    // ---- assemblies ----
    case "get-assembly": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await docs.getAssembly(doc, ws, elem));
      return;
    }
    case "create-assembly": {
      const { doc, ws } = docWorkspace(parsed.options);
      emit(await assemblies.createAssembly(doc, ws, requiredOption(parsed.options, "name")));
      return;
    }
    case "insert-instance": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await assemblies.insertInstance(doc, ws, elem, {
          sourceDocumentId: stringOption(parsed.options, "srcDoc") ?? doc,
          sourceElementId: requiredOption(parsed.options, "srcElem"),
          partId: stringOption(parsed.options, "part"),
          sourceVersionId: stringOption(parsed.options, "srcVersion"),
          isAssembly: Boolean(parsed.options.isAssembly),
          isWholePartStudio: Boolean(parsed.options.wholeStudio),
          configuration: stringOption(parsed.options, "configuration"),
        }),
      );
      return;
    }
    case "get-assembly-features": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await assemblies.getFeatures(doc, ws, elem));
      return;
    }
    case "assembly-add-feature": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await addAssemblyFeature(assemblies, doc, ws, elem, requiredJson(parsed.options)));
      return;
    }
    case "assembly-mate-connector": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addAssemblyFeature(
          assemblies,
          doc,
          ws,
          elem,
          buildAssemblyMateConnector({
            name: stringOption(parsed.options, "name") ?? "Mate connector",
            occurrenceId: requiredOption(parsed.options, "occurrence"),
            inferenceType: stringOption(parsed.options, "inference") ?? "CENTROID",
          }),
        ),
      );
      return;
    }
    case "assembly-mate": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addAssemblyFeature(
          assemblies,
          doc,
          ws,
          elem,
          buildAssemblyMate({
            name: stringOption(parsed.options, "name") ?? "Mate",
            mateType: stringOption(parsed.options, "type") ?? "FASTENED",
            mateConnectorIds: splitList(requiredOption(parsed.options, "connectors")),
          }),
        ),
      );
      return;
    }
    case "assembly-group": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(
        await addAssemblyFeature(
          assemblies,
          doc,
          ws,
          elem,
          buildAssemblyGroup({
            name: stringOption(parsed.options, "name") ?? "Group",
            occurrenceIds: splitList(requiredOption(parsed.options, "occurrences")),
          }),
        ),
      );
      return;
    }
    case "get-bom": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await assemblies.getBom(doc, ws, elem, { multiLevel: Boolean(parsed.options.multiLevel) }));
      return;
    }
    case "assembly-mass-properties": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await assemblies.massProperties(doc, ws, elem));
      return;
    }
    case "delete-instance": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await assemblies.deleteInstance(doc, ws, elem, requiredOption(parsed.options, "node")));
      return;
    }
    case "transform-instance": {
      const { doc, ws, elem } = dwe(parsed.options);
      const paths = loadJsonArray(parsed.options, "paths", "pathsFile") as string[][];
      const transform = loadJsonArray(parsed.options, "transform", "transformFile") as number[];
      emit(await assemblies.transformOccurrences(doc, ws, elem, paths, transform, { isRelative: !parsed.options.absolute }));
      return;
    }

    // ---- drawings ----
    case "create-drawing": {
      const { doc, ws } = docWorkspace(parsed.options);
      emit(
        await drawings.createDrawing(doc, ws, {
          name: requiredOption(parsed.options, "name"),
          sourceElementId: requiredOption(parsed.options, "srcElem"),
          sourceVersionId: requiredOption(parsed.options, "srcVersion"),
          sourceDocumentId: stringOption(parsed.options, "srcDoc"),
          partId: stringOption(parsed.options, "part"),
        }),
      );
      return;
    }
    case "get-drawing-views": {
      const { doc, ws, elem } = dwe(parsed.options);
      emit(await drawings.getViews(doc, ws, elem));
      return;
    }
    case "export-drawing": {
      const { doc, ws, elem } = dwe(parsed.options);
      const out = requiredOption(parsed.options, "out");
      const format = stringOption(parsed.options, "format") ?? "PDF";
      const written = await exports.exportTranslation(doc, ws, elem, out, { formatName: format, elementKind: "drawings" });
      emit({ written, format });
      return;
    }

    // ---- metadata ----
    case "get-metadata": {
      const { doc, ws, elem } = dwe(parsed.options);
      const part = stringOption(parsed.options, "part");
      emit(part ? await metadata.getPartMetadata(doc, ws, elem, part) : await metadata.getElementMetadata(doc, ws, elem));
      return;
    }
    case "set-metadata": {
      const { doc, ws, elem } = dwe(parsed.options);
      const properties = loadJsonArray(parsed.options, "properties", "propertiesFile") as Array<Record<string, unknown>>;
      emit(await metadata.setElementMetadata(doc, ws, elem, properties, stringOption(parsed.options, "part")));
      return;
    }
  }
}

function selection(options: Options): Selection {
  return {
    edgeIds: splitList(stringOption(options, "edges")),
    queryString: stringOption(options, "query"),
    featureId: stringOption(options, "feature"),
    selectAll: Boolean(options.all),
    circular: Boolean(options.circular),
  };
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function loadJsonArray(options: Options, inlineKey: string, fileKey: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = loadJson(stringOption(options, inlineKey), stringOption(options, fileKey));
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error), null, 2);
  }
  if (!Array.isArray(parsed)) throw new CliError(`--${inlineKey} must be a JSON array`, null, 2);
  return parsed;
}

async function addAssemblyFeature(
  assemblies: AssemblyManager,
  doc: string,
  ws: string,
  elem: string,
  feature: unknown,
): Promise<unknown> {
  const response = await assemblies.addFeature(doc, ws, elem, feature);
  const featureId = isRecord(response) && isRecord(response.feature) ? response.feature.featureId ?? null : null;
  return { featureId, response };
}

async function addFeatureResult(
  partstudios: PartStudioManager,
  doc: string,
  ws: string,
  elem: string,
  feature: unknown,
  validate: boolean,
): Promise<unknown> {
  const response = await partstudios.addFeature(doc, ws, elem, feature);
  const featureId = isRecord(response) && isRecord(response.feature) ? response.feature.featureId ?? null : null;
  const result: Record<string, unknown> = { featureId, response };
  if (validate && typeof featureId === "string") {
    try {
      result.validation = await partstudios.validateFeature(doc, ws, elem, featureId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(message, { featureId, response }, 1);
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function optionalNumberOption(options: Options, key: string): number | undefined {
  const value = stringOption(options, key);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new CliError(`--${key} must be a number`, null, 2);
  return number;
}

function requiredNumberOption(options: Options, key: string): number {
  const value = stringOption(options, key);
  if (value === undefined) missing(key);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new CliError(`--${key} must be a number`, null, 2);
  return number;
}

function requiredOption(options: Options, key: string): string {
  return stringOption(options, key) ?? missing(key);
}

function parsePointOption(options: Options, key: string): [number, number] {
  try {
    return parsePoint2(requiredOption(options, key));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(message, null, 2);
  }
}

function requiredJson(options: Options): unknown {
  try {
    return loadJson(stringOption(options, "json"), stringOption(options, "jsonFile"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(message, null, 2);
  }
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
  console.log(`onshape — command-line automation for Onshape CAD

Usage:
  onshape <command> [options]

Credentials:
  login  logout  config set|show|path|clear

Documents & discovery:
  list-documents  search-documents  get-document  get-document-summary
  create-document  delete-document  update-document  get-elements
  find-part-studios  get-workspaces  list-versions  create-version
  get-parts  get-features  get-feature-specs  get-sketch-info
  get-body-details  get-assembly

Part studio management:
  create-part-studio  delete-feature  delete-element
  add-feature  update-feature  rollback  validate-partstudio

Sketching:
  create-sketch  sketch-rectangle  sketch-circle  sketch-line
  sketch-circle-axis  sketch-candy-cane-path

Solids & modifiers:
  extrude  hole  thicken  revolve  sweep  draft  fillet  chamfer  shell

Patterns & boolean:
  boolean  boolean-union  mirror  linear-pattern  circular-pattern  offset-plane

Geometry / measure:
  get-edges  find-circular-edges  find-edges-by-feature  measure
  eval-featurescript  mass-properties

Variables & configurations:
  get-variables  set-variable  get-configuration  encode-configuration

Export & images:
  export-stl  export  thumbnail-info  get-thumbnail  shaded-view

Assemblies:
  create-assembly  insert-instance  get-assembly-features  assembly-add-feature
  assembly-mate-connector  assembly-mate  assembly-group  get-bom
  assembly-mass-properties  delete-instance  transform-instance

Drawings:
  create-drawing  get-drawing-views  export-drawing

Feature studios:
  create-feature-studio  get-feature-studio  set-feature-studio  get-feature-studio-specs

Metadata:
  get-metadata  set-metadata

Every command prints {"ok": true, "result": ...} or {"ok": false, "error": ..., "detail": ...}.
`);
}
