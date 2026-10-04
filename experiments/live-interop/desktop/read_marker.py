#!/usr/bin/env python3
"""Read one root snapshot; project only a fixed received tool-output marker."""
import argparse
import json
import struct
import subprocess
import time

from deliver import runtime_metadata
from probe import CLIENT_TYPE, ROOT_THREAD, ReadOnlyIPC, request

MESSAGE_ID = "DESKTOP_RX_73"


def send_following(ipc, client_id, owner_id, following):
    frame = {"type": "broadcast", "sourceClientId": client_id,
             "targetClientIds": [owner_id], "version": 1,
             "method": "thread-stream-following-changed",
             "params": {"hostId": "local", "conversationId": ROOT_THREAD,
                        "following": following}}
    body = json.dumps(frame, separators=(",", ":")).encode()
    ipc.sock.sendall(struct.pack("<I", len(body)) + body)


def receive(ipc):
    while len(ipc.buffer) < 4:
        ipc._read()
    size = struct.unpack("<I", ipc.buffer[:4])[0]
    if not 1 <= size <= 268435456:
        raise RuntimeError("invalid IPC frame size")
    while len(ipc.buffer) < size + 4:
        ipc._read()
    body = ipc.buffer[4:size + 4]
    ipc.buffer = ipc.buffer[size + 4:]
    return json.loads(body)


def turns_in(state):
    # Loaded canonical history and live overlays both contain original items.
    history = state.get("turnHistory") or {}
    if history.get("kind") == "canonical":
        canonical = history["history"]
        for island in canonical.get("islands", []):
            for entry in island.get("entries", []):
                turn = canonical.get("entitiesByKey", {}).get(entry.get("value"))
                if isinstance(turn, dict):
                    yield turn
    yield from state.get("turns", [])


def project(state):
    matches = {}
    shapes = set()
    for turn in turns_in(state):
        for item in turn.get("items", []):
            kind = item.get("type")
            if isinstance(kind, str):
                shapes.add((kind, tuple(sorted(item.keys()))))
            if (kind != "functionCallOutput" or item.get("name") != "external_message"
                    or item.get("namespace") != "claudex_test"):
                continue
            output = item.get("output")
            if not isinstance(output, str):
                continue
            try:
                envelope = json.loads(output)
            except ValueError:
                continue
            if not isinstance(envelope, dict) or envelope.get("messageId") != MESSAGE_ID:
                continue
            item_id, turn_id = item.get("id"), turn.get("turnId")
            if not isinstance(item_id, str) or not isinstance(turn_id, str):
                continue
            matches[(turn_id, item_id)] = {"messageId": MESSAGE_ID,
                                           "itemId": item_id, "turnId": turn_id}
    return list(matches.values()), [{"type": kind, "keys": list(keys)}
                                    for kind, keys in sorted(shapes)]


def read_marker(include_shape=False):
    ipc = None
    client_id = owner_id = None
    registered = False
    result = None
    try:
        metadata = runtime_metadata()
        ipc = ReadOnlyIPC()
        frame = request("initialize", {"clientType": CLIENT_TYPE}, "initializing-client", 0)
        ipc.send_read_only(frame)
        initialized = ipc.receive_response(frame["requestId"])
        if initialized.get("resultType") != "success":
            raise RuntimeError("initialize rejected")
        client_id = initialized["result"]["clientId"]
        frame = request("thread-owner-discovery", {"hostId": "local", "conversationId": ROOT_THREAD}, client_id, 1)
        ipc.send_read_only(frame)
        owner = ipc.receive_response(frame["requestId"])
        if owner.get("resultType") != "success":
            raise RuntimeError("owner discovery rejected")
        owner_id = owner["handledByClientId"]
        runtime_metadata()
        registered = True
        send_following(ipc, client_id, owner_id, True)
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            frame = receive(ipc)
            params = frame.get("params") or {}
            change = params.get("change") or {}
            if not (frame.get("type") == "broadcast"
                    and frame.get("method") == "thread-stream-state-changed"
                    and frame.get("version") == 11
                    and frame.get("sourceClientId") == owner_id
                    and client_id in (frame.get("targetClientIds") or [])
                    and params.get("conversationId") == ROOT_THREAD
                    and params.get("hostId") == "local" and change.get("type") == "snapshot"):
                del frame, params, change
                continue
            state = change["conversationState"]
            if state.get("id") != ROOT_THREAD:
                raise RuntimeError("snapshot conversation ID mismatch")
            matches, shapes = project(state)
            result = {"resultType": "success" if matches else "marker-not-found",
                      "conversationId": ROOT_THREAD, "ownerClientId": owner_id,
                      "snapshotRevision": change.get("revision"), "matches": matches,
                      "source": "Desktop owner snapshot", "historySaved": False,
                      "bodyProjected": False, **metadata}
            if include_shape:
                result["shape"] = {"stateKeys": sorted(state), "itemShapes": shapes}
            del state, frame, params, change
            break
        if result is None:
            raise TimeoutError("no matched root owner snapshot")
        frame = request("thread-owner-discovery", {"hostId": "local", "conversationId": ROOT_THREAD}, client_id, 1)
        ipc.send_read_only(frame)
        owner_after = ipc.receive_response(frame["requestId"])
        if (owner_after.get("resultType") != "success"
                or owner_after.get("handledByClientId") != owner_id):
            raise RuntimeError("owner changed during snapshot read")
        runtime_metadata()
        result["ownerUnchanged"] = True
    except (OSError, RuntimeError, KeyError, ValueError, TypeError, subprocess.CalledProcessError) as error:
        result = {"resultType": "probe-error", "error": str(error),
                  "conversationId": ROOT_THREAD, "historySaved": False, "bodyProjected": False}
    finally:
        if ipc is not None:
            try:
                if registered:
                    send_following(ipc, client_id, owner_id, False)
                if result is not None:
                    result["followingReleaseSent"] = registered
            except OSError:
                result = {"resultType": "probe-error", "error": "following release failed",
                          "historySaved": False, "bodyProjected": False}
            finally:
                ipc.close()
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shape", action="store_true", help="Include only diagnostic keys and item types")
    args = parser.parse_args()
    result = read_marker(args.shape)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result.get("resultType") == "success" else 1)
