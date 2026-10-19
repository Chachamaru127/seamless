#!/usr/bin/env node
// The internal entry for the Codex right panel. The panel is an experiment kept outside the published set (Plans 1 章 5),
// so the published src/mcp.ts does not import it; this script, which is not packed, passes it in.
// The seamless-status plugin (codex-plugin/, also not packed) runs `node scripts/mcp-panel.ts --panel-only`.
import { createAutomatic } from '../src/automatic.ts';
import { runLines } from '../src/io.ts';
import { createMcp } from '../src/mcp.ts';
import { securityKeychain } from '../src/secrets.ts';
import { statusPanel } from '../src/status-panel.ts';
const panelOnly = process.argv.includes('--panel-only');
const automatic = createAutomatic({ keychain: securityKeychain() });
await runLines(createMcp({ automatic, panel: statusPanel, panelOnly }), () => ({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse_error' } }));
