import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath,writeFile,readFile,mkdir,chmod} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {runCli} from '../src/cli.ts';
import {wasSigned} from '../src/nonce-store.ts';
import {requests} from '../src/request-store.ts';
import {externalFixture,peerRecord,sign,isoSeconds,requestToBot,T0} from './support/signed-fixture.ts';
import {fakeKeychain} from './support/keychain-fixture.ts';

// `bot-send <registration>` and `bot-sessions <registration>`: the MVP's stand-in for the Bot's own signing (src/bot-sign.ts). The signed
// envelope goes through exactly the path `send --as` / `sessions --as` use, so what is tested here is the signing and the hand-over.
type Fixture=Awaited<ReturnType<typeof externalFixture>>;
async function cli(args:string[],stdin:()=>Promise<string>,automatic:Parameters<typeof runCli>[1]){
 let output='';const log=console.log;console.log=(v:unknown)=>{output+=String(v);};
 try{await runCli(args,automatic,undefined,stdin);}finally{console.log=log;}
 return output?JSON.parse(output):null;
}
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const DEST='claude:claude-b:42@100';
const unsigned=(over:Record<string,unknown>={})=>({recipient:DEST,id:'bs-1',text:'ビルドが終わったら教えて',...over});
const botSend=(f:Fixture,input:unknown,using=f.automatic,name='chachamaru')=>cli(['bot-send',name],async()=>typeof input==='string'?input:JSON.stringify(input),using);
const handSigned=(f:Fixture,over:Record<string,unknown>={})=>cli(['send','--as','chachamaru'],async()=>JSON.stringify(f.envelope({recipient:DEST,id:'bs-1',text:'ビルドが終わったら教えて',...over})),f.automatic);
// Two fixtures are two temporary homes: a path under one is the same path under the other once the home is named '<home>'.
const dropHash=(f:Fixture,rs:Awaited<ReturnType<typeof requests>>)=>JSON.parse(JSON.stringify(rs.map(({hash,...rest})=>rest)).replaceAll(f.home,'<home>'));
const anon=(f:Fixture,v:unknown)=>JSON.parse(JSON.stringify(v).replaceAll(f.home,'<home>'));

