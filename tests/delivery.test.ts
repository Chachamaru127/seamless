import {spawn} from 'node:child_process';
import {readdir,readFile,stat} from 'node:fs/promises';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Delivery } from '../src/delivery.ts';
import { Registry } from '../src/registry.ts';
import type { Registration } from '../src/protocol.ts';
function setup(reservationDir=mkdtempSync(join(tmpdir(),'cldx-delivery-'))){
 const make=(id:string,peer:string):Registration=>({id,provider:id==='a'?'codex':'claude',nativeId:id,generation:'g',host:'local',displayName:id,workspace:'/w',operations:['read','send'],grants:['read','send'].flatMap(operation=>['inbound','outbound'].map(direction=>({peer,operation,direction}))) as Registration['grants']});
 const registry=new Registry([make('a','b'),make('b','a')],async r=>({nativeId:r.nativeId,generation:r.generation,status:'online',observedAt:Date.now(),contextObservedAt:Date.now(),source:'fixture',cwd:'/w',context:{state:'no_git',workspace:'/w'}}));
 let writes=0;let fail=false;
 const delivery=new Delivery(registry,'a',{read:async()=>({status:'ok',messages:[]}),send:async(_r,e)=>{writes++;assert.equal(e.sender.id,'a');assert.equal(e.recipient.id,'b');if(fail)throw Error();return {status:'submitted'};}},{reservationDir});
 return {registry,delivery,writes:()=>writes,fail:()=>{fail=true;}};
}
test('concurrent same ID writes once and changed body conflicts',async()=>{const s=setup();const p={id:'n',text:'hello'};const results=await Promise.all([s.delivery.send(p),s.delivery.send(p)]);assert.deepEqual(results,[{status:'submitted'},{status:'submitted'}]);assert.equal(s.writes(),1);assert.deepEqual(await s.delivery.send({...p,text:'other'}),{status:'id_conflict'});});
test('unknown never retries',async()=>{const s=setup();s.fail();const p={id:'n',text:'hello'};assert.deepEqual(await s.delivery.send(p),{status:'unknown'});assert.deepEqual(await s.delivery.send(p),{status:'unknown'});assert.equal(s.writes(),1);});
test('revoked grant blocks native write',async()=>{const s=setup();const records=s.registry.list();records[1].grants=[];s.registry.replace(records);await s.delivery.send({target:'b',id:'n',text:'hello'});assert.equal(s.writes(),0);});
test('unverified reply correlation rejects before delivery',async()=>{const s=setup();assert.deepEqual(await s.delivery.send({id:'n',text:'hello',replyTo:'untrusted'}),{status:'invalid_reply'});assert.equal(s.writes(),0);});

test('reply binds registered inbound sender and rejects another target',async()=>{const s=setup();assert.equal(s.delivery.acceptInbound({id:'request',text:'hi',sender:{id:'b',nativeId:'b',generation:'g'},recipient:{id:'a',nativeId:'a',generation:'g'}}),true);assert.deepEqual(await s.delivery.send({id:'response',text:'reply',target:'b',replyTo:'request'}),{status:'submitted'});assert.deepEqual(await s.delivery.send({id:'bad',text:'reply',target:'other',replyTo:'request'}),{status:'invalid_reply'});assert.equal(s.writes(),1);});
test('reply revocation and generation change stop before native write',async()=>{const s=setup();assert.equal(s.delivery.acceptInbound({id:'request',text:'hi',sender:{id:'b',nativeId:'b',generation:'g'},recipient:{id:'a',nativeId:'a',generation:'g'}}),true);const records=s.registry.list();records[1].generation='new';s.registry.replace(records);assert.deepEqual(await s.delivery.send({id:'response',text:'reply',target:'b',replyTo:'request'}),{status:'invalid_reply'});assert.equal(s.writes(),0);});
test('sender spoof is invalid before native write',async()=>{const s=setup();await assert.rejects(s.delivery.send({id:'n',text:'hello',sender:'b'}),/invalid_params/);assert.equal(s.writes(),0);});

test('separate Delivery instances share atomic reservation and restart keeps unknown',async()=>{const dir=mkdtempSync(join(tmpdir(),'cldx-shared-'));const a=setup(dir),b=setup(dir);a.fail();b.fail();await Promise.all([a.delivery.send({id:'shared',text:'hello'}),b.delivery.send({id:'shared',text:'hello'})]);assert.equal(a.writes()+b.writes(),1);const restarted=setup(dir);assert.deepEqual(await restarted.delivery.send({id:'shared',text:'hello'}),{status:'unknown'});assert.equal(restarted.writes(),0);});

