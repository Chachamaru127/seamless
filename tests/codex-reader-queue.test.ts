import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,type Socket} from 'node:net';
import {createNativeRuntime} from '../src/native-runtime.ts';
import {projectCodex,projectCodexStructure} from '../src/adapters/codex.ts';
import {createStatus,stages} from '../src/status.ts';
import type {ReadResult} from '../src/adapters/read.ts';
import {publish,reservationFile,type RequestRecord} from '../src/request-store.ts';
import type {Registration} from '../src/protocol.ts';

const tid='01a11bc0-0000-7000-8000-000000000001';
const version='26.928.40906+12694';
// The shape recorded by the 2026-10-20 self-check: `codex queue --thread` put the envelope JSON into the conversation as an
// ordinary user message, and the peer answered inside the same turn.
const envelope={schemaVersion:1,humanApproval:false,id:'selfcheck-20261020',sender:{id:'claude:a',nativeId:'a',generation:'g'},recipient:{id:'codex:b',nativeId:tid,generation:'OWN'},text:'seamless self-check'};
const queueText=JSON.stringify(envelope);
const parsed={id:envelope.id,sender:envelope.sender,recipient:envelope.recipient,text:envelope.text};
const queueItem={id:'u1',type:'userMessage',content:[{type:'input_text',text:queueText}]};
const replyItem={id:'m1',type:'agentMessage',text:'seamless self-check: received.'};
const conversation=(turns:unknown[])=>({
 id:tid,
 cwd:'/tmp',
 turnsPagination:{hasLoadedOldest:true},
 turnHistory:{kind:'canonical',history:{isComplete:true,islands:[{entries:[]}],entitiesByKey:{}}},
 turns,
});
const recorded=conversation([{turnId:'T1',turnStartedAtMs:1_000_000,items:[queueItem,replyItem]}]);
const target:Registration={id:'codex:b',provider:'codex',nativeId:tid,generation:'OWN',host:'local',displayName:'codex',workspace:'/tmp',operations:['read'],grants:[]};
async function fakeDesktop(dir:string,state:unknown){
 const path=join(dir,'ipc.sock'),sockets:Socket[]=[],frames:any[]=[];
 const write=(socket:Socket,frame:unknown)=>{const body=Buffer.from(JSON.stringify(frame)),head=Buffer.alloc(4);head.writeUInt32LE(body.length);socket.write(Buffer.concat([head,body]));};
 const server=createServer(socket=>{
  sockets.push(socket);let buffer=Buffer.alloc(0);
  socket.on('data',part=>{
   buffer=Buffer.concat([buffer,part]);
   while(buffer.length>=4&&buffer.length>=buffer.readUInt32LE(0)+4){
    const frame=JSON.parse(buffer.subarray(4,buffer.readUInt32LE(0)+4).toString());buffer=buffer.subarray(buffer.readUInt32LE(0)+4);frames.push(frame);
    if(frame.method==='initialize')write(socket,{type:'response',requestId:frame.requestId,resultType:'success',result:{clientId:'C'}});
    else if(frame.method==='thread-owner-discovery')write(socket,{type:'response',requestId:frame.requestId,resultType:'success',handledByClientId:'OWN',result:{}});
    else if(frame.method==='thread-stream-following-changed'&&frame.params.following)write(socket,{type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'OWN',targetClientIds:['C'],params:{hostId:'local',conversationId:tid,change:{type:'snapshot',revision:1,conversationState:state}}});
   }
  });
 });
 await new Promise<void>(resolve=>server.listen(path,resolve));
 return {frames,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
async function fixture(t:{after:(fn:()=>Promise<void>)=>void},state:unknown=recorded){
 const home=await mkdtemp(join(tmpdir(),'cldx-codex-reader-queue-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const dir=join(home,'.codex','ipc');await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
 const desktop=await fakeDesktop(dir,state);t.after(()=>desktop.close());
 const {adapter}=createNativeRuntime({home,desktopVersion:async()=>version});
 return {home,adapter,desktop};
}

test('a codex queue envelope read from the conversation user message is a codex-queue peer',async t=>{
 const {adapter}=await fixture(t);
 const read=await adapter.read(target,{limit:10}) as ReadResult;
 assert.equal(read.status,'ok');if(read.status!=='ok')return;
 const item=read.items.find(n=>n.nativeItemId==='u1');
 assert.equal(item?.role,'peer');
 assert.equal(item?.text,'seamless self-check');
 assert.deepEqual(item?.peer,{namespace:'codex-queue',messageId:envelope.id,envelope:parsed});
 assert.equal(read.items.find(n=>n.nativeItemId==='m1')?.role,'assistant');
 assert.deepEqual((await adapter.inbound!(target)).map(e=>e.id),[envelope.id]);
 const structure=await adapter.structure!(target);
 assert.deepEqual(structure.map(n=>n.id),['u1','m1']);
 assert.equal(structure[0].turnId,'T1');assert.equal(structure[0].position,0);
 assert.deepEqual(structure[0].peer,{id:envelope.id,sender:{provider:'claude',nativeId:'a'}});
 assert.ok(!JSON.stringify(structure).includes('seamless self-check'));
});

test('status observes reached and processing for a queue envelope in its own turn',async t=>{
 const {home,adapter}=await fixture(t);
 const now=2_000_000,dir=join(home,'reservations');await mkdir(dir,{recursive:true,mode:0o700});
 const record:RequestRecord={id:envelope.id,sender:{id:'claude:a',provider:'claude',nativeId:'a',generation:'g',cwd:home},recipient:{id:'codex:b',provider:'codex',nativeId:tid,generation:'OWN',cwd:'/tmp'},hash:'hash',at:now-1000,status:'submitted'};
 assert.equal(await publish(join(dir,reservationFile('claude','local','a',record.id)),JSON.stringify(record)),true);
 const status=createStatus({dir,adapter,caller:record.sender,canRead:async()=>true,clock:{now:()=>now,sleep:async()=>{}}});
 const result=await status.track(record.id);
 assert.equal(result.status,'ok');
 const observed=result.stages.filter(n=>n.status==='observed').map(n=>n.stage);
 assert.ok(observed.includes('reached'),observed.join(','));
 assert.ok(observed.includes('processing'),observed.join(','));
 assert.deepEqual(result.stages.find(n=>n.stage==='reached')?.evidence,['u1']);
 assert.deepEqual(result.stages.find(n=>n.stage==='processing')?.evidence,['u1']);
});

test('processing is observable from the turn the queue envelope started, before any answer',()=>{
 const record:RequestRecord={id:envelope.id,sender:{id:'claude:a',provider:'claude',nativeId:'a',generation:'g',cwd:'/tmp'},recipient:{id:'codex:b',provider:'codex',nativeId:tid,generation:'OWN',cwd:'/tmp'},hash:'hash',at:1000,status:'submitted'};
 const started=projectCodexStructure(conversation([{turnId:'T1',turnStartedAtMs:1_000_000,items:[queueItem]}]));
 assert.deepEqual(stages(record,started,[],2_000_000).filter(n=>n.status==='observed').map(n=>n.stage),['accepted','reached','processing']);
 const otherTurn=projectCodexStructure(conversation([{turnId:'T1',turnStartedAtMs:1_000_000,items:[queueItem]},{turnId:'T2',turnStartedAtMs:1_000_001,items:[replyItem]}]));
 assert.deepEqual(stages(record,otherTurn,[],2_000_000).filter(n=>n.status==='observed').map(n=>n.stage),['accepted','reached','processing']);
 const noTurn=projectCodexStructure(conversation([{items:[queueItem]}]));
 assert.deepEqual(stages(record,noTurn,[],2_000_000).filter(n=>n.status==='observed').map(n=>n.stage),['accepted','reached']);
});

test('user text that is not an envelope for this conversation stays user text',()=>{
 const project=(text:string,id?:string)=>projectCodex({...(id?{id}:{}),turns:[{items:[{id:'u',type:'userMessage',content:[{type:'text',text}]}]}]});
 const elsewhere={...envelope,recipient:{...envelope.recipient,nativeId:'another-thread'}};
 assert.equal(project(queueText,tid)[0]?.role,'peer');
 assert.equal(project(JSON.stringify(elsewhere),tid)[0]?.role,'user');
 assert.equal(project(queueText)[0]?.role,'user');
 assert.equal(project('{"schemaVersion":1}')[0]?.role,'user');
 assert.equal(project(JSON.stringify({...envelope,schemaVersion:2}),tid)[0]?.role,'user');
});
