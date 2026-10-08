import test from 'node:test';
import assert from 'node:assert/strict';
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
 // The fixture's pid 502 is alive but started an hour before its row was written.
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
