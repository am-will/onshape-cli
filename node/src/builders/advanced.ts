// Advanced feature builders for Onshape — fillet, chamfer, shell, draft, revolve,
// boolean, mirror, patterns, offset-plane, and assembly mate/connector/group.
// 1:1 port of onshape_cli/builders/advanced.py.
//
// Every builder emits the standard BTFeatureDefinitionCall-1406 envelope the
// POST .../features endpoint expects. Selection is query-string based so it
// survives topology changes; explicit deterministic IDs are also supported.

type Feature = Record<string, unknown>;

// --- Low-level parameter helpers -------------------------------------------

export function featureCall(featureType: string, name: string, parameters: Feature[], namespace = ""): Feature {
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMFeature-134",
      featureType,
      name,
      suppressed: false,
      namespace,
      parameters,
    },
  };
}

export function pQuery(
  parameterId: string,
  opts: { deterministicIds?: string[]; queryString?: string; featureId?: string } = {},
): Feature {
  const query: Record<string, unknown> = {
    btType: "BTMIndividualQuery-138",
    deterministicIds: opts.deterministicIds ?? [],
  };
  if (opts.queryString) {
    query.queryStatement = null;
    query.queryString = opts.queryString;
  }
  if (opts.featureId) query.featureId = opts.featureId;
  return {
    btType: "BTMParameterQueryList-148",
    queries: [query],
    parameterId,
    parameterName: "",
    libraryRelationType: "NONE",
  };
}

export function pSketchRegion(parameterId: string, sketchFeatureId: string): Feature {
  return {
    btType: "BTMParameterQueryList-148",
    queries: [
      {
        btType: "BTMIndividualSketchRegionQuery-140",
        queryStatement: null,
        filterInnerLoops: true,
        queryString: `query = qSketchRegion(id + "${sketchFeatureId}", true);`,
        featureId: sketchFeatureId,
        deterministicIds: [],
      },
    ],
    parameterId,
    parameterName: "",
    libraryRelationType: "NONE",
  };
}

export function pQuantity(
  parameterId: string,
  value: number,
  units = "in",
  opts: { variable?: string; isInteger?: boolean } = {},
): Feature {
  let expression: string;
  if (opts.variable) expression = `#${opts.variable}`;
  else if (opts.isInteger) expression = `${Math.trunc(value)}`;
  else if (units) expression = `${value} ${units}`;
  else expression = `${value}`;
  return {
    btType: "BTMParameterQuantity-147",
    isInteger: opts.isInteger ?? false,
    value,
    units: "",
    expression,
    parameterId,
    parameterName: "",
    libraryRelationType: "NONE",
  };
}

export function pEnum(parameterId: string, enumName: string, value: string): Feature {
  return {
    btType: "BTMParameterEnum-145",
    namespace: "",
    enumName,
    value,
    parameterId,
    parameterName: "",
    libraryRelationType: "NONE",
  };
}

export function pBool(parameterId: string, value: boolean): Feature {
  return {
    btType: "BTMParameterBoolean-144",
    value,
    parameterId,
    parameterName: "",
    libraryRelationType: "NONE",
  };
}

// --- Reusable selection query strings --------------------------------------

export const qAllEdges = (): string => "query = qOwnedByBody(qAllModifiableSolidBodies(), EntityType.EDGE);";
export const qEdgesOfFeature = (featureId: string): string =>
  `query = qCreatedBy(makeId("${featureId}"), EntityType.EDGE);`;
export const qCircularEdges = (): string =>
  "query = qGeometry(qOwnedByBody(qAllModifiableSolidBodies(), EntityType.EDGE), GeometryType.CIRCLE);";
export const qAllBodies = (): string => "query = qAllModifiableSolidBodies();";
export const qBodyOfFeature = (featureId: string): string =>
  `query = qCreatedBy(makeId("${featureId}"), EntityType.BODY);`;

