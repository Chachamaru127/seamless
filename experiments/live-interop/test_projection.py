import json,pathlib,unittest
from read_projection import claude_peer_records,codex_items
ROOT=pathlib.Path(__file__).resolve().parents[2]
RUN=ROOT/'.local/live-interop/12faa30c-467d-4619-8662-30c444c18edb'
class Projection(unittest.TestCase):
 def test_native_peer_records(self):
  d=json.loads((RUN/'results.json').read_text()); sid=d['initial']['claude_id']
  p=next((RUN/'claude-config/projects').glob('*/'+sid+'.jsonl'))
  rows=claude_peer_records(p.read_text().splitlines(),sid)
  self.assertEqual({x['message_id'] for x in rows},{x['message_id'] for x in d['deliveries'] if x['target']=='claude'})
  self.assertEqual(len(rows),3)
  self.assertTrue(all(x['role']=='peer' for x in rows))
 def test_codex_peer_items(self):
  d=json.loads((RUN/'results.json').read_text())
  items=[e['params']['item'] for e in d['codex_events'] if e['method']=='item/completed']
  rows=codex_items({'turns':[{'items':items}]})
  peers=[r for r in rows if r['role']=='peer']
  self.assertEqual({r['message_id'] for r in peers},{x['message_id'] for x in d['deliveries'] if x['target']=='codex'})
 def test_other_session_and_hidden_content_excluded(self):
  self.assertEqual(claude_peer_records([json.dumps({'sessionId':'other','type':'attachment'})],'registered'),[])
  self.assertEqual(codex_items({'turns':[{'items':[{'type':'reasoning','text':'hidden'},{'type':'functionCallOutput','name':'secret_tool','output':'secret'}]}]}),[])
if __name__=='__main__':unittest.main()