test('bot-send gives the same result, delivery and records as the same request signed by hand and sent with send --as',async t=>{
 const a=await externalFixture(t),b=await externalFixture(t);
 const viaBot=await botSend(a,unsigned());
 const byHand=await handSigned(b);
 assert.equal(viaBot.status,'submitted',JSON.stringify(viaBot));
 assert.deepEqual(anon(a,viaBot),anon(b,byHand));
 assert.deepEqual(anon(a,a.sent),anon(b,b.sent));assert.equal(a.writes(),1);
 assert.deepEqual(dropHash(a,await requests(a.reservations)),dropHash(b,await requests(b.reservations)));
 const [x]=await a.readNonces(),[y]=await b.readNonces();
 const {signedBy,...xRest}=x;
 assert.equal(signedBy,'mac','the one difference: the record says this Mac signed it');assert.equal('signedBy' in y,false);
 assert.deepEqual({...xRest,nonce:'-',signatureSha256:'-'},{...y,nonce:'-',signatureSha256:'-'},'the nonce record says the same (registration, key version, id, destination, time)');
});
test('what this Mac signed is not shown as the Bot\'s: the record says so, and the recipient sees it as declared, while an envelope the Bot signed stays verified',async t=>{
 const f=await externalFixture(t);
 assert.equal((await botSend(f,unsigned({id:'mac-1',text:'この Mac が署名した'}))).status,'submitted');
 assert.equal((await handSigned(f,{id:'bot-1',text:'茶々丸が署名した'})).status,'submitted');
 const records=await f.readNonces(),mac=records.find(r=>r.id==='mac-1'),bot=records.find(r=>r.id==='bot-1');
 assert.equal(mac.signedBy,'mac');assert.equal('signedBy' in bot,false,'only the command that signs here marks its records');
 const [macSent,botSent]=f.sent;assert.equal(macSent.id,'mac-1');
 assert.equal(await wasSigned(f.nonces,f.reservations,botSent),true);
 assert.equal(await wasSigned(f.nonces,f.reservations,macSent),false,'a signature made on this Mac proves nothing about the Bot');
 // What the conversation sees in its own listing.
 const claudeB={provider:'claude' as const,nativeId:'claude-b',generation:'42@100',cwd:f.work,socket:'unused',source:'claude-ancestor' as const};
 const received=[macSent,botSent].map(e=>({id:e.id,sender:e.sender,recipient:e.recipient,at:new Date(f.now()).toISOString()}));
 const seen=await f.make({caller:async()=>({status:'ok',caller:claudeB}),adapter:{...f.adapter,received:async()=>received}})('sessions',{peek:true});
 assert.deepEqual(Object.fromEntries(seen.inbound.map((i:any)=>[i.id,i.sender])),{'mac-1':'declared','bot-1':'verified'});
 // A listing signed here is marked the same way.
 await cli(['bot-sessions','chachamaru'],async()=>'',f.automatic);
 assert.equal((await f.readNonces()).find(r=>r.op==='sessions').signedBy,'mac');
});
// 2026-10-11 の逆の家系の判定: the Bot's signature spent on a request that was not delivered (the destination was not running) left the
// one name "was this request signed" looks up; the same id delivered later by bot-send was then shown as the Bot's (verified).
test('a request the Bot signed but that was not delivered, then delivered under the same id by bot-send, is shown as declared',async t=>{
 const f=await externalFixture(t);
 const offline=f.make({inspect:async()=>null});
 const env=f.envelope({recipient:DEST,id:'re-1',text:'あとで届く'});
 assert.equal((await f.call('send',env,'chachamaru',offline)).status,'target_offline');
 assert.equal(f.writes(),0);
 assert.equal((await botSend(f,unsigned({id:'re-1',text:'あとで届く'}))).status,'submitted');
 assert.equal(f.writes(),1);
 const [delivered]=f.sent;assert.equal(delivered.id,'re-1');
 assert.equal(await wasSigned(f.nonces,f.reservations,delivered),false,'the delivery was made by a signature of this Mac');
});
test('the signature is the contract\'s: the same nine lines and HMAC-SHA256 a hand-signed envelope gets, with a fresh random nonce each time',async t=>{
 const f=await externalFixture(t);const seen=new Set<string>();
 for(const id of ['n-1','n-2','n-3']){
  await botSend(f,unsigned({id,text:`本文 ${id}`}));
 }
 const records=await f.readNonces();assert.equal(records.length,3);
 for(const r of records){
  assert.match(r.nonce,/^[A-Za-z0-9_-]{22}$/,'16 random bytes as base64url');seen.add(r.nonce);
  const expected=sign(f.keys.recv,{sender:'chachamaru',keyVersion:1,recipient:DEST,id:r.id,text:`本文 ${r.id}`,signedAt:isoSeconds(T0),nonce:r.nonce});
  assert.equal(r.signatureSha256,sha(expected.signature),'the stored digest is of the signature the contract gives');
 }
 assert.equal(seen.size,3);
});
test('signedAt is this Mac\'s clock to the second, and a rotated key version is the roster\'s',async t=>{
 const f=await externalFixture(t);f.setNow(T0+1234);await f.writePeers(peerRecord({scope:[f.work],keyVersion:2}));
 const r=await botSend(f,unsigned());
 assert.equal(r.status,'submitted',JSON.stringify(r));
 const [n]=await f.readNonces();assert.equal(n.keyVersion,2);
 const expected=sign(f.keys.recv,{sender:'chachamaru',keyVersion:2,recipient:DEST,id:'bs-1',text:unsigned().text,signedAt:isoSeconds(T0+1234),nonce:n.nonce});
 assert.equal(n.signatureSha256,sha(expected.signature));assert.equal(f.sent[0].sender.generation,'2');
});
test('a reply carries replyTo into the signature, and a replyTo that points at nothing is refused as for any outside sender',async t=>{
 const f=await externalFixture(t);
 await requestToBot(f.reservations,{id:'orig-1',from:{provider:'claude',nativeId:'claude-b',generation:'42@100',cwd:f.work}});
 const ok=await botSend(f,unsigned({id:'ans-1',replyTo:'orig-1',text:'終わりました'}));
 assert.equal(ok.status,'submitted',JSON.stringify(ok));assert.equal(f.sent[0].replyTo,'orig-1');
 const [n]=await f.readNonces();
 assert.equal(n.signatureSha256,sha(sign(f.keys.recv,{sender:'chachamaru',keyVersion:1,recipient:DEST,id:'ans-1',replyTo:'orig-1',text:'終わりました',signedAt:isoSeconds(T0),nonce:n.nonce}).signature));
 assert.equal((await botSend(f,unsigned({id:'ans-2',replyTo:'never-sent'}))).status,'invalid_reply');
});
test('the key is read the way every key is: the environment, then the Keychain',async t=>{
 const f=await externalFixture(t);
 const k=fakeKeychain({CHACHAMARU_RECV_KEY:f.keys.recv,CHACHAMARU_SEND_KEY:f.keys.send});delete f.env.CHACHAMARU_RECV_KEY;delete f.env.CHACHAMARU_SEND_KEY;
 const using=f.make({keychain:k.read});
 const r=await botSend(f,unsigned(),using);
 assert.equal(r.status,'submitted',JSON.stringify(r));
 assert.ok(k.asked.includes('CHACHAMARU_RECV_KEY'));assert.ok(!k.asked.includes('CHACHAMARU_WEBHOOK_URL'),'an address is never looked up for signing');
});
test('no key anywhere is key_unavailable: nothing is signed, delivered or recorded; a broken Keychain is the same',async t=>{
 const f=await externalFixture(t);delete f.env.CHACHAMARU_RECV_KEY;
 for(const using of [f.automatic,f.make({keychain:fakeKeychain().read}),f.make({keychain:async()=>{throw new Error('locked');}})]){
  const r=await botSend(f,unsigned(),using);assert.equal(r.status,'key_unavailable',JSON.stringify(r));
 }
 assert.equal(f.writes(),0);assert.equal(await f.noncesWritten(),0);assert.equal(await f.reserved(),0);
});
test('an unregistered name is sender_unregistered before any key is looked up; an unusable roster, a revoked registration and a registration that may not send are refused as they are for send --as',async t=>{
 const f=await externalFixture(t);const k=fakeKeychain({NOBODY_RECV_KEY:'x'});const using=f.make({keychain:k.read});
 assert.equal((await botSend(f,unsigned(),using,'nobody')).status,'sender_unregistered');assert.deepEqual(k.asked,[],'no key was looked up for a name the roster does not have');
 await f.writePeers(peerRecord({scope:[f.work],revoked:{at:'2026-10-09T00:00:00Z'}}));assert.equal((await botSend(f,unsigned())).status,'key_revoked');
 await f.writePeers(peerRecord({scope:[f.work],operations:{read:false,send:false}}));assert.equal((await botSend(f,unsigned())).status,'operation_not_permitted');
 await f.writePeers(peerRecord());assert.equal((await botSend(f,unsigned())).status,'scope_unset');
 await writeFile(f.peersPath,'{not json',{mode:0o600});assert.equal((await botSend(f,unsigned())).status,'peers_unusable');
 await rm(f.peersPath);assert.equal((await botSend(f,unsigned())).status,'sender_unregistered');
 assert.equal(f.writes(),0);
});
test('the same keys that are one value are refused here too, and the diagnostic holds no value',async t=>{
 const f=await externalFixture(t);f.env.CHACHAMARU_SEND_KEY=f.keys.recv;
 const r=await botSend(f,unsigned());assert.equal(r.status,'key_unavailable',JSON.stringify(r));
 assert.deepEqual(f.diagnostics,['keys_not_distinct: chachamaru receiveKeyEnv equals chachamaru sendKeyEnv']);assert.equal(f.writes(),0);
});
test('the request on standard input has exactly four fields; nothing the Bot would sign or choose can be passed in',async t=>{
 const f=await externalFixture(t);
 assert.deepEqual(await botSend(f,'{not json'),{status:'envelope_invalid',reason:'json'});
 assert.deepEqual(await botSend(f,''),{status:'envelope_invalid',reason:'json'});
 for(const extra of [{sender:'second'},{keyVersion:9},{signedAt:'2026-10-09T12:00:00Z'},{nonce:'A'.repeat(22)},{signature:'0'.repeat(64)},{humanApproval:true}]){
  const r=await botSend(f,unsigned(extra));assert.equal(r.status,'envelope_invalid',JSON.stringify(extra));assert.equal(r.reason,'unknown_field',JSON.stringify(extra));
 }
 for(const [label,bad] of [['no recipient',{id:'x',text:'t'}],['no id',{recipient:DEST,text:'t'}],['no text',{recipient:DEST,id:'x'}],['empty text',unsigned({text:''})],['listing recipient',unsigned({recipient:'*'})],['replyTo empty',unsigned({replyTo:''})],['id with a line break',unsigned({id:'a\nb'})],['text a number',unsigned({text:5})],['array',[]],['null',null],['string',JSON.stringify('x')]] as const){
  const r=await botSend(f,bad as unknown);assert.equal(r.status,'envelope_invalid',label+JSON.stringify(r));
 }
 assert.equal(f.writes(),0);assert.equal(await f.noncesWritten(),0);
});
test('the arguments are the command and one registration name; nothing secret can be an argument, read has no bot variant, and the standard input is not touched for a listing',async t=>{
 const f=await externalFixture(t);const never=async()=>{throw new Error('standard input must not be read');};
 for(const args of [['bot-send'],['bot-send','Bad Name'],['bot-send','chachamaru','extra'],['bot-send','--as','chachamaru'],['bot-send','chachamaru','--native'],['bot-sessions'],['bot-sessions','chachamaru','x'],['bot-read','chachamaru'],['bot-read'],['bot-limits','chachamaru'],['bot-status','chachamaru']])
  await assert.rejects(()=>cli(args,never,f.automatic),/invalid_arguments/,args.join(' '));
 const r=await cli(['bot-sessions','chachamaru'],never,f.automatic);assert.equal(r.status,'ok',JSON.stringify(r));
 assert.equal(f.writes(),0);
});
test('bot-sessions lists exactly what sessions --as lists for the same registration, and can be asked again at once',async t=>{
 const a=await externalFixture(t),b=await externalFixture(t);
 const viaBot=await cli(['bot-sessions','chachamaru'],async()=>'',a.automatic);
 const byHand=await cli(['sessions','--as','chachamaru'],async()=>JSON.stringify(b.envelope({recipient:'*',text:'',id:'list-x'})),b.automatic);
 assert.equal(viaBot.status,'ok');assert.deepEqual(anon(a,viaBot),anon(b,byHand));
 assert.deepEqual(viaBot.candidates.map((c:any)=>c.recipient).sort(),['claude:claude-b:42@100','codex:codex-c:owner-1','grok:grok-g:501@2026-10-09T10:00:00Z']);
 // Every listing has its own nonce and id, so a second one is not a replay.
 const again=await cli(['bot-sessions','chachamaru'],async()=>'',a.automatic);assert.equal(again.status,'ok',JSON.stringify(again));
 const [n1,n2]=await a.readNonces();assert.notEqual(n1.nonce,n2.nonce);assert.notEqual(n1.id,n2.id,'nor does a listing reuse a request id');assert.equal(n1.op,'sessions');assert.equal(n1.recipient,'*');
 // What it lists, bot-send accepts.
 assert.equal((await botSend(a,unsigned({recipient:viaBot.candidates[0].recipient,id:'from-listing'}))).status,'submitted');
});
test('the registration decides what bot-send may reach: the folders of its scope, the owner\'s limits, and no read at all',async t=>{
 const f=await externalFixture(t);
 const r=await botSend(f,unsigned({recipient:'claude:claude-out:43@100',id:'out-1'}));assert.equal(r.status,'scope_conflict',JSON.stringify(r));
 await writeFile(f.limitsPath,JSON.stringify({version:1,exclude:[],scope:null,operations:{read:true,send:false}}),{mode:0o600});
 assert.equal((await botSend(f,unsigned({id:'lim-1'}))).status,'operation_not_permitted');
 assert.equal(f.writes(),0);
 // There is no bot-read; the closest, read --as, still refuses.
 assert.equal((await cli(['read','--as','chachamaru'],async()=>'',f.automatic)).status,'operation_not_permitted');
});
test('no key, signature or signed field is printed, stored or passed in an argument',async t=>{
 const f=await externalFixture(t);
 const args=['bot-send','chachamaru'];
 const out=await botSend(f,unsigned({text:'鍵は出ない'}));assert.equal(out.status,'submitted');
 const [n]=await f.readNonces();const signature=sign(f.keys.recv,{sender:'chachamaru',keyVersion:1,recipient:DEST,id:'bs-1',text:'鍵は出ない',signedAt:isoSeconds(T0),nonce:n.nonce}).signature;
 const everything=JSON.stringify([out,n,f.diagnostics,f.sent,await requests(f.reservations)]);
 for(const secret of [...Object.values(f.keys),signature])assert.ok(!everything.includes(secret),'a key or the signature reached an output or a record');
 for(const secret of [...Object.values(f.keys),signature])assert.ok(!args.join(' ').includes(secret));
});

