// Generates an `extrude` feature JSON for `onshape add-feature --json-file`,
// mirroring node/src/builders/modeling.ts buildExtrude but exposing oppositeDirection.
// Usage: node gen-extrude.js <sketchFeatureId> <depthInches> <NEW|ADD|REMOVE|INTERSECT> <true|false opposite> "<name>" <outFile>
const fs = require("fs");
const [sketchId, depthStr, op, oppStr, name, outFile] = process.argv.slice(2);
const depth = Number(depthStr);
const opposite = oppStr === "true";

const sketchRegion = (parameterId, sketchFeatureId) => ({
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
});
const pEnum = (parameterId, enumName, value) => ({
  btType: "BTMParameterEnum-145", namespace: "", enumName, value, parameterId, parameterName: "", libraryRelationType: "NONE",
});
const pBool = (parameterId, value) => ({
  btType: "BTMParameterBoolean-144", value, parameterId, parameterName: "", libraryRelationType: "NONE",
});
const pQuantity = (parameterId, value, units) => ({
  btType: "BTMParameterQuantity-147", isInteger: false, value, units: "", expression: `${value} ${units}`, parameterId, parameterName: "", libraryRelationType: "NONE",
});

const feature = {
  btType: "BTFeatureDefinitionCall-1406",
  feature: {
    btType: "BTMFeature-134",
    featureType: "extrude",
    name,
    suppressed: false,
    namespace: "",
    parameters: [
      sketchRegion("entities", sketchId),
      pEnum("operationType", "NewBodyOperationType", op),
      pQuantity("depth", depth, "in"),
      pBool("oppositeDirection", opposite),
      pBool("defaultScope", true),
    ],
  },
};

fs.writeFileSync(outFile, JSON.stringify(feature, null, 2));
console.log(`wrote ${outFile}: ${op} depth=${depth}in opposite=${opposite} sketch=${sketchId}`);
