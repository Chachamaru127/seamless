import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Delivery,type NativeAdapter} from '../src/delivery.ts';
import {writeCodexMessage,type CodexQueueRun} from '../src/adapters/codex.ts';
import {Registry} from '../src/registry.ts';
import type {Registration} from '../src/protocol.ts';
function registry(){
 const make=(id:string,peer:string):Registration=>({id,provider:id==='a'?'codex':'claude',nativeId:id,generation:'g',host:'local',displayName:id,workspace:'/w',operations:['read','send'],grants:['read','send'].flatMap(operation=>['inbound','outbound'].map(direction=>({peer,operation,direction}))) as Registration['grants']});
 return new Registry([make('a','b'),make('b','a')],async r=>({nativeId:r.nativeId,generation:r.generation,status:'online',observedAt:Date.now(),contextObservedAt:Date.now(),source:'fixture',cwd:'/w',context:{state:'no_git',workspace:'/w'}}));
}
// Reservations and the request hash key live under one temporary directory, so a second Delivery is the restarted process.
function tracked(adapter:NativeAdapter,dir=mkdtempSync(join(tmpdir(),'cldx-unknown-'))){const r=registry();return new Delivery(r,'a',adapter,{tracking:{keyPath:join(dir,'key')},fixedTarget:r.get('b')!,reservationDir:join(dir,'reservations')});}

test('a write cut after it landed is unknown, and the same request id writes once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cldx-unknown-')),written:string[]=[];
 const adapter:NativeAdapter={read:async()=>null,send:async(_target,envelope)=>{written.push(envelope.id);throw Error('disconnected after write');}};
 const delivery=tracked(adapter,dir),request={target:'b',id:'cut',text:'hello'};
 assert.deepEqual(await delivery.send(request),{status:'unknown'});
 assert.equal(written.length,1);
 // The in-memory attempt and the private reservation both stop a second native write.
 assert.deepEqual(await delivery.send(request),{status:'unknown'});
 assert.equal(written.length,1);
 const restarted=tracked(adapter,dir);
 assert.deepEqual(await restarted.send(request),{status:'unknown'});
 assert.equal(written.length,1);
});

test('an indeterminate codex queue result stays unknown and never crosses over to Desktop IPC',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cldx-unknown-queue-')),queue:string[][]=[];let ipcWrites=0;
 const adapter:NativeAdapter={read:async()=>null,send:async(_target,envelope)=>{
  const run:CodexQueueRun=async(_command,args)=>{queue.push(args);throw Object.assign(new Error('timed out'),{killed:true,signal:'SIGTERM'});};
  return writeCodexMessage('thread-1',envelope.text,envelope.id,{run,ipc:async()=>{ipcWrites++;return {status:'submitted',nativeMessageId:'ipc'};}});
 }};
 const delivery=tracked(adapter,dir),request={target:'b',id:'queue-cut',text:'hello'};
 assert.deepEqual(await delivery.send(request),{status:'unknown'});
 assert.deepEqual(queue,[['queue','--thread','thread-1','--message','hello']]);
 assert.equal(ipcWrites,0);
 assert.deepEqual(await delivery.send(request),{status:'unknown'});
 const restarted=tracked(adapter,dir);
 assert.deepEqual(await restarted.send(request),{status:'unknown'});
 assert.equal(queue.length,1);
 assert.equal(ipcWrites,0);
});
