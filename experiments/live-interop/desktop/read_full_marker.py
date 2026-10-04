#!/usr/bin/env python3
"""Root-only full-history read; retain only received marker and load metadata."""
import json
import plistlib
import socket
import struct
import subprocess
import time

from deliver import runtime_metadata
from probe import CLIENT_TYPE, ROOT_THREAD, ReadOnlyIPC, request
from read_marker import project, receive, send_following, turns_in

LIMIT_SECONDS = 40


def owner_snapshot(frame, owner_id, client_id):
    params = frame.get("params") or {}
    change = params.get("change") or {}
    if (frame.get("type") == "broadcast"
            and frame.get("method") == "thread-stream-state-changed"
            and frame.get("version") == 11
            and frame.get("sourceClientId") == owner_id
            and client_id in (frame.get("targetClientIds") or [])
            and params.get("hostId") == "local"
            and params.get("conversationId") == ROOT_THREAD
            and change.get("type") == "snapshot"):
        state = change.get("conversationState")
        if not isinstance(state, dict) or state.get("id") != ROOT_THREAD:
            raise RuntimeError("root snapshot ID mismatch")
        return change
    return None


def loaded_metadata(state):
    history = state.get("turnHistory") or {}
    canonical = history.get("history") or {}
    pagination = state.get("turnsPagination") or {}
    loaded_turns = list(turns_in(state))
    statuses = [(turn.get("itemsPagination") or {}).get("hasLoadedOldest") for turn in loaded_turns]
    explicit_items_loaded = bool(statuses) and all(value is True for value in statuses)
    native_items_complete = all(value is not False for value in statuses)
    with open("/Applications/ChatGPT.app/Contents/Info.plist", "rb") as info_file:
        info = plistlib.load(info_file)
    version_matched = (info.get("CFBundleShortVersionString") == "26.928.31416"
                       and info.get("CFBundleVersion") == "12553")
    kind = history.get("kind")
    complete = canonical.get("isComplete")
    islands = len(canonical.get("islands", []))
    # Fixed Desktop jl/Al predicates allow missing item pagination for canonical history.
    # Report missing fields separately; do not manufacture explicit true values.
    # This observed canonical shape omits source. No legacy/compact fallback.
    allowed_source = pagination.get("source") is None
    confirmed = (kind == "canonical" and complete is True and islands == 1
                 and pagination.get("hasLoadedOldest") is True and allowed_source
                 and version_matched and native_items_complete)
    return {"historyKind": kind, "canonicalIsComplete": complete,
            "canonicalIslandCount": islands, "itemsExplicitlyLoaded": explicit_items_loaded,
            "nativeItemsComplete": native_items_complete, "nativeRuleVersionMatched": version_matched,
            "itemPaginationCounts":{"true":sum(v is True for v in statuses),"false":sum(v is False for v in statuses),"missing":sum(v is None for v in statuses)},
            "turnsHaveLoadedOldest": pagination.get("hasLoadedOldest"),
            "turnsPaginationSource": pagination.get("source"),
            "allowedPaginationSource": allowed_source,
            "resumeState": state.get("resumeState"), "fullHistoryConfirmed": bool(confirmed)}


