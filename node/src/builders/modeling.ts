const INCH_TO_METER = 0.0254;

const PLANE_IDS: Record<string, string> = {
  front: "JCC",
  top: "JDC",
  right: "JEC",
};

export function planeId(name: string): string {
  const value = PLANE_IDS[name.toLowerCase()];
  if (!value) throw new Error(`Unknown plane '${name}'. Use Front, Top, or Right.`);
  return value;
}

export function parsePoint2(value: string): [number, number] {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`Expected a 2D point as x,y; got '${value}'.`);
  }
  return [parts[0], parts[1]];
}

function toMeters(value: number): number {
  return value * INCH_TO_METER;
}

function circleEntity(
  id: string,
  center: [number, number],
  radius: number,
  isConstruction = false,
): Record<string, unknown> {
  return {
    btType: "BTMSketchCurve-4",
    entityId: id,
    centerId: `${id}.center`,
    geometry: {
      btType: "BTCurveGeometryCircle-115",
      radius: toMeters(radius),
      xCenter: toMeters(center[0]),
      yCenter: toMeters(center[1]),
      xDir: 1,
      yDir: 0,
      clockwise: false,
    },
    isConstruction,
  };
}

function rectangleEntities(prefix: string, corner1: [number, number], corner2: [number, number]): Array<Record<string, unknown>> {
  const [x1, y1] = corner1;
  const [x2, y2] = corner2;
  const corners: Array<[number, number]> = [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
  const segments: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 4; i += 1) {
    segments.push(lineEntity(`${prefix}.${i}`, corners[i], corners[(i + 1) % 4]));
  }
  return segments;
}

function lineEntity(
  id: string,
  start: [number, number],
  end: [number, number],
  isConstruction = false,
): Record<string, unknown> {
  const x1 = toMeters(start[0]);
  const y1 = toMeters(start[1]);
  const x2 = toMeters(end[0]);
  const y2 = toMeters(end[1]);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) throw new Error("Line start and end must be different.");
  return {
    btType: "BTMSketchCurveSegment-155",
    entityId: id,
    startPointId: `${id}.start`,
    endPointId: `${id}.end`,
    startParam: 0,
    endParam: length,
    geometry: {
      btType: "BTCurveGeometryLine-117",
      pntX: x1,
      pntY: y1,
      dirX: dx / length,
      dirY: dy / length,
    },
    isConstruction,
  };
}

function arcEntity(
  id: string,
  center: [number, number],
  radius: number,
  startAngle: number,
  endAngle: number,
): Record<string, unknown> {
  if (radius <= 0) throw new Error("Arc radius must be positive.");
  return {
    btType: "BTMSketchCurveSegment-155",
    entityId: id,
    startPointId: `${id}.start`,
    endPointId: `${id}.end`,
    centerId: `${id}.center`,
    startParam: (startAngle * Math.PI) / 180,
    endParam: (endAngle * Math.PI) / 180,
    geometry: {
      btType: "BTCurveGeometryCircle-115",
      radius: toMeters(radius),
      xCenter: toMeters(center[0]),
      yCenter: toMeters(center[1]),
      xDir: 1,
      yDir: 0,
      clockwise: false,
    },
    isConstruction: false,
  };
}

function sketchPlaneParameter(sketchPlaneId: string, featureId?: string): Record<string, unknown> {
  if (featureId) {
    return pQuery("sketchPlane", `query = qCreatedBy(makeId("${featureId}"), EntityType.FACE);`, featureId);
  }
  return {
    btType: "BTMParameterQueryList-148",
    queries: [{ btType: "BTMIndividualQuery-138", deterministicIds: [sketchPlaneId] }],
    parameterId: "sketchPlane",
  };
}

function sketch(
  name: string,
  sketchPlaneId: string,
  entities: Array<Record<string, unknown>>,
  featureId?: string,
): Record<string, unknown> {
  return {
    feature: {
      btType: "BTMSketch-151",
      featureType: "newSketch",
      name,
      suppressed: false,
      parameters: [sketchPlaneParameter(sketchPlaneId, featureId)],
      entities,
      constraints: [],
    },
  };
}

