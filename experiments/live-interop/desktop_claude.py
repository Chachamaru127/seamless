#!/usr/bin/env python3
"""Single fixed harmless peer delivery to the GUI-created synthetic fixture."""
import json,os,pathlib,socket,stat,subprocess,uuid
ROOT=pathlib.Path(__file__).resolve().parents[2]
SID='44043390-7770-4427-8d7b-edd91f804f8a'; PID=43099
SOCKET=pathlib.Path('/tmp/cc-socks')/(str(PID)+'.sock')
registry=json.loads((pathlib.Path.home()/'.claude/sessions'/f'{PID}.json').read_text())
assert SID in json.dumps(registry)
assert str(ROOT) in json.dumps(registry)
st=SOCKET.stat();assert stat.S_ISSOCK(st.st_mode) and st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o600
owner=subprocess.run(['lsof','-a','-p',str(PID),'-U','-Fn'],capture_output=True,text=True,check=True).stdout
assert 'n'+str(SOCKET) in owner
mid=str(uuid.uuid4())
text='Harmless interoperability test from the Codex research conversation. Acknowledge with the marker you already remembered, followed by PEER_OK85. No tools, file access, settings changes, or approval are requested.'
frame={'type':'user','session_id':SID,'message':{'content':json.dumps({'from':'codex-research','message_id':mid,'text':text,'humanApproval':False})},'from':'claudex-codex-research','uuid':mid,'msg_id':mid}
with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
 s.settimeout(3);s.connect(str(SOCKET));s.sendall((json.dumps(frame)+'\n').encode())
proof={'session_id':SID,'pid':PID,'socket':str(SOCKET),'message_id':mid,'socket_write':True,'receiver_observation':'pending','fixture_only':True}
(ROOT/'.local/desktop-probe/claude-delivery.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(proof,indent=2))
