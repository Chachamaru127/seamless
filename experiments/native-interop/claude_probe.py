#!/usr/bin/env python3
"""Probe a dedicated Claude process without requesting a model turn."""
import json, os, pathlib, shlex, signal, subprocess, time, uuid, socket
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/".local/native-interop"
OUT.mkdir(parents=True,exist_ok=True)
sid=str(uuid.uuid4())
run=OUT/sid
run.mkdir()
hook=run/"hook.py"
hook.write_text("import os,pathlib\npathlib.Path("+repr(str(run/"socket.txt"))+").write_text(os.environ.get('CLAUDE_CODE_MESSAGING_SOCKET',''))\n")
settings={"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"python3 "+shlex.quote(str(hook))}]}]}}
cmd=["claude","-p","--input-format","stream-json","--output-format","stream-json","--verbose","--session-id",sid,"--settings",json.dumps(settings),"--setting-sources","","--strict-mcp-config","--mcp-config",'{"mcpServers":{}}',"--tools","","--disable-slash-commands"]
config=run/"config"
config.mkdir()
env=dict(os.environ, CLAUDE_CONFIG_DIR=str(config))
p=subprocess.Popen(cmd,cwd=run,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
result={"scope":"dedicated Claude socket connection only; no message sent", "sessionId":sid, "isolated_config":True, "message_sent":False}
try:
    for _ in range(100):
        if (run/"socket.txt").exists() or p.poll() is not None: break
        time.sleep(.2)
    path=(run/"socket.txt").read_text() if (run/"socket.txt").exists() else ""
    result["socket_exported"]=bool(path)
    if path:
        raw=path.removeprefix("uds:")
        result["socket_exists"]=pathlib.Path(raw).is_socket()
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
            s.settimeout(2); s.connect(raw)
            # Connect and close without sending any application frame.
        result["native_socket_connect"]="PASS"
    else: result["native_socket_connect"]="UNVERIFIED"
finally:
    try: os.killpg(p.pid,signal.SIGTERM)
    except ProcessLookupError: pass
    try: stdout,stderr=p.communicate(timeout=5)
    except subprocess.TimeoutExpired: p.kill();stdout,stderr=p.communicate()
    try: os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError: pass
    result["exit_after_termination"]=p.returncode
    result["output_types"]=[]
    for line in stdout.splitlines():
        try: result["output_types"].append(json.loads(line).get("type"))
        except ValueError: pass
    # Do not persist raw initialization, environment, or credentials.
    (OUT/"claude-results.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))

raise SystemExit(0 if result.get("native_socket_connect")=="PASS" else 2)
