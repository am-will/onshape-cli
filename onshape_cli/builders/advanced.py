"""Advanced feature builders for Onshape (fillet, chamfer, shell, patterns, etc.).

All builders here emit the standard ``BTFeatureDefinitionCall-1406`` envelope that
the Onshape ``POST .../features`` endpoint expects.  The key design choice that
makes these robust is **query-string based entity selection**: instead of
requiring pre-fetched deterministic edge IDs (which are fragile and were the
reason the original ``create_fillet`` failed), every selection can be expressed
as a FeatureScript query that Onshape evaluates server-side when the feature is
added -- the same mechanism the working extrude builder uses with
``qSketchRegion``.
"""

from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# Low-level parameter helpers
# ---------------------------------------------------------------------------

def feature_call(
    feature_type: str,
    name: str,
    parameters: List[Dict[str, Any]],
    namespace: str = "",
) -> Dict[str, Any]:
    """Wrap a list of parameters in the standard add-feature envelope."""
    return {
        "btType": "BTFeatureDefinitionCall-1406",
        "feature": {
            "btType": "BTMFeature-134",
            "featureType": feature_type,
            "name": name,
            "suppressed": False,
            "namespace": namespace,
            "parameters": parameters,
        },
    }


def p_query(
    parameter_id: str,
    *,
    deterministic_ids: Optional[List[str]] = None,
    query_string: Optional[str] = None,
    feature_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a ``BTMParameterQueryList-148`` query parameter.

    Provide either ``deterministic_ids`` (explicit topology IDs) and/or a
    ``query_string`` (a FeatureScript expression like
    ``query = qCreatedBy(makeId("FID"), EntityType.EDGE);``).  When a query
    string is supplied Onshape re-evaluates it on every regen, so the selection
    survives topology changes.
    """
    query: Dict[str, Any] = {
        "btType": "BTMIndividualQuery-138",
        "deterministicIds": deterministic_ids or [],
    }
    if query_string:
        query["queryStatement"] = None
        query["queryString"] = query_string
    if feature_id:
        query["featureId"] = feature_id
    return {
        "btType": "BTMParameterQueryList-148",
        "queries": [query],
        "parameterId": parameter_id,
        "parameterName": "",
        "libraryRelationType": "NONE",
    }


def p_sketch_region(parameter_id: str, sketch_feature_id: str) -> Dict[str, Any]:
    """Sketch-region query parameter, matching the proven extrude form."""
    return {
        "btType": "BTMParameterQueryList-148",
        "queries": [
            {
                "btType": "BTMIndividualSketchRegionQuery-140",
                "queryStatement": None,
                "filterInnerLoops": True,
                "queryString": f'query = qSketchRegion(id + "{sketch_feature_id}", true);',
                "featureId": sketch_feature_id,
                "deterministicIds": [],
            }
        ],
        "parameterId": parameter_id,
        "parameterName": "",
        "libraryRelationType": "NONE",
    }


def p_quantity(
    parameter_id: str,
    value: float,
    units: str = "in",
    *,
    variable: Optional[str] = None,
    is_integer: bool = False,
) -> Dict[str, Any]:
    """Build a ``BTMParameterQuantity-147`` quantity parameter."""
    if variable:
        expression = f"#{variable}"
    elif is_integer:
        expression = f"{int(value)}"
    elif units:
        expression = f"{value} {units}"
    else:
        expression = f"{value}"
    return {
        "btType": "BTMParameterQuantity-147",
        "isInteger": is_integer,
        "value": value,
        "units": "",
        "expression": expression,
        "parameterId": parameter_id,
        "parameterName": "",
        "libraryRelationType": "NONE",
    }


def p_enum(parameter_id: str, enum_name: str, value: str) -> Dict[str, Any]:
    """Build a ``BTMParameterEnum-145`` enum parameter."""
    return {
        "btType": "BTMParameterEnum-145",
        "namespace": "",
        "enumName": enum_name,
        "value": value,
        "parameterId": parameter_id,
        "parameterName": "",
        "libraryRelationType": "NONE",
    }


def p_bool(parameter_id: str, value: bool) -> Dict[str, Any]:
    """Build a ``BTMParameterBoolean-144`` boolean parameter."""
    return {
        "btType": "BTMParameterBoolean-144",
        "value": value,
        "parameterId": parameter_id,
        "parameterName": "",
        "libraryRelationType": "NONE",
    }


# ---------------------------------------------------------------------------
# Reusable edge / body / face selection query strings
# ---------------------------------------------------------------------------

def q_all_edges() -> str:
    """FeatureScript query selecting every edge of every solid body."""
    return "query = qOwnedByBody(qAllModifiableSolidBodies(), EntityType.EDGE);"


def q_edges_of_feature(feature_id: str) -> str:
    """Edges created by a given feature."""
    return f'query = qCreatedBy(makeId("{feature_id}"), EntityType.EDGE);'


def q_circular_edges() -> str:
    """All circular / arc edges of every solid body."""
    return (
        "query = qGeometry(qOwnedByBody(qAllModifiableSolidBodies(), "
        "EntityType.EDGE), GeometryType.CIRCLE);"
    )


def q_all_bodies() -> str:
    """All modifiable solid bodies."""
    return "query = qAllModifiableSolidBodies();"


def q_body_of_feature(feature_id: str) -> str:
    """Bodies created by a given feature."""
    return f'query = qCreatedBy(makeId("{feature_id}"), EntityType.BODY);'


def _resolve_entity_query(
    parameter_id: str,
    *,
    edge_ids: Optional[List[str]] = None,
    query_string: Optional[str] = None,
    feature_id: Optional[str] = None,
    select_all: bool = False,
    circular: bool = False,
    entity: str = "EDGE",
) -> Dict[str, Any]:
    """Pick the right selection strategy for an entity parameter."""
    if edge_ids:
        return p_query(parameter_id, deterministic_ids=edge_ids)
    if query_string:
        return p_query(parameter_id, query_string=query_string)
    if feature_id:
        qs = (
            q_edges_of_feature(feature_id)
            if entity == "EDGE"
            else q_body_of_feature(feature_id)
        )
        return p_query(parameter_id, query_string=qs)
    if circular:
        return p_query(parameter_id, query_string=q_circular_edges())
    if select_all:
        return p_query(parameter_id, query_string=q_all_edges())
    raise ValueError(
        "No selection provided: pass edge_ids, query_string, feature_id, "
        "select_all=True, or circular=True"
    )


# ---------------------------------------------------------------------------
# Feature builders
# ---------------------------------------------------------------------------

def build_fillet(
    name: str = "Fillet",
    radius: float = 0.1,
    *,
    edge_ids: Optional[List[str]] = None,
    query_string: Optional[str] = None,
    feature_id: Optional[str] = None,
    select_all: bool = False,
    circular: bool = False,
    radius_variable: Optional[str] = None,
    fillet_type: str = "EDGE",
) -> Dict[str, Any]:
    """Build a fillet feature.

    Selection (one required): ``edge_ids`` / ``query_string`` / ``feature_id``
    (fillet edges of that feature) / ``select_all`` (all edges) /
    ``circular`` (all circular edges).
    """
    entities = _resolve_entity_query(
        "entities",
        edge_ids=edge_ids,
        query_string=query_string,
        feature_id=feature_id,
        select_all=select_all,
        circular=circular,
    )
    return feature_call(
        "fillet",
        name,
        [
            entities,
            p_quantity("radius", radius, variable=radius_variable),
            p_enum("filletType", "FilletType", fillet_type),
        ],
    )


def build_chamfer(
    name: str = "Chamfer",
    width: float = 0.1,
    *,
    edge_ids: Optional[List[str]] = None,
    query_string: Optional[str] = None,
    feature_id: Optional[str] = None,
    select_all: bool = False,
    circular: bool = False,
    width_variable: Optional[str] = None,
    chamfer_type: str = "EQUAL_OFFSETS",
    angle: Optional[float] = None,
) -> Dict[str, Any]:
    """Build a chamfer feature (default: equal-offset 45deg chamfer)."""
    entities = _resolve_entity_query(
        "entities",
        edge_ids=edge_ids,
        query_string=query_string,
        feature_id=feature_id,
        select_all=select_all,
        circular=circular,
    )
    params = [
        entities,
        p_enum("chamferType", "ChamferType", chamfer_type),
        p_quantity("width", width, variable=width_variable),
    ]
    if chamfer_type == "OFFSET_ANGLE" and angle is not None:
        params.append(p_quantity("angle", angle, units="deg"))
    return feature_call("chamfer", name, params)


def build_shell(
    name: str = "Shell",
    thickness: float = 0.125,
    *,
    face_ids: Optional[List[str]] = None,
    query_string: Optional[str] = None,
    thickness_variable: Optional[str] = None,
    inward: bool = True,
) -> Dict[str, Any]:
    """Build a shell feature. ``face_ids``/``query_string`` are faces to remove."""
    if face_ids:
        entities = p_query("entities", deterministic_ids=face_ids)
    elif query_string:
        entities = p_query("entities", query_string=query_string)
    else:
        # Hollow with no face removed (fully enclosed shell)
        entities = p_query("entities", deterministic_ids=[])
    return feature_call(
        "shell",
        name,
        [
            entities,
            p_quantity("thickness", thickness, variable=thickness_variable),
            p_bool("oppositeDirection", not inward),
        ],
    )


def build_draft(
    name: str = "Draft",
    angle: float = 3.0,
    *,
    neutral_plane_query: str,
    face_query: str,
) -> Dict[str, Any]:
    """Build a draft feature. Needs a neutral plane and faces to draft."""
    return feature_call(
        "draft",
        name,
        [
            p_query("neutralPlane", query_string=neutral_plane_query),
            p_query("draftFaces", query_string=face_query),
            p_quantity("angle", angle, units="deg"),
            p_bool("oppositeDirection", False),
        ],
    )


def build_revolve(
    name: str = "Revolve",
    *,
    sketch_feature_id: str,
    axis_query: Optional[str] = None,
    axis_ids: Optional[List[str]] = None,
    operation_type: str = "NEW",
    revolve_type: str = "FULL",
    angle: float = 360.0,
) -> Dict[str, Any]:
    """Build a revolve feature around an axis.

    ``axis_ids`` (deterministic IDs) or ``axis_query`` selects the axis line.
    """
    if axis_ids:
        axis = p_query("axis", deterministic_ids=axis_ids)
    else:
        axis = p_query("axis", query_string=axis_query)
    full = revolve_type == "FULL"
    params = [
        p_enum("bodyType", "ExtendedToolBodyType", "SOLID"),
        p_enum("operationType", "NewBodyOperationType", operation_type),
        p_sketch_region("entities", sketch_feature_id),
        axis,
        p_bool("fullRevolve", full),
    ]
    if not full:
        params.append(p_enum("endBound", "RevolveBoundingType", "BLIND"))
        params.append(p_quantity("angle", angle, units="deg"))
    params.append(p_bool("defaultScope", True))
    return feature_call("revolve", name, params)


def build_boolean(
    name: str = "Boolean",
    *,
    operation_type: str = "UNION",
    tools_query: Optional[str] = None,
    tool_ids: Optional[List[str]] = None,
    targets_query: Optional[str] = None,
    keep_tools: bool = False,
) -> Dict[str, Any]:
    """Build a boolean feature (UNION / SUBTRACTION / INTERSECTION) over bodies."""
    if tool_ids:
        tools = p_query("tools", deterministic_ids=tool_ids)
    elif tools_query:
        tools = p_query("tools", query_string=tools_query)
    else:
        tools = p_query("tools", query_string=q_all_bodies())
    # Real spec params: operationType, defaultScope, tools, toolsExplicit,
    # targetsAndToolsNeedGrouping, targets.
    params = [
        p_enum("operationType", "BooleanOperationType", operation_type),
        p_bool("defaultScope", False),
        tools,
        p_bool("toolsExplicit", True),
    ]
    if operation_type == "SUBTRACTION":
        params.append(p_bool("targetsAndToolsNeedGrouping", False))
        if targets_query:
            params.append(p_query("targets", query_string=targets_query))
    return feature_call("booleanBodies", name, params)


def build_mirror(
    name: str = "Mirror",
    *,
    pattern_type: str = "PART",
    entities_query: str,
    mirror_plane_ids: Optional[List[str]] = None,
    mirror_plane_query: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a mirror pattern about a plane."""
    if mirror_plane_ids:
        plane = p_query("mirrorPlane", deterministic_ids=mirror_plane_ids)
    elif mirror_plane_query:
        plane = p_query("mirrorPlane", query_string=mirror_plane_query)
    else:
        raise ValueError("Provide mirror_plane_ids or mirror_plane_query")
    return feature_call(
        "mirror",
        name,
        [
            p_enum("patternType", "MirrorType", pattern_type),
            p_enum("operationType", "NewBodyOperationType", "NEW"),
            p_query("entities", query_string=entities_query),
            plane,
        ],
    )


def build_linear_pattern(
    name: str = "Linear Pattern",
    *,
    pattern_type: str = "PART",
    entities_query: str,
    direction_query: Optional[str] = None,
    direction_ids: Optional[List[str]] = None,
    distance: float,
    instance_count: int,
    opposite: bool = False,
) -> Dict[str, Any]:
    """Build a linear pattern along a direction.

    The direction must resolve to a real linear edge/axis: pass ``direction_ids``
    (deterministic edge IDs, the most reliable) or ``direction_query``. A
    construction-line query usually will NOT resolve.
    """
    if direction_ids:
        direction = p_query("directionOne", deterministic_ids=direction_ids)
    else:
        direction = p_query("directionOne", query_string=direction_query)
    return feature_call(
        "linearPattern",
        name,
        [
            p_enum("patternType", "PatternType", pattern_type),
            p_enum("operationType", "NewBodyOperationType", "NEW"),
            p_query("entities", query_string=entities_query),
            direction,
            p_bool("oppositeDirection", opposite),
            p_quantity("distance", distance),
            p_quantity("instanceCount", instance_count, units="", is_integer=True),
            p_bool("hasSecondDir", False),
        ],
    )


def build_circular_pattern(
    name: str = "Circular Pattern",
    *,
    pattern_type: str = "PART",
    entities_query: str,
    axis_query: Optional[str] = None,
    axis_ids: Optional[List[str]] = None,
    instance_count: int,
    angle: float = 360.0,
    equal_spacing: bool = True,
) -> Dict[str, Any]:
    """Build a circular pattern about an axis.

    The axis must resolve to a real straight edge/axis: pass ``axis_ids``
    (deterministic edge IDs, most reliable) or ``axis_query``.
    """
    if axis_ids:
        axis = p_query("axis", deterministic_ids=axis_ids)
    else:
        axis = p_query("axis", query_string=axis_query)
    return feature_call(
        "circularPattern",
        name,
        [
            p_enum("patternType", "PatternType", pattern_type),
            p_enum("operationType", "NewBodyOperationType", "NEW"),
            p_query("entities", query_string=entities_query),
            axis,
            p_quantity("angle", angle, units="deg"),
            p_quantity("instanceCount", instance_count, units="", is_integer=True),
            p_bool("equalSpace", equal_spacing),
        ],
    )


def build_assembly_mate(
    name: str = "Mate",
    *,
    mate_type: str = "FASTENED",
    mate_connector_ids: List[str],
) -> Dict[str, Any]:
    """Build a mate between two existing mate connectors (by their feature ids).

    ``mate_type`` is one of FASTENED, SLIDER, CYLINDRICAL, REVOLUTE, PIN_SLOT,
    PLANAR, BALL, PARALLEL. ``mate_connector_ids`` are the feature ids of two mate
    connectors already present in the assembly (from get-assembly-features). This is
    posted to the assembly ``/features`` endpoint, not the part-studio one.
    """
    queries = [
        {
            "btType": "BTMFeatureQueryWithOccurrence-157",
            "path": [],
            "featureId": fid,
            "queryData": "",
        }
        for fid in mate_connector_ids
    ]
    # The assembly addFeature endpoint uses the SAME BTFeatureDefinitionCall-1406
    # wrapper as part studios (verified live; BTAssemblyFeatureDefinitionParams is
    # rejected). Mate params (verified via featurespecs): mateType + mateConnectorsQuery.
    return {
        "btType": "BTFeatureDefinitionCall-1406",
        "feature": {
            "btType": "BTMMate-64",
            "featureType": "mate",
            "name": name,
            "suppressed": False,
            "parameters": [
                p_enum("mateType", "Mate type", mate_type),
                {
                    "btType": "BTMParameterQueryWithOccurrenceList-67",
                    "queries": queries,
                    "parameterId": "mateConnectorsQuery",
                },
            ],
        },
    }


def build_assembly_mate_connector(
    name: str = "Mate connector",
    *,
    occurrence_id: str,
    inference_type: str = "CENTROID",
) -> Dict[str, Any]:
    """Build a mate connector at an inferred origin on an instance.

    Verified live: ``BTMMateConnector-66`` / featureType ``mateConnector`` with an
    ``originType`` enum (enumName "Origin type", value ON_ENTITY) and an ``originQuery`` whose
    single ``BTMInferenceQueryWithOccurrence-1083`` infers a point (e.g. CENTROID)
    on the given occurrence. The returned feature id is what ``build_assembly_mate``
    references.
    """
    return {
        "btType": "BTFeatureDefinitionCall-1406",
        "feature": {
            "btType": "BTMMateConnector-66",
            "featureType": "mateConnector",
            "name": name,
            "suppressed": False,
            "parameters": [
                {
                    "btType": "BTMParameterEnum-145",
                    "enumName": "Origin type",
                    "value": "ON_ENTITY",
                    "parameterId": "originType",
                    "namespace": "",
                },
                {
                    "btType": "BTMParameterQueryWithOccurrenceList-67",
                    "parameterId": "originQuery",
                    "queries": [
                        {
                            "btType": "BTMInferenceQueryWithOccurrence-1083",
                            "inferenceType": inference_type,
                            "path": [occurrence_id],
                            "deterministicIds": [],
                        }
                    ],
                },
            ],
        },
    }


def build_assembly_group(
    name: str = "Group",
    *,
    occurrence_ids: List[str],
) -> Dict[str, Any]:
    """Build a 'group' assembly feature fixing a set of instances together.

    Verified live: featureType ``mateGroup`` / ``BTMMateGroup-65`` with parameter
    ``occurrencesQuery`` whose queries are ``BTMIndividualOccurrenceQuery-626``
    entries, each ``path`` being a single instance id from get-assembly.
    """
    queries = [
        {
            "btType": "BTMIndividualOccurrenceQuery-626",
            "path": [oid],
        }
        for oid in occurrence_ids
    ]
    return {
        "btType": "BTFeatureDefinitionCall-1406",
        "feature": {
            "btType": "BTMMateGroup-65",
            "featureType": "mateGroup",
            "name": name,
            "suppressed": False,
            "parameters": [
                {
                    "btType": "BTMParameterQueryWithOccurrenceList-67",
                    "queries": queries,
                    "parameterId": "occurrencesQuery",
                }
            ],
        },
    }


def build_offset_plane(
    name: str = "Plane",
    *,
    base_plane_ids: Optional[List[str]] = None,
    base_plane_query: Optional[str] = None,
    offset: float = 1.0,
) -> Dict[str, Any]:
    """Build an offset construction plane from a base plane."""
    if base_plane_ids:
        base = p_query("entities", deterministic_ids=base_plane_ids)
    elif base_plane_query:
        base = p_query("entities", query_string=base_plane_query)
    else:
        base = p_query("entities", deterministic_ids=["JCC"])  # Front
    return feature_call(
        "cPlane",
        name,
        [
            p_enum("cplaneType", "CPlaneType", "OFFSET"),
            base,
            p_quantity("offset", offset),
            p_bool("oppositeDirection", False),
        ],
    )
