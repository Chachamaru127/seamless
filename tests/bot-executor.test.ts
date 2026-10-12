import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutorCheck,createAppVerifier,GROK_BOT_TEAM,GROK_BOT_IDS} from '../src/bot-executor.ts';
import type {Ancestor} from '../src/caller.ts';
import type {Peer} from '../src/peers.ts';

// specs/202610-more-peers, 立花さんの判断 1 (2026-10-12): bot-send and bot-sessions sign only for the Bot itself, told apart by fixed
// identities (the Grok Bot app's signature on an ancestor's executable, the Bot's UUID), never by a display name. Measured in M3.
const BOT='69590697-ebf9-44d5-8f40-64dbc9455660',OTHER='11111111-2222-4333-8444-555555555555';
const APP='/Applications/Grok Bot.app/Contents/MacOS/Grok Bot',HELPER='/Applications/Grok Bot.app/Contents/Frameworks/Grok Bot Helper.app/Contents/MacOS/Grok Bot Helper';
const peer=(over:Partial<Peer>={}):Peer=>({name:'chachamaru',displayName:'茶々丸',product:'grok-bot',addressEnv:'A',sendKeyEnv:'S',receiveKeyEnv:'R',keyVersion:1,scope:'all',botIds:[BOT],...over});
// A process tree as M3 saw it: node <- bash <- zsh <- Grok Bot Helper <- Grok Bot <- launchd. Each entry: pid, ppid, comm, the executable lsof shows.
type Row={pid:number;ppid:number;comm:string;exe:string|null};
const botTree:Row[]=[{pid:500,ppid:400,comm:'node',exe:'/opt/node'},{pid:400,ppid:300,comm:'bash',exe:'/bin/bash'},{pid:300,ppid:200,comm:'/bin/zsh',exe:'/bin/zsh'},{pid:200,ppid:100,comm:HELPER,exe:HELPER},{pid:100,ppid:1,comm:APP,exe:APP}];
const codexTree:Row[]=[{pid:500,ppid:400,comm:'node',exe:'/opt/node'},{pid:400,ppid:300,comm:'/bin/zsh',exe:'/bin/zsh'},{pid:300,ppid:1,comm:'/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',exe:'/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'}];
function check(tree:Row[],env:NodeJS.ProcessEnv,signedPaths:string[]=[HELPER,APP]){
 const verified:string[]=[],looked:number[]=[];
 const run=createExecutorCheck({pid:500,env,
  process:async pid=>{const r=tree.find(x=>x.pid===pid);return r?{pid:r.pid,ppid:r.ppid,executable:null,command:r.comm} as Ancestor:null;},
  executable:async pid=>{looked.push(pid);return tree.find(x=>x.pid===pid)?.exe??null;},
  verify:async path=>{verified.push(path);return signedPaths.includes(path);}});
 return {run,verified,looked};
}

test('the Bot itself: an ancestor is the Grok Bot app by its signature, and the conversation UUID is one the roster lists',async()=>{
 const c=check(botTree,{CURSOR_CONVERSATION_ID:BOT});
 assert.equal(await c.run(peer()),null);
 assert.ok(c.verified.includes(HELPER),'the helper the shell came from is what was verified');
 // An upper-case spelling of the same UUID is the same Bot.
 assert.equal(await check(botTree,{CURSOR_CONVERSATION_ID:BOT.toUpperCase()}).run(peer()),null);
});
test('a Claude, Codex or Grok CLI conversation is refused even with the right UUID in its environment',async()=>{
 assert.equal(await check(codexTree,{CURSOR_CONVERSATION_ID:BOT}).run(peer()),'not_from_bot_app');
});
test('the name is never used: a process that calls itself Grok Bot but whose executable lacks the signature is refused',async()=>{
 const fake:Row[]=[{pid:500,ppid:400,comm:'node',exe:'/opt/node'},{pid:400,ppid:1,comm:APP,exe:'/tmp/Grok Bot.app/Contents/MacOS/Grok Bot'}];
 const c=check(fake,{CURSOR_CONVERSATION_ID:BOT});
 assert.equal(await c.run(peer()),'not_from_bot_app');
 assert.ok(c.verified.every(p=>p!==APP),'what is verified is the executable lsof shows, not the name the process gives');
});
test('another Bot of the same app is refused: its UUID is not the registration\'s',async()=>{
 assert.equal(await check(botTree,{CURSOR_CONVERSATION_ID:OTHER}).run(peer()),'bot_id_mismatch');
});
test('no UUID, a malformed one, or a registration without botIds is refused before any process is looked at',async()=>{
 for(const [env,reason] of [[{},'bot_id_missing'],[{CURSOR_CONVERSATION_ID:''},'bot_id_missing'],[{CURSOR_CONVERSATION_ID:'chachamaru'},'bot_id_missing'],[{CURSOR_CONVERSATION_ID:BOT+'x'},'bot_id_missing']] as const){
  const c=check(botTree,env);assert.equal(await c.run(peer()),reason,JSON.stringify(env));assert.deepEqual(c.looked,[]);
 }
 const unset=check(botTree,{CURSOR_CONVERSATION_ID:BOT});
 const {botIds:_,...without}=peer();
 assert.equal(await unset.run(without as Peer),'bot_id_unset');assert.deepEqual(unset.looked,[]);
});
test('the walk is bounded and stops at a loop; an ancestor whose executable cannot be read is passed over, never trusted',async()=>{
 const loop:Row[]=[{pid:500,ppid:400,comm:'node',exe:'/opt/node'},{pid:400,ppid:300,comm:'a',exe:null},{pid:300,ppid:400,comm:'b',exe:'/bin/b'}];
 assert.equal(await check(loop,{CURSOR_CONVERSATION_ID:BOT}).run(peer()),'not_from_bot_app');
 const long:Row[]=[{pid:500,ppid:499,comm:'node',exe:'/opt/node'},...Array.from({length:20},(_,i)=>({pid:499-i,ppid:498-i,comm:'sh',exe:'/bin/sh'})),{pid:479,ppid:1,comm:APP,exe:APP}];
 const c=check(long,{CURSOR_CONVERSATION_ID:BOT});
 assert.equal(await c.run(peer()),'not_from_bot_app','an app more than eight steps up is not looked for');assert.ok(c.looked.length<=8);
});
test('the signature requirement names the team and the two identifiers of the app, and nothing else is passed to codesign',async()=>{
 const calls:Array<{file:string;args:string[]}>=[];
 const ok=createAppVerifier(async(file,args)=>{calls.push({file,args});return {stdout:'',stderr:''};});
 assert.equal(await ok(HELPER),true);
 assert.equal(calls[0].file,'/usr/bin/codesign');
 assert.deepEqual(calls[0].args.slice(0,2),['--verify','--strict']);assert.equal(calls[0].args.at(-1),HELPER);assert.equal(calls[0].args.length,4);
 const requirement=calls[0].args[2];
 assert.match(requirement,new RegExp(`certificate leaf\\[subject\\.OU\\] = "${GROK_BOT_TEAM}"`));
 for(const id of GROK_BOT_IDS)assert.ok(requirement.includes(`identifier "${id}"`),id);
 assert.deepEqual(GROK_BOT_IDS,['com.anysphere.sand','com.anysphere.sand.electron-helper']);assert.equal(GROK_BOT_TEAM,'DCNK4UB866');
 const no=createAppVerifier(async()=>{throw new Error('code object is not signed at all');});
 assert.equal(await no(HELPER),false);
});
