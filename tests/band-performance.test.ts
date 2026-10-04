import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {findClaudeIdentity,createCodexOwnerLookup} from '../src/native-runtime.ts';
import {createAutomatic} from '../src/automatic.ts';
import {verifyInbound} from '../src/inbound.ts';
import type {Registration} from '../src/protocol.ts';
import {EventEmitter} from 'node:events';
import net from 'node:net';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';

for(const duplicate of [false,true])test(`Claude filters cheap records before full identity checks, duplicate=${duplicate}`,async()=>{
 const home=await realpath(await mkdtemp(join(tmpdir(),'band-performance-'))),dir=join(home,'.claude','sessions');await mkdir(dir,{recursive:true});
 for(let pid=100;pid<134;pid++)await writeFile(join(dir,`${pid}.json`),JSON.stringify({pid,sessionId:pid===133||duplicate&&pid===132?'wanted':`other-${pid}`,version:'2.1.284',peerProtocol:1,procStart:'start',startedAt:1,cwd:home,messagingSocketPath:`${home}/${pid}.sock`}),{mode:0o600});
 await writeFile(join(dir,'99.json'),'{broken');
 const calls:Array<[string,string[]]>=[],sockets:string[]=[];
 const found=await findClaudeIdentity('wanted',home,{command:async(file,args)=>{
  calls.push([file,args]);const pid=args[args.indexOf('-p')+1];
  if(file==='ps')return `${process.getuid?.()} start`;
  if(args.includes('cwd'))return 'n'+home;
  return 'n'+home+'/'+(pid==='132'?'imposter':pid)+'.sock';
 },socket:async path=>{sockets.push(path);return true;}});
 assert.equal(found?.pid,133);
 assert.deepEqual(calls.filter(([file])=>file==='ps').map(([,args])=>args[1]),duplicate?['132','133']:['133']);
 assert.equal(calls.filter(([file])=>file==='lsof').length,duplicate?4:2);
 assert.equal(sockets.length,duplicate?2:1);
});

test('band overlaps peer inspection and status/inbound work, reuses structure only within a call',async()=>{
 const home=await realpath(await mkdtemp(join(tmpdir(),'band-parallel-'))),dir=join(home,'.seamless','reservations');await mkdir(dir,{recursive:true});
 const caller={provider:'claude' as const,nativeId:'self',generation:'g',cwd:home,socket:'',source:'claude-ancestor' as const,version:'2.1.284'};
 const peers=['one','two'].map(nativeId=>({...caller,nativeId}));
 for(const [i,peer] of peers.entries())for(let j=0;j<2;j++)await writeFile(join(dir,`${i}${j}`.padEnd(64,'0')+'.json'),JSON.stringify({id:`out-${i}-${j}`,at:1000,hash:'h',status:'submitted',sender:{...caller,id:'claude:self'},recipient:{...peer,id:`claude:${peer.nativeId}`}}),{mode:0o600});
 let inspections:string[]=[],structures:string[]=[],proofs:string[]=[];
 let releaseInspections!:()=>void,releaseProofs!:()=>void;
 let inspectionGate:Promise<void>,proofGate:Promise<void>;
 const reset=()=>{inspections=[];structures=[];proofs=[];inspectionGate=new Promise(r=>releaseInspections=r);proofGate=new Promise(r=>releaseProofs=r);};reset();
 const auto=createAutomatic({home,caller:async()=>({status:'ok',caller}),clock:{now:()=>1000,sleep:async()=>{}},scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd})},
 inspect:async n=>{inspections.push(n.nativeId);if(inspections.length===2)releaseInspections();await inspectionGate;return peers.find(p=>p.nativeId===n.nativeId)!;},
 adapter:{read:async()=>null,send:async()=>({status:'rejected'}),
 received:async()=>peers.flatMap(p=>['a','b'].map(id=>({id:p.nativeId+id,sender:{id:`claude:${p.nativeId}`,nativeId:p.nativeId,generation:'g'},recipient:{id:'claude:self',nativeId:'self',generation:'g'},at:new Date(1000).toISOString()}))),
 structure:async n=>{structures.push(n.nativeId);releaseProofs();return [];},
 sentIds:async(n,ids)=>{proofs.push(n.nativeId);await proofGate;return ids;}}});
 for(let i=0;i<2;i++){
  let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;releaseInspections();releaseProofs();},2000);
  const result=await auto('band',{});clearTimeout(timeout);assert.equal(timedOut,false,'independent work must start before another operation finishes');
  assert.deepEqual(inspections,['one','two']);assert.deepEqual(proofs,['one','two']);
  assert.deepEqual(structures.sort(),['one','self','two']);assert.equal(result.inbound.every((r:{sender:string})=>r.sender==='verified'),true);
  reset();
 }
});