def read_full_marker():
    ipc = None
    client_id = owner_id = None
    registered = False
    phase = "runtime-identity"
    result = None
    try:
        metadata = runtime_metadata()
        phase = "initialize"
        ipc = ReadOnlyIPC()
        init = request(phase, {"clientType": CLIENT_TYPE}, "initializing-client", 0)
        ipc.send_read_only(init)
        initial = ipc.receive_response(init["requestId"])
        if initial.get("resultType") != "success":
            raise RuntimeError("initialize rejected")
        client_id = initial["result"]["clientId"]
        phase = "thread-owner-discovery"
        lookup = request(phase, {"hostId": "local", "conversationId": ROOT_THREAD}, client_id, 1)
        ipc.send_read_only(lookup)
        response = ipc.receive_response(lookup["requestId"])
        if response.get("resultType") != "success":
            raise RuntimeError("owner discovery rejected")
        owner_id = response["handledByClientId"]
        runtime_metadata()
        registered = True
        send_following(ipc, client_id, owner_id, True)
        phase = "initial-snapshot"
        deadline = time.monotonic() + LIMIT_SECONDS
        ipc.sock.settimeout(LIMIT_SECONDS)
        while time.monotonic() < deadline:
            frame = receive(ipc)
            snapshot = owner_snapshot(frame, owner_id, client_id)
            if snapshot is not None:
                del snapshot, frame
                break
            del frame
        else:
            raise TimeoutError("initial root snapshot limit exceeded")
        phase = "thread-follower-load-complete-history"
        load = request(phase, {"conversationId": ROOT_THREAD}, client_id, 1, owner_id)
        load["timeoutMs"] = LIMIT_SECONDS * 1000
        body = json.dumps(load, separators=(",", ":")).encode()
        ipc.sock.sendall(struct.pack("<I", len(body)) + body)
        deadline = time.monotonic() + LIMIT_SECONDS
        required_revision = None
        while time.monotonic() < deadline:
            frame = receive(ipc)
            if frame.get("type") != "response" or frame.get("requestId") != load["requestId"]:
                del frame
                continue
            if frame.get("resultType") != "success":
                result = {"resultType": "unsupported-or-rejected", "phase": phase,
                          "ownerError": frame.get("error"), "limitSeconds": LIMIT_SECONDS}
                return result
            if frame.get("handledByClientId") != owner_id:
                raise RuntimeError("full-history response owner changed")
            required_revision = (frame.get("result") or {}).get("revision")
            if not isinstance(required_revision, int):
                raise RuntimeError("full-history response omitted integer revision")
            del frame
            break
        if required_revision is None:
            raise TimeoutError("full-history response limit exceeded")
        # A load may publish before its ACK or produce patches. Reaffirming the
        # same subscription explicitly requests the current owner snapshot.
        phase = "snapshot-at-loaded-revision"
        send_following(ipc, client_id, owner_id, True)
        deadline = time.monotonic() + LIMIT_SECONDS
        while time.monotonic() < deadline:
            frame = receive(ipc)
            snapshot = owner_snapshot(frame, owner_id, client_id)
            if snapshot is None or snapshot.get("revision", -1) < required_revision:
                del snapshot, frame
                continue
            state = snapshot["conversationState"]
            matches, _ = project(state)
            loaded = loaded_metadata(state)
            result = {"resultType": "success" if matches and loaded["fullHistoryConfirmed"] else "unconfirmed",
                      "conversationId": ROOT_THREAD, "ownerClientId": owner_id,
                      "responseRevision": required_revision, "snapshotRevision": snapshot["revision"],
                      "matches": matches, "loaded": loaded,
                      "historySaved": False, "bodyProjected": False, **metadata}
            del state, snapshot, frame
            break
        if result is None:
            raise TimeoutError("snapshot at loaded revision limit exceeded")
        phase = "owner-recheck"
        lookup = request("thread-owner-discovery", {"hostId": "local", "conversationId": ROOT_THREAD}, client_id, 1)
        ipc.send_read_only(lookup)
        response = ipc.receive_response(lookup["requestId"])
        if response.get("resultType") != "success" or response.get("handledByClientId") != owner_id:
            raise RuntimeError("owner changed during full-history read")
        runtime_metadata()
        result["ownerUnchanged"] = True
    except (TimeoutError, socket.timeout) as error:
        result = {"resultType": "limit", "phase": phase, "limitSeconds": LIMIT_SECONDS,
                  "error": str(error), "historySaved": False, "bodyProjected": False}
    except (OSError, RuntimeError, KeyError, ValueError, TypeError, subprocess.CalledProcessError) as error:
        result = {"resultType": "probe-error", "phase": phase, "error": str(error),
                  "historySaved": False, "bodyProjected": False}
    finally:
        if ipc is not None:
            try:
                if registered:
                    send_following(ipc, client_id, owner_id, False)
                if result is not None:
                    result["followingReleaseSent"] = registered
            except OSError:
                result = {"resultType": "probe-error", "phase": "release", "error": "following release failed",
                          "historySaved": False, "bodyProjected": False}
            finally:
                ipc.close()
    return result


if __name__ == "__main__":
    outcome = read_full_marker()
    print(json.dumps(outcome, ensure_ascii=False, indent=2))
    raise SystemExit(0 if outcome.get("resultType") == "success" else 1)
