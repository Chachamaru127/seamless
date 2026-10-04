import { readClaudeTranscript } from './claude.ts';
import { readCodexTranscript } from './codex.ts';
import { createReader } from './read.ts';
// Product default: native readers only. Tests build their own reader with createReader.
export const readSession=createReader({claude:readClaudeTranscript,codex:readCodexTranscript});