test('parallel inbound groups exact sender generations and preserves ordering and denial',async()=>{
 const base:Registration={provider:'claude',id:'claude:a',nativeId:'a',generation:'g',workspace:'/',host:'local',displayName:'a',operations:['read'],grants:[]};
 const caller={...base,id:'claude:self',nativeId:'self'},b={...base,id:'claude:b',nativeId:'b'};
 const received=[['a','g','one'],['b','g','two'],['a','g','fake'],['a','old','old']].map(([id,generation,message])=>({id:message,sender:{id:'claude:'+id,nativeId:id,generation},recipient:caller,at:new Date(1000).toISOString()}));
 let reads=0;
 const result=await verifyInbound({parallel:true,caller,received,targets:[base,b],now:1000,canRead:async t=>t.nativeId!=='b',sentIds:async(_t,ids)=>{reads++;assert.deepEqual(ids,['one','fake']);return ['one'];}});
 assert.equal(reads,1);assert.deepEqual(result.map(r=>r.sender),['verified','declared','declared','declared']);assert.deepEqual(result.map(r=>r.id),['one','two','fake','old']);
});

test('band owner lookup shares initialization, multiplexes responses, isolates conversations and calls',async t=>{
 let initialized=0,closed=0;const discoveries:string[]=[];
 class Transport extends EventEmitter{
  end(){closed++;return this;}destroy(){return this;}
  write(bytes:Buffer){const request=JSON.parse(bytes.subarray(4).toString());
   const id=request.params.conversationId;if(request.method==='initialize')initialized++;else discoveries.push(id);
   const response={type:'response',requestId:request.requestId,resultType:id==='missing'?'error':'success',handledByClientId:'owner-'+id,result:{clientId:'client'}};
   const body=Buffer.from(JSON.stringify(response)),prefix=Buffer.alloc(4);prefix.writeUInt32LE(body.length);
   setTimeout(()=>this.emit('data',Buffer.concat([prefix,body])),id==='a'?20:0);return true;
  }
 }
 const connection=t.mock.method(net,'createConnection',()=>new Transport());
 const stat=t.mock.method(fs,'lstat',async(path:unknown)=>({isSocket:()=>String(path).endsWith('.sock'),isDirectory:()=>!String(path).endsWith('.sock'),uid:process.getuid?.(),mode:0o700}));
 syncBuiltinESMExports();t.after(()=>{connection.mock.restore();stat.mock.restore();syncBuiltinESMExports();});
 for(let i=0;i<2;i++){
  const lookup=createCodexOwnerLookup('/unused',async()=>'26.928.40906+12694');
  try{assert.deepEqual(await Promise.all(['a','b','a','missing'].map(lookup.owner)),['owner-a','owner-b','owner-a',null]);}finally{await lookup.close();}
 }
 assert.equal(initialized,2);assert.equal(closed,2);assert.deepEqual(discoveries,['a','b','missing','a','b','missing']);
});

import {createCodexReader} from '../src/adapters/codex.ts';
for(const changed of [false,true])test(`shared initial owner still requires addressed snapshot and fresh owner recheck, changed=${changed}`,async t=>{
 let initialLookups=0,rechecks=0,unfollowed=0;
 class Transport extends EventEmitter{
  destroyed=false;
  end(callback?:()=>void){callback?.();return this;}
  destroy(){this.destroyed=true;return this;}
  send(frame:object){const b=Buffer.from(JSON.stringify(frame)),h=Buffer.alloc(4);h.writeUInt32LE(b.length);queueMicrotask(()=>this.emit('data',Buffer.concat([h,b])));}
  write(bytes:Buffer){const r=JSON.parse(bytes.subarray(4).toString());
   if(r.method==='initialize')this.send({type:'response',requestId:r.requestId,resultType:'success',result:{clientId:'client'}});
   if(r.method==='thread-owner-discovery'){rechecks++;this.send({type:'response',requestId:r.requestId,resultType:'success',handledByClientId:changed?'new-owner':'owner'});}
   if(r.method==='thread-stream-following-changed'){
    if(!r.params.following){unfollowed++;return true;}
    const frame={type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'owner',targetClientIds:['client'],params:{hostId:'local',conversationId:'thread',change:{type:'snapshot',revision:1,conversationState:{id:'thread',cwd:'/work',turns:[{items:[{id:'good',type:'agentMessage',text:'valid'}]}]}}}};
    this.send({...frame,sourceClientId:'imposter'});this.send({...frame,targetClientIds:['other-client']});this.send({...frame,params:{...frame.params,conversationId:'other-thread'}});this.send(frame);
   }
   return true;
  }
 }
 const connection=t.mock.method(net,'createConnection',()=>{const s=new Transport();setImmediate(()=>s.emit('connect'));return s;});
 const stat=t.mock.method(fs,'lstat',async(path:unknown)=>({isSocket:()=>String(path).endsWith('.sock'),isDirectory:()=>!String(path).endsWith('.sock'),uid:process.getuid?.(),mode:0o700}));
 syncBuiltinESMExports();t.after(()=>{connection.mock.restore();stat.mock.restore();syncBuiltinESMExports();});
 const reader=createCodexReader({socketPath:'/unused/ipc.sock',version:async()=>'26.928.40906+12694',owner:async()=>{initialLookups++;return 'owner';}});
 const target:Registration={provider:'codex',id:'codex:thread',nativeId:'thread',generation:'owner',workspace:'/work',host:'local',displayName:'t',operations:['read'],grants:[]};
 const result=await reader(target,{complete:false});
 if(changed)assert.deepEqual(result,{status:'generation_mismatch',reason:'owner_changed'});
 else {assert.ok('items' in result);assert.equal(result.items[0].text,'valid');}
 assert.equal(initialLookups,1);assert.equal(rechecks,1);assert.equal(unfollowed,1);
});
