"""Bounded visible transcript projection; no thinking/signatures/tool credentials."""
import json

def codex_items(thread):
 rows=[]
 for turn in thread.get('turns',[]):
  for item in turn.get('items',[]):
   kind=item.get('type')
   if kind=='agentMessage':rows.append({'id':item['id'],'role':'assistant','text':item.get('text','')})
   elif kind=='userMessage':
    rows.append({'id':item['id'],'role':'user','text':'\n'.join(c.get('text','') for c in item.get('content',[]) if c.get('type')=='text')})
   elif kind=='functionCallOutput' and item.get('namespace')=='claudex_test' and item.get('name')=='external_message':
    envelope=json.loads(item['output']);rows.append({'id':item['id'],'role':'peer','message_id':envelope['message_id'],'text':envelope['text'],'declared_sender':envelope['from']})
 return rows

def claude_peer_records(lines,expected_session):
 """Supplement SDK user/assistant history with allowlisted native peer records.
 Caller supplies only an already registered, identity-verified transcript file.
 """
 rows=[]
 for line in lines:
  r=json.loads(line)
  if r.get('sessionId')!=expected_session:continue
  if r.get('type')=='user' and r.get('origin',{}).get('kind')=='peer':
   content=r.get('message',{}).get('content','')
   # Native visible wrapper is retained; no nested tool results or thinking.
   text=content if isinstance(content,str) else '\n'.join(x.get('text','') for x in content if x.get('type')=='text')
   rows.append({'id':r['uuid'],'role':'peer','message_id':r['origin']['msg_id'],'text':text,'native_origin':'peer','declared_sender':r['origin']['from']})
  elif r.get('type')=='attachment' and r.get('attachment',{}).get('type')=='queued_command':
   a=r['attachment']
   if a.get('origin',{}).get('kind')!='peer':continue
   rows.append({'id':r['uuid'],'role':'peer','message_id':a['source_uuid'],'text':a['prompt'],'native_origin':'peer','declared_sender':a['origin']['from']})
 return rows
