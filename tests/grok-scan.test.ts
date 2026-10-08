import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createAutomatic} from '../src/automatic.ts';
import {COMPATIBILITY} from '../src/compat.ts';
import type {Caller} from '../src/caller.ts';
import {grokHome,ids,OPENED} from './support/grok-fixture.ts';
async function list(t:Parameters<typeof grokHome>[0],input:Record<string,unknown>={},setup:(f:Awaited<ReturnType<typeof grokHome>>)=>Promise<void>=async()=>{},grokVersion='1.0.46'){
 const f=await grokHome(t);await setup(f);
 const caller:Caller={provider:'claude',nativeId:'claude-a',generation:'41@100',cwd:f.work,socket:'unused',source:'claude-ancestor'};
 const automatic=createAutomatic({home:f.home,limitsPath:f.home+'/limits.json',caller:async()=>({status:'ok',caller}),scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd}),rows:async()=>[],version:async()=>null,compatibility:[...COMPATIBILITY,{product:'grok',version:'0.9.0',connection:'cli',status:'fix_required',checkedAt:null,checks:[]}],grok:{...f.grok,grokVersion:async()=>grokVersion}},adapter:{read:async()=>null,send:async()=>({status:'rejected'})}});
 return {f,result:await automatic('sessions',input)};
}
const grokIds=(r:any)=>r.candidates.filter((c:any)=>c.provider==='grok').map((c:any)=>c.nativeId).sort();
test('a running Grok TUI conversation is listed as product grok, host local, online, with a ticket',async t=>{
 const {result}=await list(t);
 assert.equal(result.status,'ok');
 const live=result.candidates.find((c:any)=>c.nativeId===ids.live);
 assert.ok(live);assert.equal(live.id,'grok:'+ids.live);assert.equal(live.provider,'grok');assert.equal(live.host,'local');assert.equal(live.status,'online');
 assert.equal(live.generation,'501@'+OPENED);assert.equal(typeof live.ticket,'string');
});
test('a dead ledger row and a TUI conversation missing from the ledger are hidden by default and counted in offlineHidden',async t=>{
 const {result}=await list(t);
 assert.deepEqual(grokIds(result),[ids.live]);
 assert.equal(result.offlineHidden,2);
});
test('with includeOffline they are listed as offline without a ticket',async t=>{
 const {result}=await list(t,{includeOffline:true});
 assert.deepEqual(grokIds(result),[ids.live,ids.stale,ids.stopped].sort());
 for(const id of [ids.stale,ids.stopped]){const c=result.candidates.find((c:any)=>c.nativeId===id);assert.equal(c.status,'offline');assert.equal(c.ticket,null);}
 assert.equal(result.candidates.find((c:any)=>c.nativeId===ids.stale).generation,'502@'+OPENED);
});
test('headless and out-of-scope Grok conversations are never listed, with or without includeOffline',async t=>{
 for(const input of [{},{includeOffline:true}]){
  const {result}=await list(t,input);
  for(const id of [ids.headless,ids.outside,ids.stoppedOutside])assert.ok(!grokIds(result).includes(id),id);
 }
});
test('scope any widens to the other workspace but still never lists headless conversations',async t=>{
 const {result}=await list(t,{scope:'any',includeOffline:true});
 assert.ok(grokIds(result).includes(ids.outside));assert.ok(grokIds(result).includes(ids.stoppedOutside));assert.ok(!grokIds(result).includes(ids.headless));
});
const more={sub:'01a11a6c-23b4-7af0-b5c4-c9893437b307',resume:'01a11a6c-23b4-7af0-b5c4-c9893437b308',liveSub:'01a11a6c-23b4-7af0-b5c4-c9893437b309',twin:'01a11a6c-23b4-7af0-b5c4-c9893437b30a'};
test('a ledger row whose pid is alive but started at another time (a reused pid) is not running',async t=>{
 // The fixture's pid 502 runs a process that started an hour after its row was written: the pid was reused.
 const {f,result}=await list(t,{includeOffline:true});
 assert.equal(await f.processStart(502)!==null,true);
 const stale=result.candidates.find((c:any)=>c.nativeId===ids.stale);
 assert.equal(stale.status,'offline');assert.equal(stale.ticket,null);
});
test('subagent conversations are never listed, whether stopped or present in the ledger',async t=>{
 for(const input of [{},{includeOffline:true}]){
  const {result}=await list(t,input,async f=>{
   await f.summary(f.work,more.sub,'subagent');await f.summary(f.work,more.resume,'subagent_resume');await f.summary(f.work,more.liveSub,'subagent');
   await f.ledger([...f.rows,{session_id:more.liveSub,pid:501,cwd:f.work,opened_at:OPENED}]);
  });
  for(const id of [more.sub,more.resume,more.liveSub])assert.ok(!grokIds(result).includes(id),id);
 }
});
test('one conversation open in two live processes is no destination: unknown and without a ticket',async t=>{
 const {result}=await list(t,{includeOffline:true},async f=>{
  await f.summary(f.work,more.twin);
  await f.ledger([...f.rows,{session_id:more.twin,pid:501,cwd:f.work,opened_at:OPENED},{session_id:more.twin,pid:503,cwd:f.work,opened_at:OPENED}]);
 });
 const twin=result.candidates.find((c:any)=>c.nativeId===more.twin);
 assert.equal(twin.status,'unknown');assert.equal(twin.ticket,null);assert.equal(twin.generation,'');
});
test('a Grok version marked fix_required lists running conversations as unknown and never as destinations',async t=>{
 const {result}=await list(t,{includeOffline:true},async()=>{},'0.9.0');
 const live=result.candidates.find((c:any)=>c.nativeId===ids.live);
 assert.ok(live);assert.equal(live.status,'unknown');assert.equal(live.reason,'unsupported_version');assert.equal(live.ticket,null);
});
test('a ledger row is live while its process started no later than 1 second after the row, however long before',async()=>{
 const {grokRowAlive}=await import('../src/adapters/grok.ts'),opened=Date.parse(OPENED),row={session_id:ids.live,pid:9,cwd:'/w',opened_at:OPENED};
 const at=(ms:number)=>grokRowAlive(row,{processStart:async()=>opened+ms});
 // A TUI may open a conversation long after it started (/new, /resume): an hour before is still live. Started after the row is a reused pid.
 assert.deepEqual(await Promise.all([at(-3_600_000),at(-120_001),at(1000),at(1001),at(0)]),[true,true,true,false,true]);
 assert.equal(await grokRowAlive(row,{processStart:async()=>null}),false);
});
test('a live ledger row of a headless conversation is never listed',async t=>{
 const headlessLive='01a11a6c-23b4-7af0-b5c4-c9893437b30b';
 for(const input of [{},{includeOffline:true}]){
  const {result}=await list(t,input,async f=>{await f.summary(f.work,headlessLive,'headless');await f.ledger([...f.rows,{session_id:headlessLive,pid:501,cwd:f.work,opened_at:OPENED}]);});
  assert.ok(!grokIds(result).includes(headlessLive));
 }
});
test('by default a conversation open twice and one of a fix_required version are hidden and counted in offlineHidden',async t=>{
 const twice=await list(t,{},async f=>{await f.summary(f.work,more.twin);await f.ledger([...f.rows,{session_id:more.twin,pid:501,cwd:f.work,opened_at:OPENED},{session_id:more.twin,pid:503,cwd:f.work,opened_at:OPENED}]);});
 assert.ok(!grokIds(twice.result).includes(more.twin));assert.equal(twice.result.offlineHidden,3);
 const old=await list(t,{},async()=>{},'0.9.0');
 assert.deepEqual(grokIds(old.result),[]);assert.equal(old.result.offlineHidden,3);
});
test('with scope any, stopped conversations are cut to the 50 most recently active',async t=>{
 const {result}=await list(t,{scope:'any',includeOffline:true},async f=>{
  for(let i=0;i<55;i++){const id=`01a11a6c-23b4-7af0-b5c4-${String(i).padStart(12,'0')}`;const dir=await f.summary(f.other,id);
   await writeFile(join(dir,'summary.json'),JSON.stringify({info:{id,cwd:f.other},last_active_at:new Date(Date.parse(OPENED)+i*1000).toISOString()}));}
 });
 // The dead ledger row (ids.stale) is listed from the ledger; the cut applies to conversations found only in the folders.
 const stopped=result.candidates.filter((c:any)=>c.provider==='grok'&&c.status==='offline'&&c.nativeId!==ids.stale);
 assert.equal(stopped.length,50);
 assert.ok(!stopped.some((c:any)=>c.nativeId==='01a11a6c-23b4-7af0-b5c4-000000000000'));
});
test('a stopped Grok conversation without a ledger row is not remembered, so starting it again lists it online at once',async t=>{
 const {f,result}=await list(t,{includeOffline:true});
 assert.ok(grokIds(result).includes(ids.stopped));
 const {readFile}=await import('node:fs/promises');
 const seen=JSON.parse(await readFile(join(f.home,'.seamless','seen.json'),'utf8'));
 assert.ok(!seen.some((n:any)=>n.nativeId===ids.stopped));
});
