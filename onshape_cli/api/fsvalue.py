"""Decode Onshape FeatureScript values (BTFSValue trees) into plain Python."""

from typing import Any


def decode_fs_value(value: Any) -> Any:
    """Recursively decode a BTFSValue tree: maps->dict, arrays->list, scalars->value.

    Safe on already-plain data. Numbers-with-units return the raw number.
    """
    if not isinstance(value, dict):
        return value
    bt = value.get("btType", "")
    msg = value.get("message", {}) or {}
    if "ValueMap" in bt:
        out = {}
        for entry in msg.get("value", []) or []:
            out[decode_fs_value(entry.get("key"))] = decode_fs_value(entry.get("value"))
        return out
    if "ValueArray" in bt:
        return [decode_fs_value(x) for x in msg.get("value", []) or []]
    return msg.get("value")
