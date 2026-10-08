import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createAutomatic,issueTicket} from '../src/automatic.ts';
import {createNativeRuntime} from '../src/native-runtime.ts';
import type {Caller} from '../src/caller.ts';
import {grokHome,ids,OPENED} from './support/grok-fixture.ts';
const GEN='501@'+OPENED;
async function setup(t:Parameters<typeof grokHome>[0],o:{markUnapproved?:boolean}={}){
 const f=await grokHome(t);let cut=false;
 const caller:Caller={provider:'claude',nativeId:'claude-a',generation:'41@100',cwd:f.work,socket:'unused',source:'claude-ancestor'};
 const runtime=createNativeRuntime({home:f.home,processStart:f.processStart,grokVersion:async()=>'1.0.46',markUnapproved:async()=>o.markUnapproved===true,afterGrokPut:()=>{if(cut)throw new Error('connection lost after the write');}});
 const automatic=createAutomatic({home:f.home,limitsPath:join(f.home,'limits.json'),caller:async()=>({status:'ok',caller}),adapter:runtime.adapter,
  scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd}),rows:async()=>[],version:async()=>null,grok:f.grok}});
 const ticket=issueTicket({provider:'grok',nativeId:ids.live,generation:GEN,cwd:f.work,branch:null});
 const pending=async()=>(await readdir(join(f.home,'.seamless','grok-inbox',ids.live,'pending')).catch(()=>[])).filter(n=>n.endsWith('.json'));
 const reservations=async()=>(await readdir(join(f.home,'.seamless','reservations')).catch(()=>[])).filter(n=>/^[0-9a-f]{64}\.json$/.test(n));
 const send=(id:string,text='lsof の回数を数えて')=>automatic('send',{ticket,id,text});
 return {f,send,pending,reservations,setCut:(v:boolean)=>{cut=v;}};
}
test('a send to a running Grok conversation is accepted when its envelope is in pending (status submitted, one envelope)',async t=>{
 const s=await setup(t);const r=await s.send('s1');
 assert.equal(r.status,'submitted');assert.equal((await s.pending()).length,1);
});
test('the same request id is never put again: the earlier result is returned and there is still one envelope',async t=>{
 const s=await setup(t);await s.send('s1');const again=await s.send('s1');
 assert.equal(again.status,'submitted');assert.equal((await s.pending()).length,1);assert.equal((await s.reservations()).length,1);
});
test('a lost connection after the write leaves the outcome unknown, and neither the same id nor the same content under another id is put again',async t=>{
 const s=await setup(t);s.setCut(true);
 assert.equal((await s.send('s2')).status,'unknown');assert.equal((await s.pending()).length,1);
 s.setCut(false);
 assert.equal((await s.send('s2')).status,'unknown');assert.equal((await s.pending()).length,1);
 const other=await s.send('s3');
 assert.equal(other.status,'duplicate_of_unknown');assert.equal(other.requestId,'s2');assert.equal((await s.pending()).length,1);
});
test('a text over 8,000 characters is refused as text_too_long before anything is reserved or put',async t=>{
 const s=await setup(t);const r=await s.send('s4','あ'.repeat(8001));
 assert.equal(r.status,'text_too_long');assert.equal((await s.pending()).length,0);assert.equal((await s.reservations()).length,0);
 assert.equal((await s.send('s5','あ'.repeat(8000))).status,'submitted');
});
for(const mark of [false,true])test(`the Grok inbox envelope carries humanApproval:false only under markUnapproved and never true (markUnapproved=${mark})`,async t=>{
 const s=await setup(t,{markUnapproved:mark});await s.send('s6');
 const [name]=await s.pending();const e=JSON.parse(await readFile(join(s.f.home,'.seamless','grok-inbox',ids.live,'pending',name),'utf8'));
 if(mark)assert.equal(e.humanApproval,false);else assert.ok(!Object.hasOwn(e,'humanApproval'));
 assert.notEqual(e.humanApproval,true);assert.equal(e.recipient.generation,GEN);assert.equal(e.sender.id,'claude:claude-a');
});
test('two conversations sending the same request id to one Grok conversation each get their own envelope and their own inbox state',async t=>{
 const f=await grokHome(t);const reg={id:'grok:'+ids.live,provider:'grok' as const,nativeId:ids.live,generation:GEN,host:'local',displayName:'g',workspace:f.work,operations:['read' as const],grants:[]};
 const runtime=createNativeRuntime({home:f.home,processStart:f.processStart,grokVersion:async()=>'1.0.46'});
 const ticket=issueTicket({provider:'grok',nativeId:ids.live,generation:GEN,cwd:f.work,branch:null});
 const as=(caller:Caller)=>createAutomatic({home:f.home,limitsPath:join(f.home,'limits.json'),caller:async()=>({status:'ok',caller}),adapter:runtime.adapter,scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd}),rows:async()=>[],version:async()=>null,grok:f.grok}});
 const a:Caller={provider:'claude',nativeId:'claude-a',generation:'41@100',cwd:f.work,socket:'unused',source:'claude-ancestor'};
 const b:Caller={provider:'codex',nativeId:'codex-b',generation:'owner',cwd:f.work,socket:'unused',source:'codex-turn-metadata'};
 assert.equal((await as(a)('send',{ticket,id:'task-1',text:'A の依頼'})).status,'submitted');
 assert.equal((await as(b)('send',{ticket,id:'task-1',text:'B の依頼'})).status,'submitted');
 assert.equal((await readdir(join(f.home,'.seamless','grok-inbox',ids.live,'pending'))).filter(n=>n.endsWith('.json')).length,2);
 assert.equal(await runtime.adapter.inboxState!(reg,'task-1',{id:'claude:claude-a',nativeId:'claude-a'}),'pending');
 assert.equal(await runtime.adapter.inboxState!(reg,'task-1',{id:'codex:codex-b',nativeId:'codex-b'}),'pending');
 assert.equal(await runtime.adapter.inboxState!(reg,'task-1',{id:'claude:claude-c',nativeId:'claude-c'}),null);
});
test('an envelope waiting for a generation whose process is gone is orphaned; an unreadable ledger leaves it pending',async t=>{
 const s=await setup(t);await s.send('o1');
 const reg={id:'grok:'+ids.live,provider:'grok' as const,nativeId:ids.live,generation:GEN,host:'local',displayName:'g',workspace:s.f.work,operations:['read' as const],grants:[]};
 const runtime=createNativeRuntime({home:s.f.home,processStart:s.f.processStart,grokVersion:async()=>'1.0.46'});
 const state=()=>runtime.adapter.inboxState!(reg,'o1',{id:'claude:claude-a',nativeId:'claude-a'});
 assert.equal(await state(),'pending');
 await s.f.ledger([]);assert.equal(await state(),'orphaned');
 await s.f.ledger('{unreadable');assert.equal(await state(),'pending');
});
test('the adapter asks for authorization again right before the write: a refusal then puts nothing',async t=>{
 const f=await grokHome(t);
 const runtime=createNativeRuntime({home:f.home,processStart:f.processStart,grokVersion:async()=>'1.0.46'});
 const target={id:'grok:'+ids.live,provider:'grok' as const,nativeId:ids.live,generation:GEN,host:'local' as const,displayName:'g',workspace:f.work,operations:['send' as const],grants:[]};
 const envelope=(id:string)=>({id,sender:{id:'claude:claude-a',nativeId:'claude-a',generation:'41@100'},recipient:{id:'grok:'+ids.live,nativeId:ids.live,generation:GEN},text:'x'});
 const pending=async()=>(await readdir(join(f.home,'.seamless','grok-inbox',ids.live,'pending')).catch(()=>[])).filter(n=>n.endsWith('.json'));
 assert.equal((await runtime.adapter.send(target as any,envelope('a1'),async()=>false)).status,'rejected');assert.deepEqual(await pending(),[]);
 assert.equal((await runtime.adapter.send(target as any,envelope('a2'),async()=>true)).status,'submitted');assert.equal((await pending()).length,1);
});
test('a request already in the inbox without a reservation is not put again and is reported unknown',async t=>{
 const s=await setup(t);const {putEnvelope}=await import('../src/grok-inbox.ts');
 await putEnvelope(s.f.home,{schemaVersion:1,id:'s9',sender:{id:'claude:claude-a',nativeId:'claude-a',generation:'41@100'},recipient:{id:'grok:'+ids.live,nativeId:ids.live,generation:GEN},text:'earlier',acceptedAt:1});
 assert.equal((await s.send('s9')).status,'unknown');assert.equal((await s.pending()).length,1);
});
