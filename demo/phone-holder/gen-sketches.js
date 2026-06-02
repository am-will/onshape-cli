// Generates BTMSketch-151 JSON for `onshape add-feature --json-file`.
// lineEntity / sketch / planeId mirror node/src/builders/modeling.ts exactly
// (coords in inches here, converted to meters as the builder does).
const fs = require("fs");

const INCH_TO_METER = 0.0254;
const PLANE_IDS = { front: "JCC", top: "JDC", right: "JEC" };
const planeId = (n) => {
  const v = PLANE_IDS[n.toLowerCase()];
  if (!v) throw new Error(`Unknown plane '${n}'`);
  return v;
};
const toMeters = (v) => v * INCH_TO_METER;

function lineEntity(id, start, end, isConstruction = false) {
  const x1 = toMeters(start[0]), y1 = toMeters(start[1]);
  const x2 = toMeters(end[0]), y2 = toMeters(end[1]);
  const dx = x2 - x1, dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) throw new Error("Line start and end must be different.");
  return {
    btType: "BTMSketchCurveSegment-155",
    entityId: id,
    startPointId: `${id}.start`,
    endPointId: `${id}.end`,
    startParam: 0,
    endParam: length,
    geometry: { btType: "BTCurveGeometryLine-117", pntX: x1, pntY: y1, dirX: dx / length, dirY: dy / length },
    isConstruction,
  };
}

function sketch(name, sketchPlaneId, entities) {
  return {
    feature: {
      btType: "BTMSketch-151",
      featureType: "newSketch",
      name,
      suppressed: false,
      parameters: [
        {
          btType: "BTMParameterQueryList-148",
          queries: [{ btType: "BTMIndividualQuery-138", deterministicIds: [sketchPlaneId] }],
          parameterId: "sketchPlane",
        },
      ],
      entities,
      constraints: [],
    },
  };
}

// Closed polygon -> consecutive line segments (last point connects back to first).
function polygon(prefix, pts) {
  const segs = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    segs.push(lineEntity(`${prefix}.${i}`, a, b));
  }
  return segs;
}

// --- Feature 1: side profile (Right plane). x = depth (front at 0), y = height ---
const profilePts = [
  [0.0, 0.0],   // front-bottom
  [2.4, 0.0],   // back-bottom
  [2.4, 1.8],   // back wall outer top
  [2.03, 1.8],  // back wall inner top (10 deg lean)
  [1.8, 0.5],   // back wall inner floor
  [1.25, 0.5],  // slot floor (0.55" gap)
  [1.3, 0.8],   // front block inner top (10 deg lean)
  [0.0, 0.8],   // front block outer top
];
const profile = sketch("Holder profile", planeId("right"), polygon("profile", profilePts));

// --- Feature 3: cable port rectangle (Front plane). x = width (centered 1.65), y = height ---
const portPts = [
  [1.325, -0.10],
  [1.975, -0.10],
  [1.975, 0.62],
  [1.325, 0.62],
];
const port = sketch("Cable port profile", planeId("front"), polygon("port", portPts));

fs.writeFileSync("profile-sketch.json", JSON.stringify(profile, null, 2));
fs.writeFileSync("port-sketch.json", JSON.stringify(port, null, 2));
console.log("wrote profile-sketch.json (" + profilePts.length + " segs) and port-sketch.json (" + portPts.length + " segs)");
