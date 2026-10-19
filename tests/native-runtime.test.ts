import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {createNativeRuntime,findClaudeIdentity,ownedSocket} from '../src/native-runtime.ts';
const r={id:'codex',provider:'codex' as const,nativeId:'session',generation:'owner',host:'local',displayName:'Codex',workspace:tmpdir(),operations:[],grants:[]};
test('no native identity is not manufactured from registration',async()=>{const {observer}=createNativeRuntime({codexIdentity:async()=>null});assert.equal(await observer(r),null);});
test('observation uses native cwd and generation, freshly observes Git',async()=>{const {observer}=createNativeRuntime({codexIdentity:async()=>({nativeId:'session',generation:'actual',cwd:tmpdir(),socket:'/unused'})});const observed=await observer(r);assert.equal(observed?.generation,'actual');assert.equal(observed?.cwd,tmpdir());assert.equal(observed?.status,'online');assert.equal(observed?.source,'native:codex');assert.equal(observed?.gitSource,'observeGit');assert.ok(observed?.contextObservedAt);});
test('identity mismatch rejects before writing',async()=>{const {adapter}=createNativeRuntime({desktopVersion:async()=>'26.928.40906+12694',codexIdentity:async()=>({nativeId:'session',generation:'changed',cwd:tmpdir(),socket:'/unused'})});assert.deepEqual(await adapter.send(r,{id:'m',sender:{id:'c',nativeId:'c',generation:'g'},recipient:{id:'codex',nativeId:'session',generation:'owner'},text:'x'}),{status:'rejected'});});
test('socket mode and ownership are checked',async()=>{const dir=await mkdtemp(join(tmpdir(),'cldx-native-'));await chmod(dir,0o700);const path=join(dir,'peer.sock');const server=createServer();await new Promise<void>(resolve=>server.listen(path,resolve));try{await chmod(path,0o600);assert.equal(await ownedSocket(path),true);await chmod(path,0o666);assert.equal(await ownedSocket(path),false);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}});
test('missing Claude registry is unavailable',async()=>{const dir=await mkdtemp(join(tmpdir(),'cldx-native-'));await mkdir(join(dir,'.claude'));assert.equal(await findClaudeIdentity('absent',dir),null);});
test('inbound ignores ordinary text and forged declared peer',async()=>{const envelope={schemaVersion:1,humanApproval:false,id:'m',sender:{id:'a',nativeId:'a',generation:'g'},recipient:{id:'codex',nativeId:'session',generation:'owner'},text:'hello'};const {adapter}=createNativeRuntime({read:async()=>({status:'ok',items:[{role:'user',text:JSON.stringify(envelope)},{role:'peer',text:JSON.stringify(envelope),peer:{namespace:'claude-peer',declaredSender:'imposter',messageId:'m'}},{role:'peer',text:JSON.stringify(envelope),peer:{namespace:'claude-peer',declaredSender:'claudex',messageId:'other'}},{role:'peer',text:JSON.stringify(envelope),peer:{namespace:'claude-peer',declaredSender:'claudex',messageId:'m'}}]})});assert.deepEqual(await adapter.inbound!(r),[envelope]);});
test('sanitized native peer envelope is accepted without removed schema fields',async()=>{const envelope={id:'native-id',sender:{id:'a',nativeId:'a',generation:'g'},recipient:{id:'codex',nativeId:'session',generation:'owner'},text:'hello'};const {adapter}=createNativeRuntime({read:async()=>({status:'ok',items:[{role:'peer',text:'hello',peer:{namespace:'claudex',messageId:'native-id',envelope}}]})});assert.deepEqual(await adapter.inbound!(r),[envelope]);});

