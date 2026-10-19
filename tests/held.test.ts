import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile,chmod} from 'node:fs/promises';
import {createServer,type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Delivery,type NativeAdapter,type Receipt} from '../src/delivery.ts';
import {Registry} from '../src/registry.ts';
import {createStatus,type HoldObservation,type StructureItem} from '../src/status.ts';
import {claudeInboundHolds} from '../src/adapters/claude.ts';
import {codexGoalRunning,observeCodexGoal} from '../src/adapters/codex.ts';
import {DEFAULT_HELD_AFTER_SEC,heldAfterSec,unrestricted,validLimits} from '../src/limits.ts';
import type {Registration} from '../src/protocol.ts';
import type {RequestParty} from '../src/request-store.ts';

const T=1_000_000;
const AT_WAIT=T+DEFAULT_HELD_AFTER_SEC*1000;
type Provider='claude'|'codex';
type Observation={home?:string;claudeHold?:HoldObservation;codexGoal?:HoldObservation};
const registration=(provider:Provider,nativeId:string,peer:string,direction:'inbound'|'outbound'):Registration=>({id:`${provider}:${nativeId}`,provider,nativeId,generation:'g',host:'local',displayName:`${provider}:${nativeId}`,workspace:'/w',operations:['read','send'],
 grants:[{peer,operation:'read',direction},{peer,operation:'send',direction}] as Registration['grants']});
