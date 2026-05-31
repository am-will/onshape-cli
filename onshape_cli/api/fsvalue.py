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

from typing import Any


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