// Signing is reachable from the command line only.
test('neither MCP nor serve nor a call made without the command line can ask for signing',async t=>{
 const f=await externalFixture(t);const {createMcp}=await import('../src/mcp.ts');const {createServe}=await import('../src/serve.ts');
 const handle=createMcp({automatic:f.automatic});
 await handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});await handle({jsonrpc:'2.0',method:'notifications/initialized'});
 for(const name of ['bot-send','bot-sessions','bot_send']){const r:any=await handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name,arguments:unsigned()}});assert.ok(r.error,name+JSON.stringify(r));}
 for(const meta of [{external:{name:'chachamaru',sign:true}},{sign:true},{kind:'cli',external:{name:'chachamaru',sign:true}}]){
  const r:any=await handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'send',arguments:unsigned(),_meta:meta}});assert.ok(r.error||r.result?.isError,JSON.stringify(r));
 }
 const serve=createServe({automatic:f.automatic});
 for(const method of ['bot-send','bot-sessions']){const r=await serve({id:1,method,params:unsigned()});assert.ok(r.error||(r.result as any)?.status!=='submitted'&&(r.result as any)?.status!=='ok',JSON.stringify(r));}
 for(const params of [unsigned(),{...unsigned(),sign:true},{...unsigned(),external:{name:'chachamaru',sign:true}}]){const r=await serve({id:2,method:'send',params});assert.ok(!(r.result as any)||(r.result as any).status!=='submitted',JSON.stringify(r));}
 // The context a caller builds by hand: signing is only for the command line, and unsigned input without it is just an unsigned envelope.
 assert.equal((await f.automatic('send',unsigned(),{kind:'mcp',external:{name:'chachamaru',sign:true}})).status,'compat_check_read_only');
 assert.equal((await f.automatic('send',unsigned(),{kind:'cli',external:{name:'chachamaru'}})).status,'envelope_invalid');
 assert.equal(f.writes(),0);assert.equal(await f.noncesWritten(),0);
 // The signing code is not imported by any entry other than the one that builds the call.
 for(const file of ['mcp.ts','serve.ts','cli.ts'])assert.ok(!/from '\.\/bot-sign/.test(readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8')),file);
 assert.match(readFileSync(new URL('../src/bot-sign.ts',import.meta.url),'utf8'),/MVP/);
});