test('parallel operating-system processes write once; restart cannot resend',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cldx-process-'));
 const script=`import {Delivery} from './src/delivery.ts';import {Registry} from './src/registry.ts';import {appendFile} from 'node:fs/promises';const dir=process.argv[1];const r=(id,peer)=>({id,provider:id==='a'?'codex':'claude',nativeId:id,generation:'g',host:'local',displayName:id,workspace:'/w',operations:['send'],grants:[{peer,operation:'send',direction:'inbound'},{peer,operation:'send',direction:'outbound'}]});const registry=new Registry([r('a','b'),r('b','a')],async r=>({nativeId:r.nativeId,generation:r.generation,status:'online',observedAt:Date.now(),contextObservedAt:Date.now(),source:'fixture',cwd:'/w',context:{state:'no_git',workspace:'/w'}}));const d=new Delivery(registry,'a',{read:async()=>null,send:async()=>{if(process.env.CLDX_TEST_CRASH==='1')process.exit(0);await appendFile(dir+'/writes','write\\n');return {status:'unknown'};}},{reservationDir:dir});console.log(JSON.stringify(await d.send({id:'same',text:'secret-body'})));`;
 const run=(crash=false)=>new Promise<string>((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',script,dir],{env:{...process.env,CLDX_TEST_CRASH:crash?'1':'0'}});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('exit',code=>code===0?resolve(out):reject(Error(err)));});
 await Promise.all([run(),run()]);assert.equal(await readFile(join(dir,'writes'),'utf8'),'write\n');assert.equal(JSON.parse(await run()).status,'unknown');assert.equal(await readFile(join(dir,'writes'),'utf8'),'write\n');const file=(await readdir(dir)).find(p=>p.endsWith('.json'))!;assert.equal((await stat(join(dir,file))).mode&0o777,0o600);const body=await readFile(join(dir,file),'utf8');assert.equal(body.includes('secret-body'),false);assert.deepEqual(Object.keys(JSON.parse(body)).sort(),['at','hash','status']);
 const pendingDir=mkdtempSync(join(tmpdir(),'cldx-crash-'));const crashScript=script.replace('const dir=process.argv[1]',`const dir=${JSON.stringify(pendingDir)}`);await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',crashScript,pendingDir],{env:{...process.env,CLDX_TEST_CRASH:'1'}});child.on('exit',code=>code===0?resolve():reject(Error(String(code))));});const restart=setup(pendingDir);assert.deepEqual(await restart.delivery.send({id:'same',text:'secret-body'}),{status:'unknown'});assert.equal(restart.writes(),0);
});
test('write-time authorize callback reflects revocation during transport setup',async()=>{const s=setup();let wrote=false;const delivery=new Delivery(s.registry,'a',{read:async()=>null,send:async(_target,_envelope,authorize)=>{const records=s.registry.list();records[1].grants=[];s.registry.replace(records);if(!await authorize!())return {status:'rejected'};wrote=true;return {status:'submitted'};}},{reservationDir:mkdtempSync(join(tmpdir(),'cldx-revoke-'))});assert.deepEqual(await delivery.send({id:'n',text:'hello'}),{status:'rejected'});assert.equal(wrote,false);});

for(const duringAdapter of [false,true])test(`write-time rejection releases in-memory and disk reservation: adapter=${duringAdapter}`,async()=>{
 const s=setup(),reservationDir=mkdtempSync(join(tmpdir(),'cldx-retry-'));let checks=0,writes=0,reject=true;
 const delivery=new Delivery(s.registry,'a',{read:async()=>null,send:async(_r,_e,authorize)=>{if(duringAdapter&&!await authorize!())return {status:'rejected'};writes++;return {status:'submitted'};}},{reservationDir,fixedTarget:s.registry.get('b')!,validate:async()=>{checks++;return reject&&checks===(duringAdapter?3:2)?'caller_unobserved':null;}});
 const request={target:'b',id:'retry',text:'hello'};
 assert.deepEqual(await delivery.send(request),{status:'caller_unobserved'});assert.equal(writes,0);assert.deepEqual(await readdir(reservationDir),[]);
 reject=false;assert.deepEqual(await delivery.send(request),{status:'submitted'});
 assert.deepEqual(await delivery.send(request),{status:'submitted'});assert.equal(writes,1);
 const restarted=setup(reservationDir);assert.deepEqual(await restarted.delivery.send(request),{status:'submitted'});assert.equal(restarted.writes(),0);
});

for(const status of ['submitted','unknown'] as const)test(`write receipt ${status} retains reservation even after failed recheck`,async()=>{
 const s=setup(),reservationDir=mkdtempSync(join(tmpdir(),'cldx-receipt-'));let denied=false,writes=0;
 const delivery=new Delivery(s.registry,'a',{read:async()=>null,send:async(_r,_e,authorize)=>{writes++;denied=true;assert.equal(await authorize!(),false);return {status};}},{reservationDir,fixedTarget:s.registry.get('b')!,validate:async()=>denied?'caller_unobserved':null});
 const request={target:'b',id:'retained',text:'hello'};
 assert.deepEqual(await delivery.send(request),{status});denied=false;
 assert.deepEqual(await delivery.send(request),{status});assert.equal(writes,1);
 const restarted=setup(reservationDir);assert.deepEqual(await restarted.delivery.send(request),{status});assert.equal(restarted.writes(),0);
});

test('receipts never carry the payload hash, including write-time rejection',async()=>{
 for(const status of ['submitted','rejected'] as const){
  const s=setup(),reservationDir=mkdtempSync(join(tmpdir(),'cldx-hash-'));let checks=0;
  const delivery=new Delivery(s.registry,'a',{read:async()=>null,send:async(_r,_e,authorize)=>{if(status==='rejected')await authorize!();return {status,payloadSha256:'f'.repeat(64)};}},{reservationDir,fixedTarget:s.registry.get('b')!,refresh:async()=>{if(status==='rejected'&&++checks>1)throw new Error('refresh failed');}});
  const receipt=await delivery.send({target:'b',id:'hash-'+status,text:'hello'}) as Record<string,unknown>;
  assert.equal('payloadSha256' in receipt,false,status);assert.equal(receipt.status,status);
 }
});
