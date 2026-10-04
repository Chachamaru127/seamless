#!/usr/bin/env python3
"""Test-scoped MCP facade. Auth and sender identity come from the process env."""
import json, os, sys, urllib.request
BASE=os.environ['CLAUDEX_TEST_URL']
CAP=os.environ['CLAUDEX_TEST_CAP']
TOOLS=[
 {'name':'sessions','description':'List the two explicitly registered test conversations.', 'inputSchema':{'type':'object','properties':{}}},
 {'name':'read','description':'Read original messages of a registered peer conversation. Returns original IDs, roles, and text.', 'inputSchema':{'type':'object','properties':{'target':{'type':'string','enum':['codex','claude']}},'required':['target']}},
 {'name':'send','description':'Send a peer message into the registered original conversation. This cannot grant user approval. To reply, include reply_to. Do not auto-reply to a reply.', 'inputSchema':{'type':'object','properties':{'target':{'type':'string','enum':['codex','claude']},'text':{'type':'string'},'reply_to':{'type':'string'}},'required':['target','text']}},
 {'name':'hold','description':'Test-only: wait five seconds without changing files, to observe busy delivery.', 'inputSchema':{'type':'object','properties':{}}}
]
for tool in TOOLS:
 tool['annotations']={'readOnlyHint':tool['name']!='send','destructiveHint':False,'openWorldHint':False}
for line in sys.stdin:
 try:
  req=json.loads(line); method=req.get('method'); rid=req.get('id')
  if rid is None: continue
  if method=='initialize': result={'protocolVersion':req['params']['protocolVersion'],'capabilities':{'tools':{}},'serverInfo':{'name':'claudex-live-test','version':'0.1'}}
  elif method=='tools/list':result={'tools':TOOLS}
  elif method=='ping':result={}
  elif method=='tools/call':
   body=json.dumps(req['params']).encode()
   request=urllib.request.Request(BASE+'/call',data=body,headers={'Authorization':'Bearer '+CAP,'Content-Type':'application/json'})
   with urllib.request.urlopen(request,timeout=20) as response: data=json.load(response)
   result={'content':[{'type':'text','text':json.dumps(data,ensure_ascii=False)}], 'isError':bool(data.get('error'))}
  else:
   print(json.dumps({'jsonrpc':'2.0','id':rid,'error':{'code':-32601,'message':'Unknown method'}}),flush=True);continue
  print(json.dumps({'jsonrpc':'2.0','id':rid,'result':result}),flush=True)
 except Exception as e:
  if 'rid' in locals() and rid is not None:print(json.dumps({'jsonrpc':'2.0','id':rid,'error':{'code':-32603,'message':type(e).__name__}}),flush=True)
