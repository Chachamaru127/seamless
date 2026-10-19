import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CODEX_QUEUE_TIMEOUT_MS,writeCodexMessage,type CodexQueueRun} from '../src/adapters/codex.ts';
import {DEFAULT_CODEX_MESSAGE_MAX_CHARS,readLimits,writeLimits,type Limits} from '../src/limits.ts';

const empty:Limits={version:1,exclude:[],scope:null,operations:null};

function fakeRun(){
 const calls:{command:string;args:string[];timeoutMs:number}[]=[];
 const run:CodexQueueRun=async(command,args,timeoutMs)=>{calls.push({command,args,timeoutMs});};
 return {calls,run};
}

test('a queued message runs `codex queue --thread <id> --message <text>` and is submitted by the queue itself',async()=>{
 const {calls,run}=fakeRun();let ipcWrites=0;
 const receipt=await writeCodexMessage('thread-1','本文です','m1',{run,ipc:async()=>{ipcWrites++;return {status:'submitted',nativeMessageId:'ipc'};}});
 assert.deepEqual(calls,[{command:'codex',args:['queue','--thread','thread-1','--message','本文です'],timeoutMs:CODEX_QUEUE_TIMEOUT_MS}]);
 assert.deepEqual(receipt,{status:'submitted',nativeMessageId:'m1'});
 assert.equal(ipcWrites,0);
});

test('limits set the message ceiling; one code point over is rejected before anything is queued',async t=>{
 const {calls,run}=fakeRun();
 for(const [text,status] of [['あいう','submitted'],['あいうえ','rejected']] as const){
  const receipt=await writeCodexMessage('thread-1',text,'m1',{run,limits:{codexMessageMaxChars:3},ipc:async()=>{throw new Error('ipc must not be called');}});
  assert.equal(receipt.status,status);
  if(status==='rejected')assert.equal(receipt.reason,'too_long');
 }
 assert.equal(calls.length,1);assert.deepEqual(calls[0].args,['queue','--thread','thread-1','--message','あいう']);

 const dir=await mkdtemp(join(tmpdir(),'cldx-codex-queue-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'limits.json');assert.equal((await writeLimits({...empty,codexMessageMaxChars:3},null,path)).status,'ok');
 const limits=await readLimits(path);assert.equal(limits.status,'ok');if(limits.status!=='ok')return;
 assert.equal(limits.value.codexMessageMaxChars,3);
 const long=await writeCodexMessage('thread-1','あいうえ','m1',{run,limits:limits.value,ipc:async()=>{throw new Error('ipc must not be called');}});
 assert.deepEqual(long,{status:'rejected',reason:'too_long'});
});

test('the default ceiling is the Open decision 2 value, counted in code points',async()=>{
 const {calls,run}=fakeRun();const ipc=async()=>({status:'submitted' as const,nativeMessageId:'ipc'});
 const exact=await writeCodexMessage('thread-1','あ'.repeat(DEFAULT_CODEX_MESSAGE_MAX_CHARS),'m1',{run,ipc});
 assert.deepEqual(exact,{status:'submitted',nativeMessageId:'m1'});
 const over=await writeCodexMessage('thread-1','あ'.repeat(DEFAULT_CODEX_MESSAGE_MAX_CHARS+1),'m1',{run,ipc});
 assert.deepEqual(over,{status:'rejected',reason:'too_long'});
 assert.equal(calls.length,1);
});

test('a failure the queue returned before submitting falls back to Desktop IPC once',async()=>{
 const cases=[...['ENOENT','EACCES','ENOTDIR'].map(code=>Object.assign(new Error(`spawn codex ${code}`),{code})),Object.assign(new Error('exit 2'),{code:2,stderr:'error: unexpected argument\n\nUsage: codex queue --thread <ID> --message <TEXT>\n'})];
 for(const error of cases){
  const {calls,run}=fakeRun();let ipcWrites=0;
  const receipt=await writeCodexMessage('thread-1','hello','m1',{run:async(command,args,timeoutMs)=>{await run(command,args,timeoutMs);throw error;},ipc:async()=>{ipcWrites++;return {status:'submitted',nativeMessageId:'m1'};}});
  assert.deepEqual(receipt,{status:'submitted',nativeMessageId:'m1'});
  assert.equal(calls.length,1);assert.equal(ipcWrites,1);
 }
});

test('a numeric exit code without usage is unknown and never falls back to IPC',async()=>{
 for(const error of [Object.assign(new Error('exit 1'),{code:1}),Object.assign(new Error('exit 2'),{code:2,stderr:'queue rejected: thread not found\n'}),Object.assign(new Error('exit 2 without stderr'),{code:2}),Object.assign(new Error('exit 127'),{code:127})]){
  const {run}=fakeRun();let ipcWrites=0;
  const receipt=await writeCodexMessage('thread-1','hello','m1',{run:async()=>{throw error;},ipc:async()=>{ipcWrites++;return {status:'submitted',nativeMessageId:'m1'};}});
  assert.deepEqual(receipt,{status:'unknown'});
  assert.equal(ipcWrites,0);
 }
});

test('an indeterminate queue outcome never falls back to IPC',async()=>{
 for(const error of [Object.assign(new Error('timed out'),{killed:true,signal:'SIGTERM'}),Object.assign(new Error('killed'),{killed:true}),Object.assign(new Error('strange'),{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'})]){
  const {run}=fakeRun();let ipcWrites=0;
  const receipt=await writeCodexMessage('thread-1','hello','m1',{run:async()=>{throw error;},ipc:async()=>{ipcWrites++;return {status:'submitted',nativeMessageId:'m1'};}});
  assert.deepEqual(receipt,{status:'unknown'});
  assert.equal(ipcWrites,0);
 }
});

test('limits only accept a positive whole number of characters for the ceiling',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'cldx-codex-queue-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'limits.json');
 for(const value of [0,1.5,'4000',-1]){
  assert.equal((await writeLimits({...empty,codexMessageMaxChars:value} as never,null,path)).status,'unusable');
 }
 assert.equal((await writeLimits({...empty,codexMessageMaxChars:1},null,path)).status,'ok');
 const saved=await readLimits(path);assert.equal(saved.status,'ok');if(saved.status==='ok')assert.equal(saved.value.codexMessageMaxChars,1);
});