import {EventEmitter} from 'node:events';
import type {Socket} from 'node:net';
import {sendClaudeFrame} from '../src/native-runtime.ts';
class TestSocket extends EventEmitter{
 destroyed=false;writes=0;callback:((error?:Error|null)=>void)|undefined;
 setTimeout(){return this;}
 destroy(){this.destroyed=true;return this;}
 ended=false;end(){this.ended=true;return this;}
 write(_frame:string,callback:(error?:Error|null)=>void){this.writes++;this.callback=callback;return true;}
}
const immediate=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('Claude write callback error is unknown, never submitted',async()=>{const s=new TestSocket();const p=sendClaudeFrame(s as unknown as Socket,async()=>true,'payload','m');s.emit('connect');await immediate();assert.equal(s.writes,1);s.callback!(new Error('write failed'));assert.deepEqual(await p,{status:'unknown'});});
test('Claude disconnect while identity is rechecked never writes',async()=>{const s=new TestSocket();let done!:(v:boolean)=>void;const p=sendClaudeFrame(s as unknown as Socket,()=>new Promise(resolve=>done=resolve),'payload','m');s.emit('connect');s.destroy();s.emit('close');done(true);await immediate();assert.equal(s.writes,0);assert.deepEqual(await p,{status:'rejected'});});
test('Claude disconnect after write attempt stays unknown',async()=>{const s=new TestSocket();const p=sendClaudeFrame(s as unknown as Socket,async()=>true,'payload','m');s.emit('connect');await immediate();s.destroy();s.emit('close');s.callback!();assert.deepEqual(await p,{status:'unknown'});});
test('Claude successful flush half-closes, and submits once Claude closes its side',async()=>{const s=new TestSocket();let settled=false;const p=sendClaudeFrame(s as unknown as Socket,async()=>true,'payload','m');p.then(()=>settled=true);s.emit('connect');await immediate();s.callback!();await immediate();
 // The socket is half-closed and left open: Claude Code's close back is the sign the line was taken.
 assert.equal(s.ended,true);assert.equal(s.destroyed,false);assert.equal(settled,false);
 s.emit('close');assert.deepEqual(await p,{status:'submitted',nativeMessageId:'m'});assert.equal(s.writes,1);});