function pEnum(parameterId: string, enumName: string, value: string): Record<string, unknown> {
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

function pBool(parameterId: string, value: boolean): Record<string, unknown> {
  return {
    btType: "BTMParameterBoolean-144",
    value,
    parameterId,
    parameterName: "",
    libraryRelationType: "NONE",
  };
}

function pQuantity(parameterId: string, value: number, units: string): Record<string, unknown> {
  return {
    btType: "BTMParameterQuantity-147",
    isInteger: false,
    value,
    units: "",
    expression: `${value} ${units}`,
    parameterId,
    parameterName: "",
    libraryRelationType: "NONE",
  };
}

function pQuery(parameterId: string, queryString: string, featureId?: string): Record<string, unknown> {
  return {
    btType: "BTMParameterQueryList-148",
    queries: [
      {
        btType: "BTMIndividualQuery-138",
        queryStatement: null,
        queryString,
        ...(featureId ? { featureId } : {}),
        deterministicIds: [],
      },
    ],
    parameterId,
    parameterName: "",
    libraryRelationType: "NONE",
  };
}

function pDeterministicQuery(parameterId: string, deterministicIds: string[]): Record<string, unknown> {
  return {
    btType: "BTMParameterQueryList-148",
    queries: [
      {
        btType: "BTMIndividualQuery-138",
        deterministicIds,
      },
    ],
    parameterId,
    parameterName: "",
    libraryRelationType: "NONE",
  };
}

function sketchRegion(parameterId: string, sketchFeatureId: string): Record<string, unknown> {
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

function sketchEdges(parameterId: string, sketchFeatureId: string): Record<string, unknown> {
  return pQuery(parameterId, `query = qCreatedBy(makeId("${sketchFeatureId}"), EntityType.EDGE);`, sketchFeatureId);
}

export function buildCircleSketch(input: {
  name: string;
  plane: string;
  planeFeatureId?: string;
  center: [number, number];
  radius: number;
}): Record<string, unknown> {
  return sketch(input.name, planeId(input.plane), [circleEntity("circle.1", input.center, input.radius)], input.planeFeatureId);
}

export function buildCircleAxisSketch(input: {
  name: string;
  plane: string;
  center: [number, number];
  radius: number;
  axisStart: [number, number];
  axisEnd: [number, number];
}): Record<string, unknown> {
  return sketch(input.name, planeId(input.plane), [
    circleEntity("profile.circle", input.center, input.radius),
    lineEntity("axis.1", input.axisStart, input.axisEnd, true),
  ]);
}

export function buildCandyCanePathSketch(input: {
  name: string;
  plane: string;
  x: number;
  bottom: number;
  straightHeight: number;
  hookRadius: number;
  hookAngle: number;
  segments: number;
}): Record<string, unknown> {
  const top = input.bottom + input.straightHeight;
  const center: [number, number] = [input.x - input.hookRadius, top];
  const totalSegments = Math.max(2, Math.floor(input.segments));
  const arcLength = input.hookRadius * Math.abs((input.hookAngle * Math.PI) / 180);
  const straightShare = input.straightHeight / (input.straightHeight + arcLength);
  const straightSegments = Math.max(1, Math.round(totalSegments * straightShare));
  const arcSegments = Math.max(1, totalSegments - straightSegments);
  const entities: Array<Record<string, unknown>> = [];

  for (let index = 0; index < straightSegments; index += 1) {
    const y1 = input.bottom + (input.straightHeight * index) / straightSegments;
    const y2 = input.bottom + (input.straightHeight * (index + 1)) / straightSegments;
    entities.push(lineEntity(`path.stem.${index + 1}`, [input.x, y1], [input.x, y2]));
  }
  for (let index = 0; index < arcSegments; index += 1) {
    const start = (input.hookAngle * index) / arcSegments;
    const end = (input.hookAngle * (index + 1)) / arcSegments;
    entities.push(arcEntity(`path.hook.${index + 1}`, center, input.hookRadius, start, end));
  }

  return sketch(input.name, planeId(input.plane), entities);
}

function depthQuantity(parameterId: string, value: number, variable?: string): Record<string, unknown> {
  if (!variable) return pQuantity(parameterId, value, "in");
  return {
    btType: "BTMParameterQuantity-147",
    isInteger: false,
    value,
    units: "",
    expression: `#${variable}`,
    parameterId,
    parameterName: "",
    libraryRelationType: "NONE",
  };
}

export function buildExtrude(input: {
  name: string;
  sketchFeatureId: string;
  depth: number;
  operationType: string;
  depthVariable?: string;
}): Record<string, unknown> {
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMFeature-134",
      featureType: "extrude",
      name: input.name,
      suppressed: false,
      namespace: "",
      parameters: [
        sketchRegion("entities", input.sketchFeatureId),
        pEnum("operationType", "NewBodyOperationType", input.operationType),
        depthQuantity("depth", input.depth, input.depthVariable),
        pBool("oppositeDirection", false),
        pBool("defaultScope", true),
      ],
    },
  };
}

/** thicken — mirrors onshape_cli/builders/thicken.py (bare BTMFeature-134). */
export function buildThicken(input: {
  name: string;
  sketchFeatureId: string;
  thickness: number;
  operationType: string;
  thicknessVariable?: string;
  midplane?: boolean;
  opposite?: boolean;
}): Record<string, unknown> {
  const expression = input.thicknessVariable ? `#${input.thicknessVariable}` : `${input.thickness} in`;
  return {
    btType: "BTMFeature-134",
    name: input.name,
    suppressed: false,
    namespace: "",
    featureType: "thicken",
    parameters: [
      { btType: "BTMParameterEnum-145", enumName: "NewBodyOperationType", value: input.operationType, parameterId: "operationType" },
      sketchRegion("entities", input.sketchFeatureId),
      { btType: "BTMParameterBoolean-144", value: input.midplane ?? false, parameterId: "midplane" },
      { btType: "BTMParameterQuantity-147", expression, parameterId: "thickness1" },
      { btType: "BTMParameterBoolean-144", value: input.opposite ?? false, parameterId: "oppositeDirection" },
      { btType: "BTMParameterQuantity-147", expression: "0 in", parameterId: "thickness2" },
    ],
  };
}

