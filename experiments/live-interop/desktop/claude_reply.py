#!/usr/bin/env python3
"""Fixed, one-shot reply sent by the dedicated Claude Desktop test conversation."""
import json
import deliver
original=deliver.delivery_frame

def frame(client_id,owner_id):
 result=original(client_id,owner_id)
 payload=result['params']['turnStart']['request']['toolOutput']
 payload['output']=json.dumps({'schemaVersion':1,'messageId':'DESKTOP_FROM_CLAUDE_91','sender':'claude-desktop-fixture','nativeSessionId':'44043390-7770-4427-8d7b-edd91f804f8a','humanApproval':False,'message':'CDESK84 DESKTOP_FROM_CLAUDE_91. This is the bounded test reply. Continue the research; no further reply, action or approval requested.'})
 return result

deliver.delivery_frame=frame
result=deliver.deliver_once()
result['messageId']='DESKTOP_FROM_CLAUDE_91'
print(json.dumps(result,indent=2))
raise SystemExit(0 if result.get('resultType')=='success' else 1)
