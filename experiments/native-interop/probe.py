#!/usr/bin/env python3
"""Dedicated native transports; no inference, existing-session discovery or database."""
import json, os, pathlib, queue, signal, subprocess, threading, time, uuid
from collections import deque
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / ".local/native-interop"
OUT.mkdir(parents=True, exist_ok=True)
class RPC:
    def __init__(self):
        self.p = subprocess.Popen(["codex", "app-server", "--listen", "stdio://"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, start_new_session=True)
        self.q = queue.Queue(); self.n = 0; self.events = deque()
        def read():
            for line in self.p.stdout:
                try: self.q.put(json.loads(line))
                except ValueError: pass
        threading.Thread(target=read, daemon=True).start()
    def call(self, method, params):
        self.n += 1
        self.p.stdin.write(json.dumps(dict(id=self.n,method=method,params=params))+"\n"); self.p.stdin.flush()
        until = time.monotonic()+30
        while time.monotonic()<until:
            msg=self.q.get(timeout=max(.01,until-time.monotonic()))
            if msg.get("id")==self.n:
                if "error" in msg: raise RuntimeError(json.dumps(msg["error"]))
                return msg["result"]
            self.events.append(msg)
        raise TimeoutError(method)
    def next_event(self, timeout):
        return self.events.popleft() if self.events else self.q.get(timeout=timeout)
    def close(self):
        try: os.killpg(self.p.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        try: self.p.wait(timeout=5)
        except subprocess.TimeoutExpired: self.p.kill(); self.p.wait()
        try: os.killpg(self.p.pid, signal.SIGKILL)
        except ProcessLookupError: pass
def main():
    result={"scope":"dedicated process, no model turn; not Desktop proof","tests":[]}
    rpc=RPC()
    try:
        init=rpc.call("initialize",{"clientInfo":{"name":"claudex_probe","version":"0.1"},"capabilities":{"experimentalApi":True}})
        result["tests"].append({"name":"codex_initialize","status":"PASS"})
        # Ephemeral session avoids persisted user history. No turn is started.
        t=rpc.call("thread/start",{"cwd":str(OUT),"ephemeral":True,"environments":[],"baseInstructions":"Synthetic transport probe. No tools or external work."})["thread"]
        assert t.get("ephemeral") is True and t.get("path") is None
        result["ephemeral_response"] = True
        result["rollout_path"] = None
        tid=t["id"]
        r=rpc.call("thread/read",{"threadId":tid,"includeTurns":False})["thread"]
        assert r["id"]==tid
        result["tests"].append({"name":"codex_same_runtime_read","status":"PASS","threadId":tid})
        try:
            rpc.call("thread/read",{"threadId":str(uuid.uuid4()),"includeTurns":False})
            result["tests"].append({"name":"codex_unknown_id_rejected","status":"FAIL"})
        except RuntimeError:
            result["tests"].append({"name":"codex_unknown_id_rejected","status":"PASS"})
    except Exception as e:
        result["tests"].append({"name":"codex_probe","status":"FAIL","reason":str(e)[:400]})
    finally: rpc.close()
    result["unverified"]=["Claude native receive", "cross-vendor read", "model reply", "busy delivery", "existing Desktop"]
    (OUT/"results.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 1 if any(x["status"]=="FAIL" for x in result["tests"]) else 0
if __name__=="__main__": raise SystemExit(main())