/** Generic sketch from a parsed entity list (create-sketch). Matches the
 *  Python contract: types line/circle/rectangle (arc is not supported). */
export function buildSketchFromEntities(input: {
  name: string;
  plane: string;
  entities: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  const out: Array<Record<string, unknown>> = [];
  input.entities.forEach((entity, index) => {
    const type = String(entity.type ?? "");
    const construction = Boolean(entity.construction);
    if (type === "line") {
      out.push(lineEntity(`e${index}`, point(entity.start), point(entity.end), construction));
    } else if (type === "circle") {
      out.push(circleEntity(`e${index}`, point(entity.center), Number(entity.radius), construction));
    } else if (type === "rectangle") {
      out.push(...rectangleEntities(`e${index}`, point(entity.corner1), point(entity.corner2)));
    } else if (type === "arc") {
      throw new Error("arc entities not supported by this sketch builder yet; use line/circle/rectangle");
    } else {
      throw new Error(`Unknown sketch entity type '${type}'. Use line, circle, or rectangle.`);
    }
  });
  return sketch(input.name, planeId(input.plane), out);
}

export function buildRectangleSketch(input: {
  name: string;
  plane: string;
  corner1: [number, number];
  corner2: [number, number];
}): Record<string, unknown> {
  return sketch(input.name, planeId(input.plane), rectangleEntities("rect", input.corner1, input.corner2));
}

export function buildLineSketch(input: {
  name: string;
  plane: string;
  start: [number, number];
  end: [number, number];
}): Record<string, unknown> {
  return sketch(input.name, planeId(input.plane), [lineEntity("line.1", input.start, input.end)]);
}

function point(value: unknown): [number, number] {
  if (Array.isArray(value) && value.length === 2 && value.every((v) => Number.isFinite(Number(v)))) {
    return [Number(value[0]), Number(value[1])];
  }
  throw new Error(`Expected a [x, y] point; got ${JSON.stringify(value)}`);
}

export function buildRevolve(input: {
  name: string;
  sketchFeatureId: string;
  angle: number;
  operationType: string;
}): Record<string, unknown> {
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMFeature-134",
      featureType: "revolve",
      name: input.name,
      suppressed: false,
      namespace: "",
      parameters: [
        pEnum("bodyType", "ExtendedToolBodyType", "SOLID"),
        pEnum("operationType", "NewBodyOperationType", input.operationType),
        sketchRegion("entities", input.sketchFeatureId),
        pQuery(
          "axis",
          `query = qConstructionFilter(qCreatedBy(makeId("${input.sketchFeatureId}"), EntityType.EDGE), ConstructionObject.YES);`,
          input.sketchFeatureId,
        ),
        pBool("fullRevolve", false),
        pEnum("endBound", "RevolveBoundingType", "BLIND"),
        pQuantity("angle", input.angle, "deg"),
        pBool("defaultScope", true),
      ],
    },
  };
}

export function buildOffsetPlane(input: { name: string; basePlane: string; offset: number }): Record<string, unknown> {
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMFeature-134",
      featureType: "cPlane",
      name: input.name,
      suppressed: false,
      namespace: "",
      parameters: [
        pEnum("cplaneType", "CPlaneType", "OFFSET"),
        pDeterministicQuery("entities", [planeId(input.basePlane)]),
        pQuantity("offset", input.offset, "in"),
        pBool("oppositeDirection", false),
      ],
    },
  };
}

export function buildSweep(input: {
  name: string;
  profileSketchFeatureId: string;
  pathSketchFeatureId: string;
  operationType: string;
}): Record<string, unknown> {
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMFeature-134",
      featureType: "sweep",
      name: input.name,
      suppressed: false,
      namespace: "",
      parameters: [
        pEnum("bodyType", "ExtendedToolBodyType", "SOLID"),
        pEnum("operationType", "NewBodyOperationType", input.operationType),
        sketchRegion("profiles", input.profileSketchFeatureId),
        sketchEdges("path", input.pathSketchFeatureId),
        pEnum("profileControl", "ProfileControlMode", "NONE"),
        pBool("hasTwist", false),
        pBool("hasScale", false),
        pBool("trimEnds", true),
        pBool("defaultScope", true),
      ],
    },
  };
}

export function buildBooleanUnion(): Record<string, unknown> {
  return {
    btType: "BTFeatureDefinitionCall-1406",
    feature: {
      btType: "BTMFeature-134",
      featureType: "booleanBodies",
      name: "Union bodies",
      suppressed: false,
      namespace: "",
      parameters: [
        pEnum("operationType", "BooleanOperationType", "UNION"),
        pBool("defaultScope", false),
        pQuery("tools", "query = qAllModifiableSolidBodies();"),
        pBool("toolsExplicit", true),
      ],
    },
  };
}
