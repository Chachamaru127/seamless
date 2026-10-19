import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Delivery,type NativeAdapter,type Receipt} from '../src/delivery.ts';
import {Registry} from '../src/registry.ts';
import {createStatus,type StructureItem} from '../src/status.ts';
import {DEFAULT_HELD_AFTER_SEC,heldAfterSec,unrestricted,validLimits} from '../src/limits.ts';
import type {Registration} from '../src/protocol.ts';
import type {RequestParty} from '../src/request-store.ts';

const T=1_000_000;
const AT_WAIT=T+DEFAULT_HELD_AFTER_SEC*1000;
type Provider='claude'|'codex';
const registration=(provider:Provider,nativeId:string,peer:string,direction:'inbound'|'outbound'):Registration=>({id:`${provider}:${nativeId}`,provider,nativeId,generation:'g',host:'local',displayName:`${provider}:${nativeId}`,workspace:'/w',operations:['read','send'],
 grants:[{peer,operation:'read',direction},{peer,operation:'send',direction}] as Registration['grants']});
const party=(n:Registration):RequestParty=>({id:n.id,provider:n.provider,nativeId:n.nativeId,generation:n.generation,cwd:n.workspace});
// A fake peer: the reservation is real (so track can find it), the peer's record and its official write are stubs.
async function fixture(t:{after:(fn:()=>Promise<void>)=>void},recipientProvider:Provider,send:NativeAdapter['send'],structure:NativeAdapter['structure']){
 const home=await mkdtemp(join(tmpdir(),'seamless-held-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const senderProvider:Provider=recipientProvider==='claude'?'codex':'claude';
 const sender=registration(senderProvider,'a',`${recipientProvider}:b`,'outbound'),recipient=registration(recipientProvider,'b',`${senderProvider}:a`,'inbound');
 const registry=new Registry([sender,recipient]);
 const adapter:NativeAdapter={read:async()=>({status:'ok'}),structure,send};
 const delivery=new Delivery(registry,sender.id,adapter,{tracking:{keyPath:join(home,'key'),now:()=>T},fixedTarget:recipient,reservationDir:join(home,'reservations')});
 const statusAt=(now:number)=>createStatus({dir:join(home,'reservations'),adapter,caller:party(sender),canRead:async()=>true,clock:{now:()=>now,sleep:async()=>{}}});
 return {delivery,status:statusAt(AT_WAIT),statusAt};
}
test('a readable peer record that never names the request is held with the product reason',async t=>{
 assert.equal(DEFAULT_HELD_AFTER_SEC,20);assert.equal(heldAfterSec({}),20);assert.equal(heldAfterSec({heldAfterSec:5}),5);
 assert.equal(validLimits({...unrestricted,heldAfterSec:5}),true);assert.equal(validLimits({...unrestricted,heldAfterSec:0}),false);
 const empty:NativeAdapter['structure']=async():Promise<StructureItem[]>=>[];
 for(const [provider,reason] of [['claude','claude_hold'],['codex','codex_goal']] as const){
  const f=await fixture(t,provider,async()=>({status:'submitted'}),empty);
  assert.deepEqual(await f.delivery.send({id:'request',text:'body'}),{status:'submitted'});
  // Before the wait is over the request is only accepted, not held.
  assert.equal((await f.statusAt(T+1000).track('request') as {state?:string}).state,undefined);
  const tracked=await f.status.track('request');
  assert.equal(tracked.status,'ok');assert.equal(tracked.state,'held');assert.equal(tracked.reason,reason);
  assert.deepEqual(tracked.stages.filter(s=>s.status==='observed').map(s=>s.stage),['accepted']);
 }
});
test('a peer record that cannot be opened is read_failed, not held',async t=>{
 const f=await fixture(t,'codex',async()=>({status:'submitted'}),async()=>{throw Error('unreadable');});
 assert.deepEqual(await f.delivery.send({id:'request',text:'body'}),{status:'submitted'});
 const tracked=await f.status.track('request');
 assert.equal(tracked.status,'ok');assert.equal(tracked.state,'read_failed');assert.equal(tracked.reason,'record_unreadable');
 assert.deepEqual(tracked.stages.filter(s=>s.status==='observed').map(s=>s.stage),['accepted']);
});
test('a peer whose official path refuses the write is refused with its reason',async t=>{
 const receipt:Receipt={status:'rejected',reason:'peer_refused'};
 const f=await fixture(t,'codex',async()=>receipt,async():Promise<StructureItem[]>=>[]);
 assert.deepEqual(await f.delivery.send({id:'request',text:'body'}),receipt);
 const tracked=await f.status.track('request');
 assert.equal(tracked.status,'ok');assert.equal(tracked.delivery,'rejected');
 assert.equal(tracked.state,'refused');assert.equal(tracked.reason,'peer_refused');
 assert.deepEqual(tracked.stages.filter(s=>s.status==='observed').map(s=>s.stage),[]);
});
