import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutorCheck,createAppVerifier,GROK_BOT_TEAM,GROK_BOT_IDS} from '../src/bot-executor.ts';
import type {Ancestor} from '../src/caller.ts';
import type {Peer} from '../src/peers.ts';
import {mkdtemp,rm,readdir,writeFile,mkdir,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {requestToBot} from './support/signed-fixture.ts';

// specs/202610-more-peers, 立花さんの判断 1 (2026-10-12): bot-send and bot-sessions sign only for the Bot itself, told apart by fixed
// identities (the Grok Bot app's signature on an ancestor's executable, the Bot's UUID), never by a display name. Measured in M3.
const BOT='69590697-ebf9-44d5-8f40-64dbc9455660',OTHER='11111111-2222-4333-8444-555555555555';
const APP='/Applications/Grok Bot.app/Contents/MacOS/Grok Bot',HELPER='/Applications/Grok Bot.app/Contents/Frameworks/Grok Bot Helper.app/Contents/MacOS/Grok Bot Helper';
const peer=(over:Partial<Peer>={}):Peer=>({name:'chachamaru',displayName:'茶々丸',product:'grok-bot',addressEnv:'A',sendKeyEnv:'S',receiveKeyEnv:'R',keyVersion:1,scope:'all',botIds:[BOT],...over});
// A process tree as M3 saw it: node <- bash <- zsh <- Grok Bot Helper <- Grok Bot <- launchd. Each entry: pid, ppid, comm, the executable lsof shows.
type Row={pid:number;ppid:number;comm:string;exe:string|null};
const botTree:Row[]=[{pid:500,ppid:400,comm:'node',exe:'/opt/node'},{pid:400,ppid:300,comm:'bash',exe:'/bin/bash'},{pid:300,ppid:200,comm:'/bin/zsh',exe:'/bin/zsh'},{pid:200,ppid:100,comm:HELPER,exe:HELPER},{pid:100,ppid:1,comm:APP,exe:APP}];
const codexTree:Row[]=[{pid:500,ppid:400,comm:'node',exe:'/opt/node'},{pid:400,ppid:300,comm:'/bin/zsh',exe:'/bin/zsh'},{pid:300,ppid:1,comm:'/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',exe:'/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'}];
function check(tree:Row[],env:NodeJS.ProcessEnv,signedPaths:string[]=[HELPER,APP],more:{reservationDir?:string;now?:()=>number}={}){
 const verified:string[]=[],looked:number[]=[];
 const run=createExecutorCheck({pid:500,env,...more,
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

// The routine the Bot's webhook starts runs under a new id each time (M3-4: sand-subagent-<UUID>, a different UUID per run), so a
// reply from it is the Bot's when it carries the one-time word this Mac sent with the request (src/webhook-send.ts).
test('a reply from the Bot\'s routine: the word sent with the request, from the app, to the conversation that asked',async t=>{
 const base=await mkdtemp(join(tmpdir(),'seamless-word-'));t.after(()=>rm(base,{recursive:true,force:true}));const dir=join(base,'reservations');
 const T=Date.parse('2026-10-12T06:00:00Z'),from={provider:'claude' as const,nativeId:'claude-b',generation:'42@100',cwd:'/w'};
 const WORD='w'.repeat(32),routine={CURSOR_CONVERSATION_ID:'sand-subagent-48e30927-af7f-4990-94ba-8786b6a8a37a'};
 await requestToBot(dir,{id:'ask-1',from,replyWord:WORD,at:T-60_000});
 await requestToBot(dir,{id:'ask-old',from,replyWord:WORD,at:T-86_400_001});
 await requestToBot(dir,{id:'ask-second',from,bot:'second',replyWord:WORD,at:T-60_000});
 await requestToBot(dir,{id:'ask-no-word',from,at:T-60_000});
 const reply=(over:Record<string,string>={})=>({replyTo:'ask-1',replyToken:WORD,recipient:'claude:claude-b:42@100',id:'r-1',...over});
 const c=(tree=botTree)=>check(tree,routine,[HELPER,APP],{reservationDir:dir,now:()=>T}).run;
 assert.equal(await c()(peer(),reply()),null);
 for(const [label,over,reason] of [
  ['another word',{replyToken:'x'.repeat(32)},'reply_token_mismatch'],
  ['a word that is not one',{replyToken:'short'},'reply_token_mismatch'],
  ['a request made to another Bot',{replyTo:'ask-second'},'reply_token_mismatch'],
  ['a request older than a day',{replyTo:'ask-old'},'reply_token_mismatch'],
  ['a request sent without a word',{replyTo:'ask-no-word'},'reply_token_mismatch'],
  ['no such request',{replyTo:'nothing'},'reply_token_mismatch'],
  ['to another conversation than the one that asked',{recipient:'claude:claude-x:42@100'},'reply_token_mismatch'],
  ['to another run of the conversation that asked',{recipient:'claude:claude-b:43@100'},'reply_token_mismatch'],
 ] as const)assert.equal(await c()(peer(),reply(over)),reason,label);
 // The word does not stand in for the app: from a Codex conversation it is refused all the same.
 assert.equal(await c(codexTree)(peer(),reply()),'not_from_bot_app');
 // A word without a request to answer is no proof, and the routine's own id is not the Bot's.
 assert.equal(await c()(peer(),{replyToken:WORD,recipient:'claude:claude-b:42@100'}),'reply_token_mismatch');
 assert.equal(await c()(peer()),'bot_id_missing');
});

test('a word answers its request once: the same reply may be sent again, another reply id is refused, and of two at once only one passes',async t=>{
 const base=await mkdtemp(join(tmpdir(),'seamless-once-'));t.after(()=>rm(base,{recursive:true,force:true}));const dir=join(base,'reservations');
 const T=Date.parse('2026-10-12T06:00:00Z'),from={provider:'claude' as const,nativeId:'claude-b',generation:'42@100',cwd:'/w'};
 const WORD='o'.repeat(32),routine={CURSOR_CONVERSATION_ID:'sand-subagent-48e30927-af7f-4990-94ba-8786b6a8a37a'};
 for(const id of ['ask-a','ask-b','ask-c'])await requestToBot(dir,{id,from,replyWord:WORD,at:T-60_000,status:id==='ask-c'?'pending':'submitted'});
 const reply=(replyTo:string,id:string)=>({replyTo,replyToken:WORD,recipient:'claude:claude-b:42@100',id});
 const c=(tree=botTree)=>check(tree,routine,[HELPER,APP],{reservationDir:dir,now:()=>T}).run;
 // A refused attempt (not from the app) uses nothing up.
 assert.equal(await c(codexTree)(peer(),reply('ask-a','r-0')),'not_from_bot_app');
 assert.equal(await c()(peer(),reply('ask-a','r-1')),null);
 assert.equal(await c()(peer(),reply('ask-a','r-1')),null,'the same reply again (a retry) passes');
 assert.equal(await c()(peer(),reply('ask-a','r-2')),'reply_token_used','another reply with the same word does not');
 const both=await Promise.all([c()(peer(),reply('ask-b','x-1')),c()(peer(),reply('ask-b','x-2'))]);
 assert.deepEqual(both.filter(r=>r===null).length,1,JSON.stringify(both));assert.ok(both.includes('reply_token_used'));
 // A request still waiting for its answer (the reply came first) is answered all the same.
 assert.equal(await c()(peer(),reply('ask-c','p-1')),null);
 // Without a reply id there is nothing to bind the word to.
 assert.equal(await c()(peer(),{replyTo:'ask-a',replyToken:WORD,recipient:'claude:claude-b:42@100'}),'reply_token_mismatch');
});

test('the used marks live next to the reservations and nowhere else; a leftover half file from a killed run and marks older than two days are cleared',async t=>{
 const base=await mkdtemp(join(tmpdir(),'seamless-left-'));t.after(()=>rm(base,{recursive:true,force:true}));const dir=join(base,'reservations');
 const T=Date.parse('2026-10-12T06:00:00Z'),from={provider:'claude' as const,nativeId:'claude-b',generation:'42@100',cwd:'/w'},WORD='l'.repeat(32);
 await requestToBot(dir,{id:'ask-l',from,replyWord:WORD,at:T-60_000});
 const used=join(base,'reply-words-used');await mkdir(used,{mode:0o700});
 const stale=join(used,'a'.repeat(64)+'.json.11111111-2222-4333-8444-555555555555'),old=join(used,'b'.repeat(64)+'.json'),fresh=join(used,'c'.repeat(64)+'.json');
 for(const f of [stale,old,fresh])await writeFile(f,'x',{mode:0o600});
 const ago=(ms:number)=>new Date(Date.now()-ms);
 await utimes(stale,ago(120_000),ago(120_000));await utimes(old,ago(3*86_400_000),ago(3*86_400_000));
 const c=check(botTree,{CURSOR_CONVERSATION_ID:'sand-subagent-x'},[HELPER,APP],{reservationDir:dir,now:()=>T}).run;
 assert.equal(await c(peer(),{replyTo:'ask-l',replyToken:WORD,recipient:'claude:claude-b:42@100',id:'r-l'}),null);
 const left=(await readdir(used)).sort();
 assert.ok(!left.includes(stale.split('/').pop()!),'a half file older than a minute is removed');
 assert.ok(!left.includes(old.split('/').pop()!),'a mark older than two days (its word expired after one) is removed');
 assert.ok(left.includes(fresh.split('/').pop()!),'a recent mark stays');
 assert.equal(left.filter(n=>n.includes('.json.')).length,0,'no temporary file of this run is left');
 assert.deepEqual((await readdir(tmpdir())).filter(n=>n==='reply-words-used'),[],'nothing is made in the shared temporary folder');
});
