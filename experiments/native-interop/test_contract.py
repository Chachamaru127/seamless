"""Synthetic fixtures through the real SDK. These are NOT live conversation tests."""
import json
import os
import pathlib
import re
import tempfile
import unittest
import uuid
from unittest.mock import patch
from claude_agent_sdk import get_session_messages

class ReadingContract(unittest.TestCase):
    def test_official_sdk_reads_original_message_ids_and_pages(self):
        with tempfile.TemporaryDirectory() as root:
            workspace = pathlib.Path(root, 'workspace')
            workspace.mkdir()
            config = pathlib.Path(root, 'config')
            project = config / 'projects' / re.sub(r'[^a-zA-Z0-9]', '-', str(workspace.resolve()))
            project.mkdir(parents=True)
            sid, first, second = (str(uuid.uuid4()) for _ in range(3))
            rows = [dict(type='user', uuid=first, parentUuid=None, sessionId=sid,
                         message=dict(role='user', content='FIXTURE question 17')),
                    dict(type='assistant', uuid=second, parentUuid=first, sessionId=sid,
                         message=dict(role='assistant',content=[dict(type='text',text='FIXTURE answer 17')]))]
            (project / (sid+'.jsonl')).write_text('\n'.join(map(json.dumps, rows))+'\n')
            with patch.dict(os.environ, {'CLAUDE_CONFIG_DIR': str(config)}):
                messages=get_session_messages(sid, directory=str(workspace), limit=1, offset=1)
                self.assertEqual(len(messages), 1)
                self.assertEqual(messages[0].uuid, second)
                self.assertEqual(messages[0].session_id, sid)
                self.assertEqual(messages[0].message['content'][0]['text'], 'FIXTURE answer 17')

    def test_official_sdk_unknown_id_is_empty_not_error(self):
        # Important counterexample: [] does not prove an existing empty conversation.
        with tempfile.TemporaryDirectory() as root:
            with patch.dict(os.environ, {'CLAUDE_CONFIG_DIR': root}):
                self.assertEqual(get_session_messages(str(uuid.uuid4()), directory=root), [])
                self.assertEqual(get_session_messages('not-a-session', directory=root), [])

    def test_codex_tool_output_wire_is_separate_from_user_input(self):
        # Installed binary generated this schema; no inference or delivery claim.
        path=pathlib.Path(__file__).resolve().parents[2]/'.local/probe-schema/v2/TurnStartParams.json'
        schema=json.loads(path.read_text())
        self.assertIn('toolOutput', schema['properties'])
        self.assertIn('input', schema['properties'])
        wire=schema['definitions']['TurnToolOutput']
        self.assertTrue({'namespace','name','output'} <= set(wire['properties']))

if __name__=='__main__': unittest.main(verbosity=2)