export interface Selection {
  edgeIds?: string[];
  queryString?: string;
  featureId?: string;
  selectAll?: boolean;
  circular?: boolean;
}

function resolveEntityQuery(parameterId: string, sel: Selection, entity: "EDGE" | "BODY" = "EDGE"): Feature {
  if (sel.edgeIds && sel.edgeIds.length) return pQuery(parameterId, { deterministicIds: sel.edgeIds });
  if (sel.queryString) return pQuery(parameterId, { queryString: sel.queryString });
  if (sel.featureId) {
    const qs = entity === "EDGE" ? qEdgesOfFeature(sel.featureId) : qBodyOfFeature(sel.featureId);
    return pQuery(parameterId, { queryString: qs });
  }
  if (sel.circular) return pQuery(parameterId, { queryString: qCircularEdges() });
  if (sel.selectAll) return pQuery(parameterId, { queryString: qAllEdges() });
  throw new Error("No selection: pass edges, query, feature, --all, or --circular");
}

// --- Feature builders ------------------------------------------------------

export function buildFillet(
  opts: { name?: string; radius?: number; radiusVariable?: string; filletType?: string } & Selection,
): Feature {
  const entities = resolveEntityQuery("entities", opts);
  return featureCall("fillet", opts.name ?? "Fillet", [
    entities,
    pQuantity("radius", opts.radius ?? 0.1, "in", { variable: opts.radiusVariable }),
    pEnum("filletType", "FilletType", opts.filletType ?? "EDGE"),
  ]);
}

export function buildChamfer(
  opts: { name?: string; width?: number; widthVariable?: string; chamferType?: string; angle?: number } & Selection,
): Feature {
  const entities = resolveEntityQuery("entities", opts);
  const chamferType = opts.chamferType ?? "EQUAL_OFFSETS";
  const params = [
    entities,
    pEnum("chamferType", "ChamferType", chamferType),
    pQuantity("width", opts.width ?? 0.1, "in", { variable: opts.widthVariable }),
  ];
  if (chamferType === "OFFSET_ANGLE" && opts.angle !== undefined) {
    params.push(pQuantity("angle", opts.angle, "deg"));
  }
  return featureCall("chamfer", opts.name ?? "Chamfer", params);
}

export function buildShell(opts: {
  name?: string;
  thickness?: number;
  faceIds?: string[];
  queryString?: string;
  thicknessVariable?: string;
  inward?: boolean;
}): Feature {
  let entities: Feature;
  if (opts.faceIds && opts.faceIds.length) entities = pQuery("entities", { deterministicIds: opts.faceIds });
  else if (opts.queryString) entities = pQuery("entities", { queryString: opts.queryString });
  else entities = pQuery("entities", { deterministicIds: [] });
  const inward = opts.inward ?? true;
  return featureCall("shell", opts.name ?? "Shell", [
    entities,
    pQuantity("thickness", opts.thickness ?? 0.125, "in", { variable: opts.thicknessVariable }),
    pBool("oppositeDirection", !inward),
  ]);
}

export function buildDraft(opts: {
  name?: string;
  angle?: number;
  neutralPlaneQuery: string;
  faceQuery: string;
}): Feature {
  return featureCall("draft", opts.name ?? "Draft", [
    pQuery("neutralPlane", { queryString: opts.neutralPlaneQuery }),
    pQuery("draftFaces", { queryString: opts.faceQuery }),
    pQuantity("angle", opts.angle ?? 3.0, "deg"),
    pBool("oppositeDirection", false),
  ]);
}

