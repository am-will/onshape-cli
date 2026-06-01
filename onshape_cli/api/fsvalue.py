"""Decode Onshape FeatureScript values (BTFSValue trees) into plain Python.

The ``/featurescript`` endpoint returns a tagged ``BTFSValue`` tree. Real
responses look like::

    {"btType": "com.belmonttech.serialize.fsvalue.BTFSValueNumber",
     "typeTag": "", "value": 2.0}
    {"btType": "...BTFSValueMap", "value": [
        {"btType": "BTFSValueMapEntry-2077", "key": <node>, "value": <node>}, ...]}
    {"btType": "...BTFSValueArray", "value": [<node>, ...]}

i.e. the payload is on ``value`` directly (NOT nested under ``message``), and the
btType is fully-qualified. This decoder keys off btType substrings so it works for
both qualified (``com.belmonttech...BTFSValueMap``) and short (``BTFSValueMap-2062``)
forms, and tolerates a legacy ``message``-wrapped shape.
"""

from typing import Any, Dict, List


class FeatureScriptError(Exception):
    """A ``/featurescript`` evaluation that failed (``result`` is null).

    Onshape returns HTTP 200 with ``result: null`` and the real explanation in
    ``notices`` (e.g. a SEMANTIC error like an undefined variable or a map-key
    name collision). ``.notices`` holds the parsed ``[{type, message}, ...]``.
    """

    def __init__(self, notices: List[Dict[str, Any]]):
        self.notices = notices
        msg = notices[0]["message"] if notices else "unknown FeatureScript error"
        super().__init__(msg)


def featurescript_messages(resp: Any) -> List[Dict[str, Any]]:
    """Extract ``[{type, message}, ...]`` from a ``/featurescript`` response's notices.

    Notices carry the human-readable reason an evaluation failed or warned; the
    rest of the response throws them away. Returns ``[]`` when there are none.
    """
    out: List[Dict[str, Any]] = []
    if isinstance(resp, dict):
        for n in resp.get("notices") or []:
            if isinstance(n, dict) and n.get("message"):
                out.append({"type": n.get("type"), "message": n["message"]})
    return out


def decode_fs_value(value: Any) -> Any:
    """Recursively decode a BTFSValue tree: maps->dict, arrays->list, scalars->value.

    Safe on already-plain data. Numbers-with-units return the raw number.
    """
    if not isinstance(value, dict):
        return value
    bt = value.get("btType", "")
    # Payload is on `value` directly; a legacy shape wraps it under `message`.
    payload = value
    if "value" not in value and isinstance(value.get("message"), dict):
        payload = value["message"]

    if "BTFSValueMap" in bt and "Entry" not in bt:
        out = {}
        for entry in payload.get("value", []) or []:
            out[decode_fs_value(entry.get("key"))] = decode_fs_value(entry.get("value"))
        return out
    if "BTFSValueArray" in bt:
        return [decode_fs_value(x) for x in payload.get("value", []) or []]
    # Scalars: Number / String / Boolean / WithUnits / Undefined / Other …
    return payload.get("value")