const party=(n:Registration):RequestParty=>({id:n.id,provider:n.provider,nativeId:n.nativeId,generation:n.generation,cwd:n.workspace});
// A fake peer: the reservation is real (so track can find it), the peer's record and its official write are stubs.
async function fixture(t:{after:(fn:()=>Promise<void>)=>void},recipientProvider:Provider,send:NativeAdapter['send'],structure:NativeAdapter['structure'],observation:Observation={}){
 const home=await mkdtemp(join(tmpdir(),'seamless-held-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const senderProvider:Provider=recipientProvider==='claude'?'codex':'claude';
 const sender=registration(senderProvider,'a',`${recipientProvider}:b`,'outbound'),recipient=registration(recipientProvider,'b',`${senderProvider}:a`,'inbound');
 const registry=new Registry([sender,recipient]);
 const adapter:NativeAdapter={read:async()=>({status:'ok'}),structure,send};
 const delivery=new Delivery(registry,sender.id,adapter,{tracking:{keyPath:join(home,'key'),now:()=>T},fixedTarget:recipient,reservationDir:join(home,'reservations')});
 const statusAt=(now:number)=>createStatus({dir:join(home,'reservations'),adapter,caller:party(sender),canRead:async()=>true,clock:{now:()=>now,sleep:async()=>{}},...observation});
 return {delivery,status:statusAt(AT_WAIT),statusAt};
}
test('a readable peer record that never names the request is held with an observed product reason',async t=>{
 assert.equal(DEFAULT_HELD_AFTER_SEC,20);assert.equal(heldAfterSec({}),20);assert.equal(heldAfterSec({heldAfterSec:5}),5);
 assert.equal(validLimits({...unrestricted,heldAfterSec:5}),true);assert.equal(validLimits({...unrestricted,heldAfterSec:0}),false);
 const empty:NativeAdapter['structure']=async():Promise<StructureItem[]>=>[];
 // Send once, show accepted before the wait, then return the reason the held state carries.
 const reason=async(provider:Provider,observation:Observation={})=>{
  const f=await fixture(t,provider,async()=>({status:'submitted'}),empty,observation);
  assert.deepEqual(await f.delivery.send({id:'request',text:'body'}),{status:'submitted'});
  // Before the wait is over the request is only accepted, not held.
  assert.equal((await f.statusAt(T+1000).track('request') as {state?:string}).state,undefined);
  const tracked=await f.status.track('request');
  assert.equal(tracked.status,'ok');assert.equal(tracked.state,'held');
  assert.deepEqual(tracked.stages.filter(s=>s.status==='observed').map(s=>s.stage),['accepted']);
  return tracked.reason;
 };
 // Claude: only a fake user setting that says hold (or a bypass mode) names claude_hold. A readable setting without
 // hold, a broken setting and a missing setting are not observations of hold.
 const root=await mkdtemp(join(tmpdir(),'seamless-held-settings-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const settings=async(content:string)=>{const home=await mkdtemp(join(root,'home-'));await mkdir(join(home,'.claude'),{recursive:true});await writeFile(join(home,'.claude','settings.json'),content);return home;};
 const holds=await settings(JSON.stringify({permissions:{defaultMode:'default'},crossSessionInbound:'hold'}));
 assert.equal(await reason('claude',{home:holds}),'claude_hold');
 const plain=await settings(JSON.stringify({permissions:{defaultMode:'default'}}));
 assert.equal(await reason('claude',{home:plain}),'unknown_reason');
 const bypass=await settings(JSON.stringify({permissions:{defaultMode:'bypassPermissions'}}));
 assert.equal(await reason('claude',{home:bypass}),'claude_hold');
 const broken=await settings('{not json');
 assert.equal(await reason('claude',{home:broken}),'unknown_reason');
 assert.equal(await claudeInboundHolds({home:join(root,'missing')}),null);
 // Codex Desktop: only a fake IPC observation that reports a goal names codex_goal. False, null and a failed read are not.
 assert.equal(await reason('codex',{codexGoal:async()=>true}),'codex_goal');
 assert.equal(await reason('codex',{codexGoal:async()=>false}),'unknown_reason');
 assert.equal(await reason('codex',{codexGoal:async()=>null}),'unknown_reason');
 assert.equal(await reason('codex',{codexGoal:async()=>{throw Error('ipc');}}),'unknown_reason');
 // An ordinary turn (activeTurnId and inProgress, no goal record) is not an observed goal, so the reason stays unknown.
 assert.equal(await reason('codex',{codexGoal:async()=>codexGoalRunning({turns:[{turnId:'T1',status:'inProgress'}],activeTurnId:'T1'})}),'unknown_reason');
 assert.equal(await reason('codex',{codexGoal:async()=>codexGoalRunning({turns:[],goal:{objective:'見本に合わせる',status:'inProgress'}})}),'codex_goal');
 assert.equal(await reason('codex',{codexGoal:async()=>codexGoalRunning({goal:{objective:'見本に合わせる',status:'completed'}})}),'unknown_reason');
});
test('only a goal-specific record in the IPC state counts as a goal',()=>{
 // No goal field in this version: an ordinary running turn proves nothing, so the answer is no observation.
 assert.equal(codexGoalRunning({turns:[]}),null);
 assert.equal(codexGoalRunning({turns:[{turnId:'T1'}]}),null);
 assert.equal(codexGoalRunning({turns:[],activeTurnId:'T2'}),null);
 assert.equal(codexGoalRunning({turns:[{turnId:'T1',status:'inProgress'}]}),null);
 assert.equal(codexGoalRunning({turns:[{turnId:'T1',status:'inProgress'}],activeTurnId:'T1'}),null);
 // A goal record that says it is executing is the only thing that names a goal.
 assert.equal(codexGoalRunning({turns:[],goal:{objective:'見本に合わせる',status:'inProgress'}}),true);
 assert.equal(codexGoalRunning({turns:[],goalState:'running'}),true);
 assert.equal(codexGoalRunning({turns:[],goals:[{objective:'見本に合わせる',status:'active'}]}),true);
 assert.equal(codexGoalRunning({turns:[{turnId:'T1',goal:{objective:'見本に合わせる',status:'running'}}]}),true);
 // A goal record that has finished, or only its text, is not an executing goal.
 assert.equal(codexGoalRunning({turns:[],goal:{objective:'見本に合わせる',status:'completed'}}),false);
 assert.equal(codexGoalRunning({turns:[],goal:'見本に合わせる'}),null);
});
test('the IPC observation names a goal only when the snapshot carries a goal record',async t=>{
 const id='01a0f59d-0000-7000-8000-000000000024',owner='OWN',client='C';
 const dir=await mkdtemp(join(tmpdir(),'seamless-goal-ipc-'));await chmod(dir,0o700);
 t.after(()=>rm(dir,{recursive:true,force:true}));
 let snapshot:Record<string,unknown>={turns:[{turnId:'T1',status:'inProgress'}],activeTurnId:'T1'};
 const write=(s:Socket,frame:unknown)=>{const body=Buffer.from(JSON.stringify(frame)),head=Buffer.alloc(4);head.writeUInt32LE(body.length);s.write(Buffer.concat([head,body]));};
 const server=createServer(s=>{let buf=Buffer.alloc(0);s.on('data',d=>{buf=Buffer.concat([buf,d]);
  while(buf.length>=4&&buf.length>=buf.readUInt32LE(0)+4){const size=buf.readUInt32LE(0),frame=JSON.parse(buf.subarray(4,size+4).toString());buf=buf.subarray(size+4);
   if(frame.method==='initialize')write(s,{type:'response',requestId:frame.requestId,resultType:'success',result:{clientId:client}});
   else if(frame.method==='thread-owner-discovery')write(s,{type:'response',requestId:frame.requestId,resultType:'success',handledByClientId:owner,result:{}});
   else if(frame.method==='thread-stream-following-changed'&&frame.params.following)
    write(s,{type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:owner,targetClientIds:[client],params:{hostId:'local',conversationId:id,change:{type:'snapshot',revision:1,conversationState:{id,...snapshot}}}});
  }});});
 const path=join(dir,'ipc.sock');await new Promise<void>(resolve=>server.listen(path,resolve));
 t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const options={socketPath:path,timeoutMs:2000,version:async()=>'26.928.40906+12694'};
 // A normal turn (activeTurnId and inProgress) carries no goal field: nothing about a goal was observed.
 assert.equal(await observeCodexGoal(id,options),null);
 snapshot={turns:[],goal:{objective:'見本に合わせる',status:'inProgress'}};
 assert.equal(await observeCodexGoal(id,options),true);
 snapshot={turns:[],goal:{objective:'見本に合わせる',status:'completed'}};
 assert.equal(await observeCodexGoal(id,options),false);
 // A failed observation (no IPC to read) is null, never a guessed reason.
 assert.equal(await observeCodexGoal(id,{...options,socketPath:join(dir,'missing.sock')}),null);
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
