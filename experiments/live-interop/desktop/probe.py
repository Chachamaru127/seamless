#!/usr/bin/env python3
"""Desktop IPC owner discovery and offline frames; no delivery implementation."""
import argparse
import json
import os
import socket
import stat
import struct
import time
import uuid

ROOT_THREAD = "01a0f59d-d3d1-79a2-948c-4a1f12a0a1a5"
SOCKET_PATH = "/Users/tachibanashuuta/.codex/ipc/ipc.sock"
CLIENT_TYPE = "claudex-desktop-probe"
SAFE_METHODS = {"initialize", "thread-owner-discovery"}


def request(method, params, client_id, version, owner_id=None):
    frame = {"type": "request", "requestId": str(uuid.uuid4()),
             "sourceClientId": client_id, "version": version,
             "method": method, "params": params, "timeoutMs": 5000}
    if owner_id is not None:
        frame["targetClientId"] = owner_id
    return frame


class ReadOnlyIPC:
    def __init__(self):
        parent = os.lstat(os.path.dirname(SOCKET_PATH))
        endpoint = os.lstat(SOCKET_PATH)
        if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid()
                or parent.st_mode & 0o022):
            raise RuntimeError("unsafe IPC directory")
        if not stat.S_ISSOCK(endpoint.st_mode) or endpoint.st_uid != os.getuid():
            raise RuntimeError("IPC endpoint is not an owned Unix socket")
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(8)
        self.sock.connect(SOCKET_PATH)
        self.buffer = b""

    def close(self):
        self.sock.close()

    def send_read_only(self, frame):
        if frame.get("type") != "request" or frame.get("method") not in SAFE_METHODS:
            raise RuntimeError("delivery and broadcasts are disabled")
        if frame["method"] == "initialize":
            if frame["params"] != {"clientType": CLIENT_TYPE}:
                raise RuntimeError("only the honest probe clientType is allowed")
        elif frame["params"] != {"hostId": "local", "conversationId": ROOT_THREAD}:
            raise RuntimeError("only root conversation owner discovery is allowed")
        body = json.dumps(frame, separators=(",", ":")).encode()
        self.sock.sendall(struct.pack("<I", len(body)) + body)

    def receive_response(self, request_id):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            while len(self.buffer) < 4:
                self._read()
            size = struct.unpack("<I", self.buffer[:4])[0]
            if size < 1 or size > 268435456:
                raise RuntimeError("invalid IPC frame size")
            while len(self.buffer) < size + 4:
                self._read()
            body = self.buffer[4:4 + size]
            self.buffer = self.buffer[4 + size:]
            message = json.loads(body)
            if message.get("type") == "response" and message.get("requestId") == request_id:
                return message
            # No stream subscription, history request, logging, or broadcast projection.
            del message, body
        raise TimeoutError("IPC response timed out")

    def _read(self):
        part = self.sock.recv(65536)
        if not part:
            raise ConnectionError("IPC connection closed")
        self.buffer += part


def discover_owner():
    ipc = ReadOnlyIPC()
    try:
        init = request("initialize", {"clientType": CLIENT_TYPE}, "initializing-client", 0)
        ipc.send_read_only(init)
        initial = ipc.receive_response(init["requestId"])
        if initial.get("resultType") != "success":
            return {"phase": "initialize", "resultType": initial.get("resultType"),
                    "error": initial.get("error")}
        client_id = initial["result"]["clientId"]
        lookup = request("thread-owner-discovery",
                         {"hostId": "local", "conversationId": ROOT_THREAD}, client_id, 1)
        ipc.send_read_only(lookup)
        found = ipc.receive_response(lookup["requestId"])
        return {"phase": "thread-owner-discovery", "conversationId": ROOT_THREAD,
                "resultType": found.get("resultType"), "error": found.get("error"),
                "handledByClientId": found.get("handledByClientId"),
                "supportsUntrustedAppInput": (found.get("result") or {}).get("supportsUntrustedAppInput"),
                "deliveryEnabled": False}
    finally:
        ipc.close()


def dry_run(owner_id):
    sender = "__CLIENT_ID_RETURNED_BY_INITIALIZE_ON_THIS_CONNECTION__"
    owner = owner_id or "__OWNER_ID_RETURNED_BY_CURRENT_OWNER_DISCOVERY__"
    envelope = {"schemaVersion": 1, "messageId": str(uuid.uuid4()),
                "authority": "external_ai_request", "declaredAuthor": "Claude",
                "sourceKind": "external_ai", "message": "Dry-run fixture only. No action requested.",
                "humanApproval": False}
    tool_output = {"namespace": "claudex_test", "name": "external_message",
                   "output": json.dumps(envelope, separators=(",", ":"))}
    start = request("thread-follower-start-turn",
                    {"conversationId": ROOT_THREAD,
                     "turnStart": {"request": {"threadId": ROOT_THREAD, "input": [],
                                                "toolOutput": tool_output},
                                   "context": {"inheritThreadSettings": True}}}, sender, 2, owner)
    restore_id = str(uuid.uuid4())
    steer = request("thread-follower-steer-turn",
                    {"conversationId": ROOT_THREAD, "input": [], "toolOutput": tool_output,
                     "attachments": [], "clientUserMessageId": restore_id,
                     "restoreMessage": {"id": restore_id, "text": "", "createdAt": int(time.time() * 1000),
                                        "context": {"prompt": "", "workspaceRoots": [],
                                                    "addedFiles": [], "fileAttachments": [],
                                                    "imageAttachments": [], "ideContext": None}}}, sender, 1, owner)
    return {"deliveryEnabled": False, "networkUsed": False,
            "targetConversationId": ROOT_THREAD, "protocol": "4-byte LE length + UTF-8 JSON",
            "sourceIdentity": "Custom tool output; declaredAuthor is not native peer authentication",
            "versions": {"initialize": 0, "thread-owner-discovery": 1,
                         "thread-follower-start-turn": 2, "thread-follower-steer-turn": 1},
            "startFrame": start, "steerFrame": steer,
            "conditions": ["Resolve client and owner IDs on the same live connection",
                           "Owner must still own and stream this conversation",
                           "Keep model, effort, permissions, workspace and collaboration overrides omitted",
                           "Start toolOutput requires input=[] and a nonempty tool name",
                           "Steer requires an active turn; toolOutput maps to turn/start rather than public turn/steer",
                           "No context.responseItems: that path injects items and refuses busy app context",
                           "Do not register as a stream follower: it causes a full conversation snapshot",
                           "A delivery implementation and explicit delivery authorization are still required"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    sub.add_parser("owner", help="Only initialize and discover the specified root owner")
    offline = sub.add_parser("dry-run", help="Generate frames offline; never connects or sends")
    offline.add_argument("--owner-id", help="Optional observed owner ID; rerun owner discovery before delivery")
    args = parser.parse_args()
    result = discover_owner() if args.mode == "owner" else dry_run(args.owner_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if args.mode == "dry-run" or result.get("resultType") == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
