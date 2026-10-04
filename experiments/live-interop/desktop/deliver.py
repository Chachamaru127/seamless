#!/usr/bin/env python3
"""One explicitly invoked, fixed Desktop interoperability delivery; no retries."""
import argparse
import json
import struct
import subprocess

from probe import CLIENT_TYPE, ROOT_THREAD, ReadOnlyIPC, request

DESKTOP_PID = 41846
RUNTIME_PID = 43343
DESKTOP_EXECUTABLE = "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT"
RUNTIME_EXECUTABLE = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"
BODY = ("DESKTOP_RX_73: interoperability test data only; no action, approval, "
        "settings change, or reply required. Continue current research.")


def runtime_metadata():
    """Inspect process identities only, without command arguments or environment."""
    completed = subprocess.run(
        ["ps", "-p", f"{DESKTOP_PID},{RUNTIME_PID}", "-o", "pid=,ppid=,comm="],
        text=True, capture_output=True, check=True,
    )
    processes = {}
    for line in completed.stdout.splitlines():
        pid, parent, executable = line.strip().split(None, 2)
        processes[int(pid)] = (int(parent), executable)
    if (processes.get(DESKTOP_PID, (None, None))[1] != DESKTOP_EXECUTABLE
            or processes.get(RUNTIME_PID) != (DESKTOP_PID, RUNTIME_EXECUTABLE)):
        raise RuntimeError("original Desktop/runtime process identity changed; no delivery attempted")
    return {"desktopPid": DESKTOP_PID, "runtimePid": RUNTIME_PID,
            "runtimeParentPid": DESKTOP_PID}


def delivery_frame(client_id, owner_id):
    envelope = {"schemaVersion": 1, "messageId": "DESKTOP_RX_73",
                "sender": "claude-test", "authority": "external_ai_request",
                "humanApproval": False, "message": BODY}
    return request(
        "thread-follower-start-turn",
        {"conversationId": ROOT_THREAD,
         "turnStart": {"request": {"threadId": ROOT_THREAD, "input": [],
                                    "toolOutput": {"namespace": "claudex_test",
                                                   "name": "external_message",
                                                   "output": json.dumps(envelope, separators=(",", ":"))}},
                       "context": {"inheritThreadSettings": True}}},
        client_id, 2, owner_id,
    )


def deliver_once():
    """Initialize, discover the existing root owner, then send the fixed frame once.

    A successful response is acceptance only. No stream/history subscription or
    completion wait is performed. Envelope sender is declared bridge data, not
    an authenticated native peer identity. There is no fallback or retry.
    """
    metadata = {}
    ipc = None
    attempted = False
    phase = "runtime-identity"
    owner_id = None
    try:
        metadata = runtime_metadata()
        phase = "connect"
        ipc = ReadOnlyIPC()
        phase = "initialize"
        initial = request("initialize", {"clientType": CLIENT_TYPE}, "initializing-client", 0)
        ipc.send_read_only(initial)
        response = ipc.receive_response(initial["requestId"])
        if response.get("resultType") != "success":
            return {"phase": phase, "resultType": response.get("resultType"),
                    "error": response.get("error"), "deliveryAttempted": False, **metadata}
        client_id = response["result"]["clientId"]
        phase = "thread-owner-discovery"
        lookup = request(phase, {"hostId": "local", "conversationId": ROOT_THREAD}, client_id, 1)
        ipc.send_read_only(lookup)
        response = ipc.receive_response(lookup["requestId"])
        if response.get("resultType") != "success":
            return {"phase": phase, "resultType": response.get("resultType"),
                    "error": response.get("error"), "deliveryAttempted": False, **metadata}
        owner_id = response["handledByClientId"]
        if not isinstance(owner_id, str) or not owner_id:
            raise RuntimeError("owner discovery returned no owner ID; no delivery attempted")
        if (response.get("result") or {}).get("supportsUntrustedAppInput") is not True:
            raise RuntimeError("owner does not advertise untrusted app input; no delivery attempted")
        runtime_metadata()
        phase = "thread-follower-start-turn"
        frame = delivery_frame(client_id, owner_id)
        body = json.dumps(frame, separators=(",", ":")).encode()
        attempted = True  # A transport error from this point is an unknown outcome.
        ipc.sock.sendall(struct.pack("<I", len(body)) + body)
        response = ipc.receive_response(frame["requestId"])
        result = (response.get("result") or {}).get("result") or {}
        turn = result.get("turn") or {}
        after = runtime_metadata()
        if response.get("resultType") == "success" and response.get("handledByClientId") != owner_id:
            raise RuntimeError("delivery response owner differs from discovered owner")
        return {"phase": phase, "conversationId": ROOT_THREAD,
                "messageId": "DESKTOP_RX_73", "resultType": response.get("resultType"),
                "error": response.get("error"), "handledByClientId": response.get("handledByClientId"),
                "discoveredOwnerId": owner_id, "turnId": turn.get("id"),
                "turnStatus": turn.get("status"), "deliveryAttempted": True,
                "completionObserved": False, "originalRuntimePreserved": True, **after}
    except (OSError, RuntimeError, KeyError, ValueError, subprocess.CalledProcessError) as error:
        return {"phase": phase, "conversationId": ROOT_THREAD, "resultType": "probe-error",
                "error": str(error), "deliveryAttempted": attempted,
                "outcomeUnknown": attempted, "discoveredOwnerId": owner_id,
                "completionObserved": False, **metadata}
    finally:
        if ipc is not None:
            ipc.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--send", action="store_true",
                        help="Perform the fixed, single delivery; otherwise print an offline frame")
    args = parser.parse_args()
    if not args.send:
        print(json.dumps({"deliveryAttempted": False, "networkUsed": False,
                          "frame": delivery_frame("__LIVE_INITIALIZED_CLIENT_ID__", "__LIVE_DISCOVERED_OWNER_ID__")},
                         ensure_ascii=False, indent=2))
        return 0
    result = deliver_once()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("resultType") == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