test('Claude flush with no close from Claude times out unknown',async()=>{const s=new TestSocket();const p=sendClaudeFrame(s as unknown as Socket,async()=>true,'payload','m');s.emit('connect');await immediate();s.callback!();await immediate();s.emit('timeout');assert.deepEqual(await p,{status:'unknown'});});
test('Codex queue failure before submit falls back to IPC, whose error response is unknown',async()=>{
 const home=await mkdtemp(join(tmpdir(),'cldx-codex-'));const dir=join(home,'.codex','ipc');await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);const path=join(dir,'ipc.sock');let writes=0;
 const sockets:Socket[]=[];const server=createServer(socket=>{sockets.push(socket);let buffer=Buffer.alloc(0);socket.on('data',part=>{buffer=Buffer.concat([buffer,part]);while(buffer.length>=4){const size=buffer.readUInt32LE(0);if(buffer.length<4+size)return;const request=JSON.parse(buffer.subarray(4,size+4).toString());buffer=buffer.subarray(size+4);const response={type:'response',requestId:request.requestId,handledByClientId:'owner',resultType:request.method==='thread-follower-start-turn'?'error':'success',result:request.method==='initialize'?{clientId:'client'}:{}};if(request.method==='thread-follower-start-turn')writes++;const body=Buffer.from(JSON.stringify(response)),head=Buffer.alloc(4);head.writeUInt32LE(body.length);socket.write(Buffer.concat([head,body]));}});});
 await new Promise<void>(resolve=>server.listen(path,resolve));try{const {adapter}=createNativeRuntime({home,desktopVersion:async()=>'26.928.40906+12694',codexIdentity:async()=>({nativeId:r.nativeId,generation:r.generation,cwd:tmpdir(),socket:path}),codexQueue:async()=>{throw Object.assign(new Error('spawn codex'),{code:'ENOENT'});}});const result=await adapter.send(r,{id:'m',sender:{id:'a',nativeId:'a',generation:'g'},recipient:{id:r.id,nativeId:r.nativeId,generation:r.generation},text:'test'});assert.equal(result.status,'unknown');assert.equal(writes,1);}finally{for(const s of sockets)s.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('Codex send queues the envelope JSON through writeCodexMessage and submits',async()=>{
 const home=await mkdtemp(join(tmpdir(),'cldx-codex-queue-send-'));const calls:{command:string;args:string[];timeoutMs:number}[]=[];
 const {adapter}=createNativeRuntime({home,desktopVersion:async()=>'26.928.40906+12694',codexIdentity:async()=>({nativeId:r.nativeId,generation:r.generation,cwd:tmpdir(),socket:'/unused'}),codexQueue:async(command,args,timeoutMs)=>{calls.push({command,args,timeoutMs});}});
 const envelope={id:'m',sender:{id:'a',nativeId:'a',generation:'g'},recipient:{id:r.id,nativeId:r.nativeId,generation:r.generation},text:'test'};
 const receipt=await adapter.send(r,envelope);
 assert.deepEqual(receipt,{status:'submitted',nativeMessageId:'m'});
 assert.equal(calls.length,1);assert.equal(calls[0].command,'codex');
 assert.deepEqual(calls[0].args.slice(0,4),['queue','--thread','session','--message']);
 const payload=JSON.parse(calls[0].args[4]);
 assert.equal(payload.id,envelope.id);assert.equal(payload.schemaVersion,1);assert.equal(payload.text,'test');
 assert.deepEqual(payload.sender,envelope.sender);assert.deepEqual(payload.recipient,envelope.recipient);
});

test('Codex send measures the ceiling on the body text, not the envelope JSON',async()=>{
 const home=await mkdtemp(join(tmpdir(),'cldx-codex-queue-limit-'));const calls:{command:string;args:string[];timeoutMs:number}[]=[];
 const {adapter}=createNativeRuntime({home,desktopVersion:async()=>'26.928.40906+12694',codexIdentity:async()=>({nativeId:r.nativeId,generation:r.generation,cwd:tmpdir(),socket:'/unused'}),codexQueue:async(command,args,timeoutMs)=>{calls.push({command,args,timeoutMs});},limits:{codexMessageMaxChars:3}});
 const envelope={id:'m',sender:{id:'a',nativeId:'a',generation:'g'},recipient:{id:r.id,nativeId:r.nativeId,generation:r.generation},text:'abc'};
 assert.deepEqual(await adapter.send(r,envelope),{status:'submitted',nativeMessageId:'m'});
 assert.equal(calls.length,1);assert.ok(calls[0].args[4].length>3);
 assert.deepEqual(await adapter.send(r,{...envelope,id:'n',text:'abcd'}),{status:'rejected',reason:'too_long'});
 assert.equal(calls.length,1);
});

test('Codex send takes the ceiling from limits in home when no option is given',async()=>{
 const home=await mkdtemp(join(tmpdir(),'cldx-codex-queue-limit-file-'));const path=join(home,'.seamless','limits.json');
 assert.equal((await writeLimits({...unrestricted,codexMessageMaxChars:3},null,path)).status,'ok');
 let calls=0;
 const {adapter}=createNativeRuntime({home,desktopVersion:async()=>'26.928.40906+12694',codexIdentity:async()=>({nativeId:r.nativeId,generation:r.generation,cwd:tmpdir(),socket:'/unused'}),codexQueue:async()=>{calls++;}});
 const envelope={id:'m',sender:{id:'a',nativeId:'a',generation:'g'},recipient:{id:r.id,nativeId:r.nativeId,generation:r.generation},text:'abcd'};
 assert.deepEqual(await adapter.send(r,envelope),{status:'rejected',reason:'too_long'});
 assert.equal(calls,0);
});

test('a timed-out Codex queue is unknown and never falls back to IPC',async()=>{
 const home=await mkdtemp(join(tmpdir(),'cldx-codex-queue-timeout-'));const dir=join(home,'.codex','ipc');await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);const path=join(dir,'ipc.sock');
 let connections=0,writes=0;const sockets:Socket[]=[];const server=createServer(socket=>{connections++;sockets.push(socket);socket.on('data',part=>{const request=JSON.parse(part.subarray(4).toString());if(request.method==='thread-follower-start-turn')writes++;});});
 await new Promise<void>(resolve=>server.listen(path,resolve));try{const {adapter}=createNativeRuntime({home,desktopVersion:async()=>'26.928.40906+12694',codexIdentity:async()=>({nativeId:r.nativeId,generation:r.generation,cwd:tmpdir(),socket:path}),codexQueue:async()=>{throw Object.assign(new Error('timed out'),{killed:true,signal:'SIGTERM'});}});const result=await adapter.send(r,{id:'m',sender:{id:'a',nativeId:'a',generation:'g'},recipient:{id:r.id,nativeId:r.nativeId,generation:r.generation},text:'test'});assert.equal(result.status,'unknown');assert.equal(connections,0);assert.equal(writes,0);}finally{for(const s of sockets)s.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('Claude revoked authorization after transport connect prevents write',async()=>{const s=new TestSocket();const p=sendClaudeFrame(s as unknown as Socket,async()=>false,'payload','m');s.emit('connect');assert.deepEqual(await p,{status:'rejected'});assert.equal(s.writes,0);});

for(const namespace of ['seamless','claude-peer'])test(`native inbound accepts seamless sender via ${namespace}`,async()=>{
 const envelope={id:'native-id',sender:{id:'a',nativeId:'a',generation:'g'},recipient:{id:'codex',nativeId:'session',generation:'owner'},text:'hello'};
 const {adapter}=createNativeRuntime({read:async()=>({status:'ok',items:[{role:'peer',text:'hello',peer:{namespace,declaredSender:'seamless',messageId:'native-id',envelope}}]})});
 assert.deepEqual(await adapter.inbound!(r),[envelope]);
});

for(const humanApproval of [undefined,false,true,'false',null])test(`native inbound approval marker ${typeof humanApproval}:${String(humanApproval)}`,async()=>{
 const envelope={schemaVersion:1,...(humanApproval===undefined?{}:{humanApproval}),id:'m',sender:{id:'a',nativeId:'a',generation:'g'},recipient:{id:r.id,nativeId:r.nativeId,generation:r.generation},text:'hello'};
 const {adapter}=createNativeRuntime({read:async()=>({status:'ok',items:[{role:'peer',text:JSON.stringify(envelope),peer:{namespace:'seamless',messageId:'m'}}]})});
 assert.deepEqual(await adapter.inbound!(r),humanApproval===undefined||humanApproval===false?[envelope]:[]);
});

import net from 'node:net';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {readLimits,unrestricted,writeLimits} from '../src/limits.ts';
// TC-3b (specs/202610-more-peers): an envelope a registered Grok Bot signed (src/external-inbound.ts) is written by this same
// adapter, so it gets the same marker, and never humanApproval:true.
const markerSenders={local:{id:'a',nativeId:'a',generation:'g'},'grok-bot':{id:'grok-bot:chachamaru',nativeId:'chachamaru',generation:'1'}} as const;
for(const [from,sender] of Object.entries(markerSenders))for(const provider of ['claude','codex'] as const)for(const mark of [undefined,false,true,'legacy'] as const)test(`${provider} envelope marker from a ${from} sender with markUnapproved=${String(mark)}`,async t=>{
 const home=await mkdtemp(join(tmpdir(),'marker-')),path=join(home,'limits.json');
 if(mark!==undefined&&mark!=='legacy')await fs.writeFile(path,JSON.stringify({...unrestricted,markUnapproved:mark}),{mode:0o600});
 let payload:Record<string,unknown>|undefined,content:string|undefined,queued:string|undefined;
 class Transport extends EventEmitter{
  destroyed=false;setTimeout(){return this;}destroy(){this.destroyed=true;return this;}
  // Like Claude Code, closes its side once the sender half-closes.
  end(){queueMicrotask(()=>this.emit('close'));return this;}
  write(frame:string|Buffer,callback?:(error?:Error|null)=>void){
   if(provider==='claude'){content=JSON.parse(String(frame)).message.content;payload=JSON.parse(content!);callback?.();return true;}
   const bytes=frame as Buffer,request=JSON.parse(bytes.subarray(4).toString());
   if(request.method==='thread-follower-start-turn')payload=JSON.parse(request.params.turnStart.request.toolOutput.output);
   const body=Buffer.from(JSON.stringify({type:'response',requestId:request.requestId,handledByClientId:'owner',resultType:'success',result:request.method==='initialize'?{clientId:'client'}:{}}));
   const prefix=Buffer.alloc(4);prefix.writeUInt32LE(body.length);queueMicrotask(()=>this.emit('data',Buffer.concat([prefix,body])));return true;
  }
 }
 const connection=t.mock.method(net,'createConnection',()=>{const socket=new Transport();setImmediate(()=>socket.emit('connect'));return socket;});
 const realLstat=fs.lstat;
 const stat=t.mock.method(fs,'lstat',async(p:Parameters<typeof fs.lstat>[0],...args:unknown[])=>{
  if(String(p).endsWith('/ipc.sock'))return {isSocket:()=>true,uid:process.getuid?.(),mode:0o600};
  if(String(p).endsWith('/ipc'))return {isDirectory:()=>true,uid:process.getuid?.(),mode:0o700};
  return (realLstat as Function)(p,...args);
 });
 syncBuiltinESMExports();t.after(()=>{connection.mock.restore();stat.mock.restore();syncBuiltinESMExports();});
 const target={...r,provider};
 const identity=async()=>({nativeId:r.nativeId,generation:r.generation,cwd:home,socket:join(home,'.codex','ipc','ipc.sock')});
 const {adapter}=createNativeRuntime({home,desktopVersion:async()=>'26.928.40906+12694',claudeVersion:async()=>'2.1.284',codexIdentity:identity,claudeIdentity:identity,...(provider==='codex'?{codexQueue:async(_command:string,args:string[])=>{queued=args[4];}}:{}),...(mark==='legacy'?{}:{markUnapproved:async()=>{const l=await readLimits(path);return l.status==='ok'&&l.value.markUnapproved===true;}})});
 const receipt=await adapter.send(target,{id:'m',sender:{...sender},recipient:{id:r.id,nativeId:r.nativeId,generation:r.generation},text:'test'});
 if(provider==='codex')payload=JSON.parse(queued!);
 assert.equal(receipt.status,'submitted');assert.ok(payload);
 const {createHash}=await import('node:crypto');
 assert.equal(receipt.payloadSha256,provider==='claude'?createHash('sha256').update(content!).digest('hex'):undefined);
 assert.equal(Object.hasOwn(payload,'humanApproval'),mark===true);
 if(mark===true)assert.equal(payload.humanApproval,false);
 assert.notEqual(payload.humanApproval,true);assert.equal((payload.sender as {id:string}).id,sender.id);
});
