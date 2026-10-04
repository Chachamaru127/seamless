#!/usr/bin/env python3
"""Independently assert native records from the selected synthetic live run."""
import argparse, json, pathlib

def verify(run):
 d=json.loads((run/'results.json').read_text()); initial=d['initial']
 assert len(d['tests']) in (16,17) and all(t['status']=='PASS' for t in d['tests'])
 assert d['default_auth_unchanged'] is True
 assert initial['codex_ephemeral'] is False
 logs=list((run/'claude-config/projects').glob('*/'+initial['claude_id']+'.jsonl'))
 assert len(logs)==1
 native=[json.loads(line) for line in logs[0].read_text().splitlines()]
 assert all(x.get('sessionId')==initial['claude_id'] for x in native if 'sessionId' in x)
 tool_uses=[c for x in native if x.get('type')=='assistant' for c in x.get('message',{}).get('content',[]) if c.get('type')=='tool_use']
 assert any(x['name']=='mcp__claudex_test__read' and x['input']=={'target':'codex'} for x in tool_uses)
 assert len([x for x in tool_uses if x['name']=='mcp__claudex_test__send'])==2
 actual_model_sends=[c for c in d['calls'] if c['name']=='send' and c['args']['target'] in ('codex','claude') and c['owner']!=c['args']['target']]
 assert len(actual_model_sends)==4, 'unexpected auto-reply loop or missing model send'
 deliveries=d['deliveries']; assert len(deliveries)==6
 peers=[]
 for delivered in deliveries:
  mid=delivered['message_id']
  if delivered['target']=='claude':
   rows=[x for x in native if x.get('uuid')==mid]
   queued=[x for x in native if x.get('type')=='attachment' and x.get('attachment',{}).get('source_uuid')==mid]
   assert len(rows)+len(queued)==1
   row=rows[0] if rows else queued[0]['attachment']
   assert row['origin']=={'kind':'peer','from':'claudex-test-codex','msg_id':mid}
   assert row['isMeta'] is True
   if rows:assert row['turnOrigin']=='peer' and row['permissionMode']=='default'
   else:assert row['type']=='queued_command'
   peers.append({'id':mid,'native_origin':row['origin'],'is_meta':True,'storage_kind':'user' if rows else 'queued_command attachment','permission_mode':row.get('permissionMode','not_stored_on_attachment')})
  else:
   rows=[x['params']['item'] for x in d['codex_events'] if x['method']=='item/completed' and x['params'].get('item',{}).get('type')=='functionCallOutput' and mid in x['params']['item'].get('output','')]
   assert len(rows)==1
   assert rows[0]['namespace']=='claudex_test' and rows[0]['name']=='external_message'
   assert json.loads(rows[0]['output'])['message_id']==mid
 for req_index,reply_index in [(0,1),(2,3)]:
  req,reply=deliveries[req_index],deliveries[reply_index]
  assert reply['reply_to']==req['message_id']
  assert reply['target']==req['owner'] and reply['owner']==req['target']
 if len(d['tests'])==17:
  for test_name,delivery_index in [('codex_receives_reply',1),('claude_receives_reply',3)]:
   observed=next(t['details'] for t in d['tests'] if t['name']==test_name)
   assert deliveries[delivery_index]['receipt_nonce'] in str(observed)
   assert deliveries[delivery_index]['message_id'] in str(observed)
 proof={'status':'PASS','source_run':run.name,'checks':[str(len(d['tests']))+' live assertions','normal native Codex persistence','default login unchanged','Claude actual MCP read/send tool use','exactly four model send calls, no reply loop during run','original Claude peer origin and default permission mode','Codex original functionCallOutput classification','both reply_to correlations'], 'claude_peer_provenance':peers,'limits':['Declared sender is bridge identity, not vendor-authenticated cross-product author','Finite fixture execution does not prove arbitrary agent requests or all future versions']}
 (run/'native-evidence.json').write_text(json.dumps(proof,indent=2)+'\n')
 print(json.dumps(proof,indent=2))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('run',type=pathlib.Path);a=p.parse_args();verify(a.run)