test('a real CLI process: the unsigned request comes on standard input, the arguments hold only the name, and each run signs with its own nonce',async t=>{
 const home=await realpath(await mkdtemp(join(tmpdir(),'seamless-bot-cli-')));t.after(()=>rm(home,{recursive:true,force:true}));
 const work=join(home,'work');await mkdir(work,{recursive:true});await mkdir(join(home,'.seamless'),{recursive:true,mode:0o700});
 await writeFile(join(home,'.seamless','peers.json'),JSON.stringify({version:1,peers:[peerRecord({scope:[work]})]}),{mode:0o600});
 const recv=randomBytes(32).toString('hex'),send=randomBytes(32).toString('hex');
 const cliPath=fileURLToPath(new URL('../src/cli.ts',import.meta.url));
 const run=(args:string[],stdin:string)=>new Promise<{code:number|null;out:string;err:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,[cliPath,...args],{env:{PATH:process.env.PATH??'',HOME:home,CHACHAMARU_RECV_KEY:recv,CHACHAMARU_SEND_KEY:send,CHACHAMARU_WEBHOOK_URL:'https://bot.invalid/hook'},cwd:dirname(cliPath)});
  let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('exit',code=>resolve({code,out,err}));child.stdin.end(stdin);
 });
 const request=JSON.stringify({recipient:'claude:no-such-conversation:1@1',id:'cli-1',text:'x'});
 // Signature, time and roster pass; the conversation does not exist in this home, so nothing is delivered.
 const first=await run(['bot-send','chachamaru'],request);
 assert.equal(first.code,0,first.err);assert.equal(JSON.parse(first.out).status,'target_offline');
 const second=await run(['bot-send','chachamaru'],request);
 assert.equal(JSON.parse(second.out).status,'target_offline','a new run signs again with a new nonce: it is not a replay');
 const listing=await run(['bot-sessions','chachamaru'],'');assert.equal(JSON.parse(listing.out).status,'ok',listing.out+listing.err);
 for(const secret of [recv,send])for(const text of [first,second,listing])assert.ok(!text.out.includes(secret)&&!text.err.includes(secret));
 const empty=await run(['bot-send','chachamaru'],'{}');assert.equal(JSON.parse(empty.out).status,'envelope_invalid');
 const bad=await run(['bot-send'],request);assert.notEqual(bad.code,0);assert.match(bad.err,/invalid_arguments/);
 await chmod(join(home,'.seamless','peers.json'),0o644);
 const unusable=await run(['bot-send','chachamaru'],request);assert.equal(JSON.parse(unusable.out).status,'peers_unusable');
});
