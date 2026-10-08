import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutomatic} from '../src/automatic.ts';
import type {Caller} from '../src/caller.ts';
import {grokHome,ids,OPENED} from './support/grok-fixture.ts';
async function list(t:Parameters<typeof grokHome>[0],input:Record<string,unknown>={}){
 const f=await grokHome(t);
 const caller:Caller={provider:'claude',nativeId:'claude-a',generation:'41@100',cwd:f.work,socket:'unused',source:'claude-ancestor'};
 const automatic=createAutomatic({home:f.home,limitsPath:f.home+'/limits.json',caller:async()=>({status:'ok',caller}),scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd}),rows:async()=>[],version:async()=>null,grok:f.grok},adapter:{read:async()=>null,send:async()=>({status:'rejected'})}});
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