export function buildRevolveAxis(opts: {
  name?: string;
  sketchFeatureId: string;
  axisQuery?: string;
  axisIds?: string[];
  operationType?: string;
  revolveType?: string;
  angle?: number;
}): Feature {
  const axis = opts.axisIds && opts.axisIds.length
    ? pQuery("axis", { deterministicIds: opts.axisIds })
    : pQuery("axis", { queryString: opts.axisQuery });
  const full = (opts.revolveType ?? "FULL") === "FULL";
  const params: Feature[] = [
    pEnum("bodyType", "ExtendedToolBodyType", "SOLID"),
    pEnum("operationType", "NewBodyOperationType", opts.operationType ?? "NEW"),
    pSketchRegion("entities", opts.sketchFeatureId),
    axis,
    pBool("fullRevolve", full),
  ];
  if (!full) {
    params.push(pEnum("endBound", "RevolveBoundingType", "BLIND"));
    params.push(pQuantity("angle", opts.angle ?? 360.0, "deg"));
  }
  params.push(pBool("defaultScope", true));
  return featureCall("revolve", opts.name ?? "Revolve", params);
}

export function buildBoolean(opts: {
  name?: string;
  operationType?: string;
  toolsQuery?: string;
  toolIds?: string[];
  targetsQuery?: string;
  keepTools?: boolean;
}): Feature {
  const operationType = opts.operationType ?? "UNION";
  let tools: Feature;
  if (opts.toolIds && opts.toolIds.length) tools = pQuery("tools", { deterministicIds: opts.toolIds });
  else if (opts.toolsQuery) tools = pQuery("tools", { queryString: opts.toolsQuery });
  else tools = pQuery("tools", { queryString: qAllBodies() });
  const params: Feature[] = [
    pEnum("operationType", "BooleanOperationType", operationType),
    pBool("defaultScope", false),
    tools,
    pBool("toolsExplicit", true),
  ];
  if (operationType === "SUBTRACTION") {
    params.push(pBool("targetsAndToolsNeedGrouping", false));
    if (opts.targetsQuery) params.push(pQuery("targets", { queryString: opts.targetsQuery }));
  }
  return featureCall("booleanBodies", opts.name ?? "Boolean", params);
}

export function buildMirror(opts: {
  name?: string;
  patternType?: string;
  entitiesQuery: string;
  mirrorPlaneIds?: string[];
  mirrorPlaneQuery?: string;
}): Feature {
  let plane: Feature;
  if (opts.mirrorPlaneIds && opts.mirrorPlaneIds.length) plane = pQuery("mirrorPlane", { deterministicIds: opts.mirrorPlaneIds });
  else if (opts.mirrorPlaneQuery) plane = pQuery("mirrorPlane", { queryString: opts.mirrorPlaneQuery });
  else throw new Error("Provide --plane-ids or --plane-query");
  return featureCall("mirror", opts.name ?? "Mirror", [
    pEnum("patternType", "MirrorType", opts.patternType ?? "PART"),
    pEnum("operationType", "NewBodyOperationType", "NEW"),
    pQuery("entities", { queryString: opts.entitiesQuery }),
    plane,
  ]);
}

export function buildLinearPattern(opts: {
  name?: string;
  patternType?: string;
  entitiesQuery: string;
  directionQuery?: string;
  directionIds?: string[];
  distance: number;
  instanceCount: number;
  opposite?: boolean;
}): Feature {
  const direction = opts.directionIds && opts.directionIds.length
    ? pQuery("directionOne", { deterministicIds: opts.directionIds })
    : pQuery("directionOne", { queryString: opts.directionQuery });
  return featureCall("linearPattern", opts.name ?? "Linear Pattern", [
    pEnum("patternType", "PatternType", opts.patternType ?? "PART"),
    pEnum("operationType", "NewBodyOperationType", "NEW"),
    pQuery("entities", { queryString: opts.entitiesQuery }),
    direction,
    pBool("oppositeDirection", opts.opposite ?? false),
    pQuantity("distance", opts.distance),
    pQuantity("instanceCount", opts.instanceCount, "", { isInteger: true }),
    pBool("hasSecondDir", false),
  ]);
}

export function buildCircularPattern(opts: {
  name?: string;
  patternType?: string;
  entitiesQuery: string;
  axisQuery?: string;
  axisIds?: string[];
  instanceCount: number;
  angle?: number;
  equalSpacing?: boolean;
}): Feature {
  const axis = opts.axisIds && opts.axisIds.length
    ? pQuery("axis", { deterministicIds: opts.axisIds })
    : pQuery("axis", { queryString: opts.axisQuery });
  return featureCall("circularPattern", opts.name ?? "Circular Pattern", [
    pEnum("patternType", "PatternType", opts.patternType ?? "PART"),
    pEnum("operationType", "NewBodyOperationType", "NEW"),
    pQuery("entities", { queryString: opts.entitiesQuery }),
    axis,
    pQuantity("angle", opts.angle ?? 360.0, "deg"),
    pQuantity("instanceCount", opts.instanceCount, "", { isInteger: true }),
    pBool("equalSpace", opts.equalSpacing ?? true),
  ]);
}

export function buildOffsetPlaneSelect(opts: {
  name?: string;
  basePlaneIds?: string[];
  basePlaneQuery?: string;
  offset?: number;
}): Feature {
  let base: Feature;
  if (opts.basePlaneIds && opts.basePlaneIds.length) base = pQuery("entities", { deterministicIds: opts.basePlaneIds });
  else if (opts.basePlaneQuery) base = pQuery("entities", { queryString: opts.basePlaneQuery });
  else base = pQuery("entities", { deterministicIds: ["JCC"] }); // Front
  return featureCall("cPlane", opts.name ?? "Plane", [
    pEnum("cplaneType", "CPlaneType", "OFFSET"),
    base,
    pQuantity("offset", opts.offset ?? 1.0),
    pBool("oppositeDirection", false),
  ]);
}

// --- Assembly feature builders (posted to the assembly /features endpoint) --

export function buildAssemblyMate(opts: { name?: string; mateType?: string; mateConnectorIds: string[] }): Feature {
  const queries = opts.mateConnectorIds.map((fid) => ({
    btType: "BTMFeatureQueryWithOccurrence-157",
    path: [],
    featureId: fid,
    queryData: "",
  }));
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMMate-64",
      featureType: "mate",
      name: opts.name ?? "Mate",
      suppressed: false,
      parameters: [
        pEnum("mateType", "Mate type", opts.mateType ?? "FASTENED"),
        {
          btType: "BTMParameterQueryWithOccurrenceList-67",
          queries,
          parameterId: "mateConnectorsQuery",
        },
      ],
    },
  };
}

export function buildAssemblyMateConnector(opts: { name?: string; occurrenceId: string; inferenceType?: string }): Feature {
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMMateConnector-66",
      featureType: "mateConnector",
      name: opts.name ?? "Mate connector",
      suppressed: false,
      parameters: [
        {
          btType: "BTMParameterEnum-145",
          enumName: "Origin type",
          value: "ON_ENTITY",
          parameterId: "originType",
          namespace: "",
        },
        {
          btType: "BTMParameterQueryWithOccurrenceList-67",
          parameterId: "originQuery",
          queries: [
            {
              btType: "BTMInferenceQueryWithOccurrence-1083",
              inferenceType: opts.inferenceType ?? "CENTROID",
              path: [opts.occurrenceId],
              deterministicIds: [],
            },
          ],
        },
      ],
    },
  };
}

export function buildAssemblyGroup(opts: { name?: string; occurrenceIds: string[] }): Feature {
  const queries = opts.occurrenceIds.map((oid) => ({
    btType: "BTMIndividualOccurrenceQuery-626",
    path: [oid],
  }));
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMMateGroup-65",
      featureType: "mateGroup",
      name: opts.name ?? "Group",
      suppressed: false,
      parameters: [
        {
          btType: "BTMParameterQueryWithOccurrenceList-67",
          queries,
          parameterId: "occurrencesQuery",
        },
      ],
    },
  };
}
