import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath,writeFile,readFile,readdir,mkdir,chmod,stat,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {runCli} from '../src/cli.ts';
import {signingInput,parseSignedEnvelope,verifySignature,sha256Hex} from '../src/signed-envelope.ts';
import {claimNonce,wasSigned} from '../src/nonce-store.ts';
import {SAME_CONTENT_HOLD_MS} from '../src/external-inbound.ts';
import {externalFixture,peerRecord,secondRecord,sign,isoSeconds,T0} from './support/signed-fixture.ts';
import {fakeKeychain} from './support/keychain-fixture.ts';

// specs/202610-more-peers T2-3: what a registered outside sender (Grok Bot) must do before this Mac delivers its envelope.
async function expectRejected(f:Awaited<ReturnType<typeof externalFixture>>,input:unknown,status:string,name?:string){
 const before=f.writes();
 const r=await f.call('send',input,name);
 assert.equal(r.status,status,JSON.stringify(r));
 assert.equal(f.writes(),before,'nothing was delivered');
 return r;
}

test('the signed string and the signature match an independent HMAC computed outside this code (known-answer vector)',()=>{
 // The expected hex was produced by python3 hmac and by `openssl dgst -sha256 -hmac`, from the nine lines written out by hand.
 const fields={sender:'chachamaru',keyVersion:1,recipient:'claude:11111111-1111-4111-8111-111111111111:42@100',id:'req-1',text:'hello',signedAt:'2026-10-09T12:00:00Z',nonce:'A'.repeat(22)};
 assert.equal(signingInput(fields),['seamless-inbound-v1','chachamaru','1','claude:11111111-1111-4111-8111-111111111111:42@100','req-1','','2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824','2026-10-09T12:00:00Z','A'.repeat(22)].join('\n'));
 const envelope={...fields,signature:'02a0fb553a6108cdc4245e93a0fad8adfd06b2b511dd6ea541e60ad704e59ab6'};
 assert.equal(sign('test-key-not-a-secret',fields).signature,envelope.signature);
 assert.equal(verifySignature('test-key-not-a-secret',envelope),true);
 assert.equal(verifySignature('test-key-not-a-secreT',envelope),false);
 assert.equal(sha256Hex('hello'),'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
 // A replyTo that is present changes the string; an absent one is an empty line.
 assert.equal(signingInput({...fields,replyTo:'orig'}).split('\n')[5],'orig');
});
test('the envelope shape is strict: unknown fields, bad characters and bad times are refused before any key is read',()=>{
 const f=sign('k',{sender:'chachamaru',keyVersion:1,recipient:'claude:a:g',id:'x',text:'t',signedAt:'2026-10-09T12:00:00Z',nonce:'N'.repeat(16)});
 assert.equal(parseSignedEnvelope(f).ok,true);
 const bad:Array<[string,unknown]>=[['unknown field',{...f,extra:1}],['null',null],['array',[]],['sender upper',{...f,sender:'Chachamaru'}],['keyVersion 0',{...f,keyVersion:0}],['keyVersion string',{...f,keyVersion:'1'}],['id with a line break',{...f,id:'a\nb'}],['empty id',{...f,id:''}],['empty replyTo',{...f,replyTo:''}],['null replyTo',{...f,replyTo:null}],
  ['signedAt without Z',{...f,signedAt:'2026-10-09T12:00:00'}],['signedAt with an offset',{...f,signedAt:'2026-10-09T12:00:00+00:00'}],['signedAt with milliseconds',{...f,signedAt:'2026-10-09T12:00:00.000Z'}],['signedAt impossible date',{...f,signedAt:'2026-02-31T12:00:00Z'}],
  ['short nonce',{...f,nonce:'short'}],['nonce with a slash',{...f,nonce:'a/'.repeat(10)}],['signature upper-case',{...f,signature:f.signature.toUpperCase()}],['signature short',{...f,signature:'ab'}],['text over 32768 bytes',{...f,text:'a'.repeat(32769)}],['text not a string',{...f,text:5}]];
 for(const [name,value] of bad)assert.equal(parseSignedEnvelope(value).ok,false,name);
});

test('a correct signature is accepted and delivers once, as a sender named by its registration and key version',async t=>{
 const f=await externalFixture(t);
 const env=f.envelope({text:'ビルドが終わりました'});
 const r=await f.call('send',env);
 assert.equal(r.status,'submitted',JSON.stringify(r));assert.equal(f.writes(),1);
 const e=f.sent[0];
 assert.deepEqual(e.sender,{id:'grok-bot:chachamaru',nativeId:'chachamaru',generation:'1'});
 assert.deepEqual(e.recipient,{id:'claude:claude-b',nativeId:'claude-b',generation:'42@100'});
 assert.equal(e.id,env.id);assert.equal(e.text,'ビルドが終わりました');assert.ok(!('humanApproval' in e));
 // The nonce is on disk with what the check established, and holds neither the signature nor any key.
 const [n]=await f.readNonces();
 assert.equal(n.peer,'chachamaru');assert.equal(n.keyVersion,1);assert.equal(n.nonce,env.nonce);assert.equal(n.id,env.id);assert.equal(n.op,'send');
 const raw=JSON.stringify(n);assert.ok(!raw.includes(env.signature));for(const k of Object.values(f.keys))assert.ok(!raw.includes(k));
 for(const name of await readdir(f.nonces))assert.equal((await stat(join(f.nonces,name))).mode&0o777,0o600,name);
 // Each of the three products can be the destination.
 for(const recipient of ['codex:codex-c:owner-1','grok:grok-g:501@2026-10-09T10:00:00Z'])assert.equal((await f.call('send',f.envelope({recipient}))).status,'submitted',recipient);
 assert.equal(f.writes(),3);
});

// AC5: the five refusals, and the others the plan lists. Each one delivers nothing.
test('no signature at all is refused',async t=>{
 const f=await externalFixture(t);const {signature,...unsigned}=f.envelope();
 await expectRejected(f,unsigned,'envelope_invalid');
});
test('no key on this Mac (variable unset or empty) is refused',async t=>{
 const f=await externalFixture(t);
 delete f.env.CHACHAMARU_RECV_KEY;await expectRejected(f,f.envelope(),'key_unavailable');
 f.env.CHACHAMARU_RECV_KEY='';await expectRejected(f,f.envelope(),'key_unavailable');
});
test('another registration\'s key does not pass, and neither does a key the Bot guessed',async t=>{
 const f=await externalFixture(t);await f.writePeers(peerRecord({scope:[f.work]}),secondRecord({scope:[f.work]}));
 await expectRejected(f,f.envelope({key:f.keys.secondRecv}),'signature_mismatch');
 await expectRejected(f,f.envelope({key:randomBytes(32).toString('hex')}),'signature_mismatch');
 // And the second registration cannot sign as the first by naming it: --as and the envelope must say the same name.
 await expectRejected(f,f.envelope({sender:'second',key:f.keys.secondRecv}),'sender_mismatch','chachamaru');
 // The order of the reasons is kept: a wrong sender is said before what the call needs of the fields (an empty text, a listing shape).
 await expectRejected(f,f.envelope({sender:'second',key:f.keys.secondRecv,text:''}),'sender_mismatch','chachamaru');
 assert.equal((await f.call('sessions',f.envelope({sender:'second',key:f.keys.secondRecv,recipient:'claude:claude-b:42@100'}),'chachamaru')).status,'sender_mismatch');
 assert.equal((await f.call('send',f.envelope({sender:'second',key:f.keys.secondRecv}),'second')).status,'submitted');
});
test('a revoked registration is refused even with a correct signature',async t=>{
 const f=await externalFixture(t);await f.writePeers(peerRecord({scope:[f.work],revoked:{at:'2026-10-09T09:00:00Z'}}));
 await expectRejected(f,f.envelope(),'key_revoked');
});
test('a key version the roster no longer has is refused (key rotation)',async t=>{
 const f=await externalFixture(t);await f.writePeers(peerRecord({scope:[f.work],keyVersion:2}));
 await expectRejected(f,f.envelope({keyVersion:1}),'key_version_mismatch');
 assert.equal((await f.call('send',f.envelope({keyVersion:2}))).status,'submitted');
 assert.equal(f.sent[0].sender.generation,'2');
});
test('the same signature presented again is refused, also after a new process starts',async t=>{
 const f=await externalFixture(t);const env=f.envelope();
 assert.equal((await f.call('send',env)).status,'submitted');
 // The same bytes again after a delivery: refused with the word for a request already done (see the replay words test below).
 await expectRejected(f,env,'duplicate');
 f.advance(60_000);await expectRejected(f,env,'duplicate');
 // A new automatic instance reads the same disk: nothing was kept in memory.
 await expectRejected(f,env,'duplicate','chachamaru');
 const fresh=f.make();assert.equal((await f.call('send',env,'chachamaru',fresh)).status,'duplicate');assert.equal(f.writes(),1);
 // A different envelope that reuses the nonce is a replay as well, even though its own signature is good.
 await expectRejected(f,f.envelope({nonce:env.nonce,id:'another'}),'nonce_replayed');
 // The nonce belongs to a registration: another registration may use the same text.
 await f.writePeers(peerRecord({scope:[f.work]}),secondRecord({scope:[f.work]}));
 assert.equal((await f.call('send',f.envelope({sender:'second',key:f.keys.secondRecv,nonce:env.nonce}),'second')).status,'submitted');
});
test('a destination swapped after signing is refused: the signed destination is the only destination',async t=>{
 const f=await externalFixture(t);
 const signedForB=f.envelope({recipient:'claude:claude-b:42@100'});
 await expectRejected(f,{...signedForB,recipient:'codex:codex-c:owner-1'},'signature_mismatch');
 await expectRejected(f,{...signedForB,recipient:'claude:claude-out:43@100'},'signature_mismatch');
 // The same swap inside the destination string: another generation of the same conversation.
 await expectRejected(f,{...signedForB,recipient:'claude:claude-b:42@101'},'signature_mismatch');
 // The destination signed in the first place must still be the live one: a stale generation is not delivered.
 await expectRejected(f,f.envelope({recipient:'claude:claude-b:42@101'}),'generation_mismatch');
});
test('every signed field matters: changing any one after signing is refused',async t=>{
 const f=await externalFixture(t);
 const base=f.envelope({replyTo:'earlier'});
 const changed:Array<[string,Record<string,unknown>]>=[['text',{text:'hello!'}],['id',{id:'other'}],['replyTo',{replyTo:'later'}],['replyTo removed',{replyTo:undefined}],['nonce',{nonce:randomBytes(16).toString('base64url')}],['signedAt',{signedAt:isoSeconds(f.now()+1000)}],['keyVersion',{keyVersion:2}]];
 for(const [name,change] of changed){
  const tampered={...base,...change};
  if(change.keyVersion===2)await f.writePeers(peerRecord({scope:[f.work],keyVersion:2}));
  assert.equal((await f.call('send',tampered)).status,'signature_mismatch',name);
 }
 assert.equal(f.writes(),0);
});
test('a sender that is not in the roster is refused: no roster, an empty roster, and another name',async t=>{
 const f=await externalFixture(t);
 await expectRejected(f,f.envelope({sender:'ghost',key:f.keys.recv}),'sender_unregistered','ghost');
 await rm(f.peersPath);await expectRejected(f,f.envelope(),'sender_unregistered');
 await f.writePeers();await expectRejected(f,f.envelope(),'sender_unregistered');
});
test('a broken roster (or one that is not private) refuses everything',async t=>{
 const f=await externalFixture(t);
 await writeFile(f.peersPath,'{broken',{mode:0o600});await expectRejected(f,f.envelope(),'peers_unusable');
 await f.writePeers(peerRecord({scope:[f.work]}));await chmod(f.peersPath,0o644);await expectRejected(f,f.envelope(),'peers_unusable');
});
test('an envelope signed with the SEND key (the Mac to Bot key) is refused: the two keys are not interchangeable',async t=>{
 const f=await externalFixture(t);
 await expectRejected(f,f.envelope({key:f.keys.send}),'signature_mismatch');
 // Even if the owner put one value in both variables, the receive key is not accepted as the send key's twin. The Bot is told only
 // that no usable key exists; which variables collide is for the owner (the diagnostic line), and it holds names, never values.
 f.env.CHACHAMARU_SEND_KEY=f.keys.recv;
 await expectRejected(f,f.envelope(),'key_unavailable');
 assert.deepEqual(f.diagnostics,['keys_not_distinct: chachamaru receiveKeyEnv equals chachamaru sendKeyEnv']);
});
test('a time more than five minutes ahead or behind this Mac\'s clock is refused; five minutes either way is the edge that passes',async t=>{
 const f=await externalFixture(t);
 await expectRejected(f,f.envelope({signedAt:isoSeconds(f.now()+6*60_000)}),'timestamp_out_of_window');
 await expectRejected(f,f.envelope({signedAt:isoSeconds(f.now()-6*60_000)}),'timestamp_out_of_window');
 await expectRejected(f,f.envelope({signedAt:isoSeconds(f.now()+5*60_000+1000)}),'timestamp_out_of_window');
 await expectRejected(f,f.envelope({signedAt:isoSeconds(f.now()-5*60_000-1000)}),'timestamp_out_of_window');
 assert.equal((await f.call('send',f.envelope({signedAt:isoSeconds(f.now()+5*60_000)}))).status,'submitted');
 assert.equal((await f.call('send',f.envelope({signedAt:isoSeconds(f.now()-5*60_000)}))).status,'submitted');
 assert.equal((await f.call('send',f.envelope({signedAt:isoSeconds(f.now()+4*60_000)}))).status,'submitted');
 // A refused time consumes no nonce: the Bot signs again with the same nonce once its clock is right.
 const late=f.envelope({signedAt:isoSeconds(f.now()-6*60_000)});
 await expectRejected(f,late,'timestamp_out_of_window');
 assert.equal((await f.call('send',f.envelope({nonce:late.nonce}))).status,'submitted');
});
test('two envelopes presented at the same moment: one is delivered, the other refused (one process and two processes)',async t=>{
 const f=await externalFixture(t);
 const env=f.envelope();
 const results=await Promise.all([f.call('send',env),f.call('send',env)]);
 assert.equal(results.filter(r=>r.status==='submitted').length,1,JSON.stringify(results));
 const other=results.find(r=>r.status!=='submitted')!;assert.ok(['nonce_replayed','duplicate_of_unknown','duplicate'].includes(other.status),JSON.stringify(other));
 assert.equal(f.writes(),1);assert.equal(await f.noncesWritten(),1);
 // Eight at once through separate automatic instances (separate in-memory state, one disk).
 const many=f.envelope();
 const eight=await Promise.all(Array.from({length:8},()=>f.call('send',many,'chachamaru',f.make())));
 assert.equal(eight.filter(r=>r.status==='submitted').length,1,JSON.stringify(eight));assert.equal(f.writes(),2);
});

// AC7 for the signed route: a lost answer never turns into a second write, whether the Bot sends the same bytes, signs the
// same request again, or sends the same content under another id.
test('after a write whose result was lost, the same envelope, the same request signed again and the same content under another id all stop at duplicate (writes stay 1)',async t=>{
 const f=await externalFixture(t,{outcome:'unknown'});
 const env=f.envelope({id:'lost-1',text:'まだ届いたか分からない'});
 assert.equal((await f.call('send',env)).status,'unknown');assert.equal(f.writes(),1);
 // 1. the same bytes
 const same=await f.call('send',env);assert.equal(same.status,'duplicate_of_unknown');assert.equal(same.requestId,'lost-1');
 // 2. the same request id, signed again (new nonce, new time)
 f.advance(30_000);
 const again=await f.call('send',f.envelope({id:'lost-1',text:'まだ届いたか分からない'}));assert.equal(again.status,'duplicate_of_unknown');
 // 3. the same content under another id
 const other=await f.call('send',f.envelope({id:'lost-2',text:'まだ届いたか分からない'}));assert.equal(other.status,'duplicate_of_unknown');assert.equal(other.requestId,'lost-1');
 assert.equal(f.writes(),1);assert.equal(await f.reserved(),1);
 // The same id with other content is a conflict, not a delivery.
 assert.equal((await f.call('send',f.envelope({id:'lost-1',text:'別の本文'}))).status,'id_conflict');assert.equal(f.writes(),1);
 // A restart does not change it.
 assert.equal((await f.call('send',f.envelope({id:'lost-1',text:'まだ届いたか分からない'}),'chachamaru',f.make())).status,'duplicate_of_unknown');assert.equal(f.writes(),1);
});
test('a connection cut right after the write is the same: the result stays unknown and no later attempt writes again',async t=>{
 const f=await externalFixture(t,{outcome:'cut'});
 const env=f.envelope({id:'cut-1',text:'書いた直後に切れた'});
 assert.equal((await f.call('send',env)).status,'unknown');assert.equal(f.writes(),1);
 assert.equal((await f.call('send',env)).status,'duplicate_of_unknown');
 assert.equal((await f.call('send',f.envelope({id:'cut-1',text:'書いた直後に切れた'}))).status,'duplicate_of_unknown');
 assert.equal((await f.call('send',f.envelope({id:'cut-2',text:'書いた直後に切れた'}))).status,'duplicate_of_unknown');
 assert.equal(f.writes(),1);
});
test('after a delivery that was confirmed, the same bytes and the same request signed again are both a duplicate that says what happened (writes stay 1)',async t=>{
 const f=await externalFixture(t);
 const env=f.envelope({id:'done-1'});
 assert.equal((await f.call('send',env)).status,'submitted');
 const same=await f.call('send',env);
 assert.equal(same.status,'duplicate');assert.equal(same.requestId,'done-1');assert.equal(same.previous,'submitted');
 const again=await f.call('send',f.envelope({id:'done-1',text:env.text}));
 assert.equal(again.status,'duplicate');assert.equal(again.requestId,'done-1');assert.equal(again.previous,'submitted');
 assert.equal(f.writes(),1);
});
test('a write that fails before anything is written (the roster changed in between) leaves the request id free for another try',async t=>{
 const f=await externalFixture(t);
 f.beforeWrite(async()=>{await f.writePeers(peerRecord({scope:[f.work],revoked:{at:'2026-10-09T12:00:00Z'}}));});
 const first=await f.call('send',f.envelope({id:'late-revoke'}));
 assert.equal(first.status,'key_revoked');assert.equal(f.writes(),0);assert.equal(await f.reserved(),0);
 f.beforeWrite(async()=>{});await f.writePeers(peerRecord({scope:[f.work]}));
 assert.equal((await f.call('send',f.envelope({id:'late-revoke'}))).status,'submitted');assert.equal(f.writes(),1);
});
test('the roster, the limits and the destination are looked at again just before the write',async t=>{
 const f=await externalFixture(t);
 const attempt=async(id:string,change:()=>Promise<void>)=>{f.beforeWrite(change);const r=await f.call('send',f.envelope({id}));f.beforeWrite(async()=>{});return r;};
 assert.equal((await attempt('r1',async()=>{await f.writePeers(peerRecord({scope:[f.other]}));})).status,'scope_conflict');
 await f.writePeers(peerRecord({scope:[f.work]}));
 assert.equal((await attempt('r2',async()=>{await f.writePeers(peerRecord({scope:[f.work],operations:{read:false,send:false}}));})).status,'operation_not_permitted');
 await f.writePeers(peerRecord({scope:[f.work]}));
 assert.equal((await attempt('r3',async()=>{await writeFile(f.limitsPath,JSON.stringify({version:1,exclude:[{provider:'claude',nativeId:'claude-b'}],scope:null,operations:null}),{mode:0o600});})).status,'target_excluded');
 await rm(f.limitsPath);
 assert.equal((await attempt('r4',async()=>{f.targets[0].generation='42@999';})).status,'generation_mismatch');
 f.targets[0].generation='42@100';
 assert.equal((await attempt('r5',async()=>{f.targets[0].cwd=f.other;})).status,'scope_conflict');
 f.targets[0].cwd=f.work;
 assert.equal(f.writes(),0);
 assert.equal((await f.call('send',f.envelope({id:'r6'}))).status,'submitted');
});

test('nonces are kept 24 hours and then dropped; a record from a refused request does not outlive that either',async t=>{
 const f=await externalFixture(t);
 const env=f.envelope();
 assert.equal((await f.call('send',env)).status,'submitted');
 // A fresh signature on the same nonce, 23 hours later, still finds it.
 f.advance(23*3600_000);
 await expectRejected(f,f.envelope({nonce:env.nonce}),'nonce_replayed');
 // 25 hours after the first use the record is gone and the nonce is free again.
 f.advance(2*3600_000);
 assert.equal((await f.call('send',f.envelope({nonce:env.nonce}))).status,'submitted');
 assert.equal(await f.noncesWritten(),1);
});

// The command line: --as NAME, the signed request on standard input, nothing secret in the arguments.
test('send --as reads the signed envelope from standard input and prints the result; the arguments hold only the name',async t=>{
 const f=await externalFixture(t);const env=f.envelope({text:'標準入力から'});
 let output='';const log=console.log;console.log=(v:unknown)=>{output+=String(v);};
 const args=['send','--as','chachamaru'];
 try{await runCli(args,f.automatic,undefined,async()=>JSON.stringify(env));}finally{console.log=log;}
 assert.equal(JSON.parse(output).status,'submitted');assert.equal(f.sent[0].text,'標準入力から');
 const joined=args.join(' ');assert.ok(!joined.includes(env.signature)&&!joined.includes(env.nonce)&&!joined.includes(f.keys.recv));
});
test('--as takes exactly one registration name and nothing else; invalid JSON on standard input is reported, not thrown',async t=>{
 const f=await externalFixture(t);
 const run=async(args:string[],stdin='')=>{let output='';const log=console.log;console.log=(v:unknown)=>{output+=String(v);};try{await runCli(args,f.automatic,undefined,async()=>stdin);}finally{console.log=log;}return output?JSON.parse(output):null;};
 for(const args of [['send','--as'],['send','--as','Bad Name'],['send','--as','a','b'],['send','x','--as','a'],['limits','--as','a'],['band','--as','a'],['send','--as','a','--native'],['send','--as','chachamaru','--caller','x'],['status','--as','a']])await assert.rejects(()=>run(args),/invalid_arguments/,args.join(' '));
 assert.deepEqual(await run(['send','--as','chachamaru'],'{not json'),{status:'envelope_invalid',reason:'json'});
 assert.deepEqual(await run(['send','--as','chachamaru'],''),{status:'envelope_invalid',reason:'json'});
 assert.equal((await run(['read','--as','chachamaru'])).status,'operation_not_permitted');
 assert.equal(f.writes(),0);
});
test('a real CLI process: the envelope comes on standard input, the nonce survives the process, and no real conversation is reached',async t=>{
 const home=await realpath(await mkdtemp(join(tmpdir(),'seamless-ext-cli-')));t.after(()=>rm(home,{recursive:true,force:true}));
 const work=join(home,'work');await mkdir(work,{recursive:true});await mkdir(join(home,'.seamless'),{recursive:true,mode:0o700});
 await writeFile(join(home,'.seamless','peers.json'),JSON.stringify({version:1,peers:[peerRecord({scope:[work]})]}),{mode:0o600});
 const recv=randomBytes(32).toString('hex'),send=randomBytes(32).toString('hex');
 const env=sign(recv,{sender:'chachamaru',keyVersion:1,recipient:'claude:no-such-conversation:1@1',id:'cli-1',text:'x',signedAt:isoSeconds(Date.now()),nonce:randomBytes(16).toString('base64url')});
 const cli=fileURLToPath(new URL('../src/cli.ts',import.meta.url));
 const run=(stdin:string,extra:Record<string,string>={})=>new Promise<{code:number|null;out:string;err:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,[cli,'send','--as','chachamaru'],{env:{PATH:process.env.PATH??'',HOME:home,CHACHAMARU_RECV_KEY:recv,CHACHAMARU_SEND_KEY:send,CHACHAMARU_WEBHOOK_URL:'https://bot.invalid/hook',...extra},cwd:dirname(cli)});
  let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('exit',code=>resolve({code,out,err}));child.stdin.end(stdin);
 });
 // Signature, time and roster pass; the conversation does not exist in this home, so nothing is delivered.
 const first=await run(JSON.stringify(env));
 assert.equal(first.code,0,first.err);assert.equal(JSON.parse(first.out).status,'target_offline');
 // The nonce was written by that process; another process finds it.
 const second=await run(JSON.stringify(env));
 assert.equal(JSON.parse(second.out).status,'nonce_replayed');
 // Neither run printed a key or the signature.
 for(const secret of [recv,send,env.signature])assert.ok(!first.out.includes(secret)&&!first.err.includes(secret)&&!second.out.includes(secret)&&!second.err.includes(secret));
 // Two processes started together with one envelope: the nonce file is made by one of them only.
 const twin=sign(recv,{...env,nonce:randomBytes(16).toString('base64url'),id:'cli-twin'});
 const pair=await Promise.all([run(JSON.stringify(twin)),run(JSON.stringify(twin))]);
 assert.deepEqual(pair.map(x=>JSON.parse(x.out).status).sort((a,b)=>a.localeCompare(b)),['nonce_replayed','target_offline']);
 // Under another key the same kind of envelope is refused. (A missing key would send this process to the real Keychain, which the
 // command line reads by design and a test must not: "no key" is tested in the process with an injected reader, below and in the other tests.)
 const third=await run(JSON.stringify(sign(recv,{...env,nonce:randomBytes(16).toString('base64url'),id:'cli-2'})),{CHACHAMARU_RECV_KEY:randomBytes(32).toString('hex')});
 assert.equal(JSON.parse(third.out).status,'signature_mismatch');
});

// Listing destinations with the same signature, and reading, which is never offered.
test('sessions --as: a signed listing shows only live conversations in the registration\'s folders, as destinations a send can use',async t=>{
 const f=await externalFixture(t);
 const listing=(over:Record<string,unknown>={})=>f.envelope({recipient:'*',text:'',id:`list-${randomBytes(3).toString('hex')}`,...over});
 const r=await f.call('sessions',listing());
 assert.equal(r.status,'ok');assert.deepEqual(r.sender,{id:'grok-bot:chachamaru',keyVersion:1});
 assert.deepEqual(r.candidates.map((c:any)=>c.recipient).sort(),['claude:claude-b:42@100','codex:codex-c:owner-1','grok:grok-g:501@2026-10-09T10:00:00Z']);
 assert.ok(r.candidates.every((c:any)=>c.cwd===f.work));assert.ok(!JSON.stringify(r).includes('claude-out'),'a conversation outside the folders is not listed');
 // What it lists, a send accepts.
 assert.equal((await f.call('send',f.envelope({recipient:r.candidates[0].recipient}))).status,'submitted');
 // A conversation that is not running is not a destination.
 f.targets[1].status='offline';
 assert.ok(!(await f.call('sessions',listing())).candidates.some((c:any)=>c.nativeId==='codex-c'));
 // Nothing in a listing carries a body, an address or a key.
 const raw=JSON.stringify(r);for(const k of [...Object.values(f.keys),'bot.invalid'])assert.ok(!raw.includes(k));
});
test('sessions --as needs the same proof as send: unsigned, replayed, a send envelope used as a listing and a listing used as a send are all refused',async t=>{
 const f=await externalFixture(t);
 const list=f.envelope({recipient:'*',text:'',id:'list-1'});
 assert.equal((await f.call('sessions',list)).status,'ok');
 assert.equal((await f.call('sessions',list)).status,'nonce_replayed');
 const {signature,...unsigned}=f.envelope({recipient:'*',text:'',id:'list-2'});
 assert.equal((await f.call('sessions',unsigned)).status,'envelope_invalid');
 assert.equal((await f.call('sessions',f.envelope({recipient:'*',text:'',id:'list-3',key:f.keys.send}))).status,'signature_mismatch');
 assert.equal((await f.call('sessions',f.envelope())).status,'envelope_invalid');                       // a send envelope
 assert.equal((await f.call('sessions',f.envelope({recipient:'*',text:'',replyTo:'x'}))).status,'envelope_invalid');
 assert.equal((await f.call('send',f.envelope({recipient:'*',text:'x'}))).status,'envelope_invalid');   // a listing as a send
 assert.equal((await f.call('send',f.envelope({recipient:'claude:claude-b:42@100',text:''}))).status,'envelope_invalid');
 assert.equal(f.writes(),0);
});
test('read --as is refused for a registration that is fully set up: reading a Mac conversation is never offered to an outside sender',async t=>{
 const f=await externalFixture(t);
 for(const input of [null,{},f.envelope({recipient:'*',text:''}),{target:'claude:claude-b'}]){
  const r=await f.call('read',input);assert.equal(r.status,'operation_not_permitted');assert.equal(r.reason,'external_read');
 }
 assert.equal(await f.noncesWritten(),0);
});

// What the recipient sees: verified only when this Mac holds the record of the signature check.
test('the recipient sees the Bot\'s envelope as verified only when the signature check was recorded for that request; a copy it could not have verified stays declared',async t=>{
 const f=await externalFixture(t);
 assert.equal((await f.call('send',f.envelope({id:'seen-1',text:'本物'}))).status,'submitted');
 const delivered=f.sent[0];
 const asReceived=(e:typeof delivered,over:Record<string,unknown>={})=>({id:e.id,sender:e.sender,recipient:e.recipient,at:new Date(f.now()).toISOString(),...over});
 const claudeB={provider:'claude' as const,nativeId:'claude-b',generation:'42@100',cwd:f.work,socket:'unused',source:'claude-ancestor' as const};
 const inbound=async(received:unknown[])=>{
  const mac=f.make({caller:async()=>({status:'ok',caller:claudeB}),adapter:{...f.adapter,received:async()=>received}});
  return (await mac('sessions',{peek:true})).inbound as Array<{id:string;sender:string;from:{id:string}}>;
 };
 const senders=async(received:unknown[])=>Object.fromEntries((await inbound(received)).map(i=>[i.id,i.sender]));
 assert.deepEqual(await senders([asReceived(delivered)]),{'seen-1':'verified'});
 // Forgeries: an id that was never checked, the right id with another key version, another registration's name, another destination.
 const forged=[asReceived(delivered,{id:'never-checked'}),asReceived({...delivered,id:'seen-1'},{sender:{...delivered.sender,generation:'2'}}),asReceived({...delivered},{sender:{id:'grok-bot:second',nativeId:'second',generation:'1'}}),asReceived({...delivered},{recipient:{...delivered.recipient,generation:'42@7'}})];
 assert.equal((await inbound([forged[3]])).length,0,'a copy addressed to another generation is not this conversation\'s inbound at all');
 for(const e of forged.slice(0,3)){assert.equal((await senders([e]))[e.id],'declared',JSON.stringify(e.sender)+e.id);}
 // The record names the destination that was checked. The same request id shown to another conversation, or a sender spelled as a
 // local conversation of the same name, is not vouched for.
 const codexC={provider:'codex' as const,nativeId:'codex-c',generation:'owner-1',cwd:f.work,socket:'unused',source:'codex-turn-metadata' as const};
 const asCodex=await f.make({caller:async()=>({status:'ok',caller:codexC}),adapter:{...f.adapter,received:async()=>[asReceived(delivered,{recipient:{id:'codex:codex-c',nativeId:'codex-c',generation:'owner-1'}})]}})('sessions',{peek:true});
 assert.deepEqual(asCodex.inbound.map((i:any)=>[i.id,i.sender]),[['seen-1','declared']]);
 const lookalike=asReceived(delivered,{sender:{id:'claude:chachamaru',nativeId:'chachamaru',generation:'1'}});
 assert.equal((await senders([lookalike]))['seen-1'],'declared');
 // A request refused after its signature passed (here: out of the registration's scope) spends the nonce but never reaches the write, so
 // a copy of it in a transcript is not vouched for.
 await f.writePeers(peerRecord({scope:[f.other]}));
 assert.equal((await f.call('send',f.envelope({id:'refused-1',text:'届かなかった'}))).status,'scope_conflict');
 await f.writePeers(peerRecord({scope:[f.work]}));
 assert.equal((await f.readNonces()).filter(n=>n.id==='refused-1').length,1,'the nonce of the refused request is on disk');
 assert.equal((await senders([asReceived(delivered,{id:'refused-1'})]))['refused-1'],'declared');
 // A delivery the native side refused is on record as rejected: nothing arrived, so a copy is not vouched for.
 f.setOutcome('rejected');
 assert.equal((await f.call('send',f.envelope({id:'native-refused',text:'断られた'}))).status,'rejected');
 f.setOutcome('submitted');
 assert.equal((await senders([asReceived(delivered,{id:'native-refused'})]))['native-refused'],'declared');
 // Each record is needed on its own: without the reservation, or without the nonce record, the real delivery is declared too.
 const {rename}=await import('node:fs/promises');
 const held=join(f.home,'held-reservations');await rename(f.reservations,held);
 assert.deepEqual(await senders([asReceived(delivered)]),{'seen-1':'declared'});
 await rename(held,f.reservations);
 assert.deepEqual(await senders([asReceived(delivered)]),{'seen-1':'verified'});
 await rm(f.nonces,{recursive:true});
 assert.deepEqual(await senders([asReceived(delivered)]),{'seen-1':'declared'});
});

// The outside-sender path is reachable from the command line only.
test('neither MCP nor serve can reach the outside-sender path, whatever the request says',async t=>{
 const f=await externalFixture(t);const {createMcp}=await import('../src/mcp.ts');const {createServe}=await import('../src/serve.ts');
 const handle=createMcp({automatic:f.automatic});
 await handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});await handle({jsonrpc:'2.0',method:'notifications/initialized'});
 const env=f.envelope();
 for(const meta of [undefined,{external:{name:'chachamaru'}},{kind:'cli',external:{name:'chachamaru'}}]){
  const r:any=await handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'send',arguments:env,_meta:meta}});
  assert.ok(r.error||r.result?.isError,JSON.stringify(r));
 }
 const r2:any=await handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'sessions',arguments:{external:{name:'chachamaru'}}}});
 assert.ok(r2.error||r2.result?.isError);
 const serve=createServe({automatic:f.automatic});
 for(const params of [env,{...env,external:{name:'chachamaru'}}]){const r=await serve({id:1,method:'send',params});assert.ok(!(r.result as any)||(r.result as any).status!=='submitted',JSON.stringify(r));}
 assert.equal(f.writes(),0);assert.equal(await f.noncesWritten(),0);
});
test('only sessions, read and send exist for an outside sender; any other method is unknown',async t=>{
 const f=await externalFixture(t);
 for(const method of ['band','select','revalidate','limits'])await assert.rejects(()=>f.call(method,{}),/unknown_method/,method);
});
test('strict version checking applies to what an outside sender can list and send to',async t=>{
 const f=await externalFixture(t);
 await writeFile(f.limitsPath,JSON.stringify({version:1,exclude:[],scope:null,operations:null,strictVersions:true}),{mode:0o600});
 // claude-b has a recorded version; codex-c and grok-g have none, which strict mode refuses.
 const list=await f.call('sessions',f.envelope({recipient:'*',text:'',id:'l1'}));
 assert.equal(list.status,'ok');assert.ok(list.candidates.every((c:any)=>c.provider==='claude'),JSON.stringify(list.candidates.map((c:any)=>c.id)));
 const refused=await f.call('send',f.envelope({recipient:'codex:codex-c:owner-1'}));
 assert.equal(refused.status,'unsupported_version');assert.equal(f.writes(),0);
 await rm(f.limitsPath);
 assert.equal((await f.call('send',f.envelope({recipient:'codex:codex-c:owner-1',id:'after-strict'}))).status,'submitted');
});
test('a Grok CLI destination takes at most 8,000 characters and nothing is reserved for a longer one',async t=>{
 const f=await externalFixture(t);
 const recipient='grok:grok-g:501@2026-10-09T10:00:00Z';
 assert.equal((await f.call('send',f.envelope({recipient,text:'あ'.repeat(8001),id:'too-long'}))).status,'text_too_long');
 assert.equal(await f.reserved(),0);assert.equal(f.writes(),0);
 assert.equal((await f.call('send',f.envelope({recipient,text:'あ'.repeat(8000),id:'just-fits'}))).status,'submitted');
});

// Review fixes, round 1 (specs/202610-more-peers T2-3/T2-4). Each test names the finding it closes.

// AC7: a request the Mac already delivered is remembered by its content, not only by its id, so a Bot that lost the answer and
// signs the same thing again under a new id does not make the conversation receive it twice.
test('after a confirmed delivery, the same content under another id is a duplicate for a day; other content, another destination or another replyTo is a new request',async t=>{
 const f=await externalFixture(t);
 assert.equal((await f.call('send',f.envelope({id:'a-1',text:'deploy now'}))).status,'submitted');
 f.advance(60_000);
 const second=await f.call('send',f.envelope({id:'a-2',text:'deploy now'}));
 assert.equal(second.status,'duplicate',JSON.stringify(second));assert.equal(second.requestId,'a-1');assert.equal(second.previous,'submitted');
 assert.equal(f.writes(),1);assert.equal(await f.reserved(),1,'the duplicate reserved nothing');
 // The same content signed once more with yet another id, and from a fresh process: still the same answer.
 assert.equal((await f.call('send',f.envelope({id:'a-3',text:'deploy now'}),'chachamaru',f.make())).status,'duplicate');
 assert.equal(f.writes(),1);
 // What differs is a new request.
 assert.equal((await f.call('send',f.envelope({id:'b-1',text:'deploy later'}))).status,'submitted');
 assert.equal((await f.call('send',f.envelope({id:'b-2',text:'deploy now',recipient:'codex:codex-c:owner-1'}))).status,'submitted');
 await requestToBotFor(f);
 assert.equal((await f.call('send',f.envelope({id:'b-3',text:'deploy now',replyTo:'ask-1'}))).status,'submitted');
 assert.equal(f.writes(),4);
 // The claim lasts SAME_CONTENT_HOLD_MS (a day: the horizon of a claim whose result is unknown), then the content is free again.
 f.advance(SAME_CONTENT_HOLD_MS-60_000-1000);
 assert.equal((await f.call('send',f.envelope({id:'a-4',text:'deploy now'}))).status,'duplicate');
 f.advance(5000);
 assert.equal((await f.call('send',f.envelope({id:'a-5',text:'deploy now'}))).status,'submitted');
 assert.equal(f.writes(),5);
});
async function requestToBotFor(f:Awaited<ReturnType<typeof externalFixture>>){
 const {requestToBot}=await import('./support/signed-fixture.ts');
 await requestToBot(f.reservations,{id:'ask-1',from:{provider:'claude',nativeId:'claude-b',generation:'42@100',cwd:f.work}});
}
test('a delivery the native side refused does not hold the content: the same content under another id is delivered',async t=>{
 const f=await externalFixture(t,{outcome:'rejected'});
 assert.equal((await f.call('send',f.envelope({id:'r-1',text:'もう一度'}))).status,'rejected');
 f.setOutcome('submitted');
 assert.equal((await f.call('send',f.envelope({id:'r-2',text:'もう一度'}))).status,'submitted');assert.equal(f.writes(),1);
 assert.equal((await f.call('send',f.envelope({id:'r-3',text:'もう一度'}))).status,'duplicate');
});

// T2-3 "duplicate": the same bytes presented again say what became of the first presentation.
test('the same bytes presented again: duplicate with what happened when a request exists, nonce_replayed when nothing was ever reserved',async t=>{
 const f=await externalFixture(t);
 // Delivered: duplicate, previous submitted.
 const done=f.envelope({id:'w-done'});assert.equal((await f.call('send',done)).status,'submitted');
 assert.deepEqual(await f.call('send',done),{status:'duplicate',requestId:'w-done',previous:'submitted'});
 // Refused by the native side: duplicate, previous rejected.
 f.setOutcome('rejected');
 const refused=f.envelope({id:'w-rej',text:'断られる'});assert.equal((await f.call('send',refused)).status,'rejected');
 assert.deepEqual(await f.call('send',refused),{status:'duplicate',requestId:'w-rej',previous:'rejected'});
 f.setOutcome('unknown');
 const lost=f.envelope({id:'w-lost',text:'分からない'});assert.equal((await f.call('send',lost)).status,'unknown');
 assert.deepEqual(await f.call('send',lost),{status:'duplicate_of_unknown',requestId:'w-lost'});
 f.setOutcome('submitted');
 // Refused after the signature passed, before any reservation (the conversation is not running): only the nonce was spent.
 const offline=f.envelope({id:'w-off',recipient:'claude:nobody:1@1'});
 assert.equal((await f.call('send',offline)).status,'target_offline');
 assert.equal((await f.call('send',offline)).status,'nonce_replayed');
 // The id was used for other content: this envelope's content was never delivered, so its bytes are a plain replay.
 assert.equal((await f.call('send',f.envelope({id:'w-done',text:'同じ ID で別の本文'}))).status,'id_conflict');
 const conflicting=f.envelope({id:'w-done',text:'同じ ID で別の本文 2'});
 assert.equal((await f.call('send',conflicting)).status,'id_conflict');
 assert.equal((await f.call('send',conflicting)).status,'nonce_replayed');
 // A listing has no request to be a duplicate of.
 const list=f.envelope({recipient:'*',text:'',id:'w-list'});await f.call('sessions',list);
 assert.equal((await f.call('sessions',list)).status,'nonce_replayed');
 assert.equal(f.writes(),2);
});

// A nonce record that is gone (24 hours passed, or the clock was set forward and back) leaves the reservation as the second lock.
test('with the nonce records gone, a delivered envelope presented again is still stopped by its reservation (writes stay 1)',async t=>{
 const f=await externalFixture(t);const env=f.envelope({id:'again-1'});
 assert.equal((await f.call('send',env)).status,'submitted');
 await rm(f.nonces,{recursive:true});
 const r=await f.call('send',env);assert.equal(r.status,'duplicate');assert.equal(r.previous,'submitted');assert.equal(f.writes(),1);
 // The clock set a day and more forward lets the sweep drop the record; back again, the same envelope still delivers nothing.
 const other=f.envelope({id:'again-2',text:'別'});assert.equal((await f.call('send',other)).status,'submitted');
 const at=f.now();f.setNow(at+25*3600_000);await f.call('send',f.envelope({id:'again-3',text:'さらに別',signedAt:isoSeconds(at+25*3600_000)}));
 f.setNow(at);
 assert.equal((await f.call('send',other)).status,'duplicate');assert.equal(f.writes(),3);
});

// Two keys that hold one value cannot tell which holder signed. The Bot is told only "no usable key"; the owner reads the reason.
test('a key value that equals another key anywhere in the roster is not used to verify, whichever registration or role holds the twin',async t=>{
 const f=await externalFixture(t);await f.writePeers(peerRecord({scope:[f.work]}),secondRecord({scope:[f.work]}));
 // Control: both registrations deliver with their own distinct keys, and the owner hears nothing.
 assert.equal((await f.call('send',f.envelope())).status,'submitted');
 assert.equal((await f.call('send',f.envelope({sender:'second',key:f.keys.secondRecv}),'second')).status,'submitted');
 assert.deepEqual(f.diagnostics,[]);
 // [what the owner mis-set, who signs as whom with which value, the twin the owner is told about]
 type Case=[string,()=>void,'chachamaru'|'second',()=>string,string];
 const cases:Case[]=[
  ['the second registration\'s receive key holds the first one\'s receive key (the first signs)',()=>{f.env.SECOND_RECV_KEY=f.keys.recv;},'chachamaru',()=>f.keys.recv,'second receiveKeyEnv'],
  ['the second registration\'s receive key holds the first one\'s receive key (the second signs)',()=>{f.env.SECOND_RECV_KEY=f.keys.recv;},'second',()=>f.keys.recv,'chachamaru receiveKeyEnv'],
  ['the second registration\'s receive key holds the first one\'s send key',()=>{f.env.SECOND_RECV_KEY=f.keys.send;},'second',()=>f.keys.send,'chachamaru sendKeyEnv'],
  ['the second registration\'s send key holds the first one\'s receive key',()=>{f.env.SECOND_SEND_KEY=f.keys.recv;},'chachamaru',()=>f.keys.recv,'second sendKeyEnv'],
  ['the first registration\'s send key holds its own receive key',()=>{f.env.CHACHAMARU_SEND_KEY=f.keys.recv;},'chachamaru',()=>f.keys.recv,'chachamaru sendKeyEnv'],
  // The send key is sent with one "Bearer " taken off, so "Bearer K" is the key K (2026-10-09 判定役の指摘 1).
  ['the first registration\'s send key holds "Bearer " and its own receive key',()=>{f.env.CHACHAMARU_SEND_KEY='Bearer '+f.keys.recv;},'chachamaru',()=>f.keys.recv,'chachamaru sendKeyEnv'],
  ['the second registration\'s send key holds "Bearer " and the first one\'s receive key',()=>{f.env.SECOND_SEND_KEY='Bearer '+f.keys.recv;},'chachamaru',()=>f.keys.recv,'second sendKeyEnv'],
 ];
 const writesBefore=f.writes();
 for(const [name,setup,signer,value,twin] of cases){
  f.env.CHACHAMARU_SEND_KEY=f.keys.send;f.env.CHACHAMARU_RECV_KEY=f.keys.recv;f.env.SECOND_RECV_KEY=f.keys.secondRecv;f.env.SECOND_SEND_KEY=f.keys.secondSend;setup();
  f.diagnostics.length=0;
  const r=await f.call('send',f.envelope({sender:signer,key:value()}),signer);
  assert.equal(r.status,'key_unavailable',name+' '+JSON.stringify(r));
  const lines:string[]=[...f.diagnostics];
  assert.deepEqual(lines,[`keys_not_distinct: ${signer} receiveKeyEnv equals ${twin}`],name);
  for(const line of lines)for(const k of Object.values(f.keys))assert.ok(!line.includes(k),'a diagnostic never holds a key value');
 }
 assert.equal(f.writes(),writesBefore,'nothing was delivered');
 // Put right, the same registrations work again.
 f.env.CHACHAMARU_SEND_KEY=f.keys.send;f.env.SECOND_RECV_KEY=f.keys.secondRecv;f.env.SECOND_SEND_KEY=f.keys.secondSend;
 assert.equal((await f.call('send',f.envelope({sender:'second',key:f.keys.secondRecv}),'second')).status,'submitted');
});

// The signed bytes are UTF-8; a lone surrogate cannot be encoded and would silently become U+FFFD, so two different texts would carry one signature.
test('a lone surrogate is refused in every signed text field: it cannot stand in for U+FFFD under the same signature',async t=>{
 const f=await externalFixture(t);
 const wire=(e:object,from:string,to:string)=>JSON.parse(JSON.stringify(e).split(from).join(to));
 const fields:Array<[string,Record<string,unknown>]>=[
  ['text',{text:'a\ufffdb'}],['id',{id:'req-\ufffd'}],['replyTo',{replyTo:'earlier-\ufffd'}],['recipient',{recipient:'grok:grok-g:501@\ufffd'}],
 ];
 for(const [name,over] of fields){
  const signed=f.envelope(over as any);
  // Control: the envelope as signed parses.
  assert.equal(parseSignedEnvelope(signed).ok,true,name);
  // The same bytes with the replacement character spelled as a lone surrogate (what a rewriter of the JSON would write).
  const swapped=wire(signed,'\ufffd','\\ud800');
  assert.equal(JSON.stringify(swapped).includes('\\ud800'),true,name+' was rewritten');
  const before=f.writes();
  const r=await f.call('send',swapped);
  assert.equal(r.status,'envelope_invalid',name+' '+JSON.stringify(r));assert.equal(r.reason,name);
  assert.equal(f.writes(),before);
 }
 // A Bot that signs a lone surrogate itself gets the same refusal, and the check is the same one for a high and a low half.
 for(const lone of ['\ud800','\udfff'])assert.equal((await f.call('send',f.envelope({text:`x${lone}y`}))).status,'envelope_invalid');
 assert.equal(await f.noncesWritten(),0,'a refused shape spends no nonce');
 // A real pair (an emoji) is one code point and is fine.
 assert.equal((await f.call('send',f.envelope({text:'完了 \u{1F600}'}))).status,'submitted');
 assert.equal(f.sent[0].text,'完了 \u{1F600}');
});

// The nonce store is looked at per request; it must not read every record each time.
test('thousands of nonce records do not slow a claim, the check that makes a message "verified", or the conversation\'s own listing',async t=>{
 const f=await externalFixture(t);
 await mkdir(f.nonces,{recursive:true,mode:0o700});await chmod(f.nonces,0o700);
 // 5,100 records of other requests (more than the old scan limit), all younger than a day.
 const noise=5100;
 await Promise.all(Array.from({length:noise},async(_,i)=>{
  const record={peer:'chachamaru',keyVersion:1,nonce:`noise-${i}`.padEnd(20,'x'),op:'send',id:`noise-id-${i}`,recipient:'claude:somebody:1@1',signatureSha256:'0'.repeat(64),at:T0-60_000};
  await writeFile(join(f.nonces,createHash('sha256').update(JSON.stringify(['chachamaru',record.nonce])).digest('hex')+'.json'),JSON.stringify(record),{mode:0o600});
 }));
 // A real delivery made after all of them is still vouched for (the old scan stopped looking after 5,000 files).
 assert.equal((await f.call('send',f.envelope({id:'real-1',text:'本物'}))).status,'submitted');
 const delivered=f.sent[0];
 const entry={id:delivered.id,sender:delivered.sender,recipient:delivered.recipient};
 assert.equal(await wasSigned(f.nonces,f.reservations,entry),true);
 assert.equal(await wasSigned(f.nonces,f.reservations,{...entry,id:'never-checked'}),false);
 // Timings. The first claim above swept the store once; from here nothing reads the whole store again within the hour.
 let started=Date.now();
 for(let i=0;i<10;i++)await claimNonce(f.nonces,{peer:'chachamaru',keyVersion:1,nonce:`timed-${i}`.padEnd(20,'x'),op:'send',id:`timed-${i}`,recipient:'claude:x:1@1',signatureSha256:'1'.repeat(64),at:T0},T0);
 const claims=Date.now()-started;
 started=Date.now();
 for(let i=0;i<10;i++)await wasSigned(f.nonces,f.reservations,entry);
 const checks=Date.now()-started;
 // The conversation's own listing, with three of the Bot's envelopes in its inbox.
 const claudeB={provider:'claude' as const,nativeId:'claude-b',generation:'42@100',cwd:f.work,socket:'unused',source:'claude-ancestor' as const};
 const asReceived=(i:number)=>({id:delivered.id,sender:delivered.sender,recipient:delivered.recipient,at:new Date(f.now()-i*1000).toISOString()});
 const mac=f.make({caller:async()=>({status:'ok',caller:claudeB}),adapter:{...f.adapter,received:async()=>[asReceived(0),{...asReceived(1),id:'other-1'},{...asReceived(2),id:'other-2'}]}});
 started=Date.now();
 const listed=(await mac('sessions',{peek:true})).inbound as Array<{id:string;sender:string}>;
 const listing=Date.now()-started;
 assert.equal(listed.find(i=>i.id===delivered.id)?.sender,'verified');
 // Reading all 5,100 records took about a second per call before; one file is a few milliseconds. The bounds leave a slow machine room.
 assert.ok(claims<1500,`10 claims took ${claims} ms`);assert.ok(checks<1500,`10 checks took ${checks} ms`);assert.ok(listing<1500,`a listing took ${listing} ms`);
});

// T2-4 / AC8, the places the first set of tests did not look.
test('with no limits file, a registration reaches a conversation in a subfolder of its folder; "all" reaches every folder; neither is let in by the absence of limits alone',async t=>{
 const f=await externalFixture(t);
 const deep=join(f.work,'a','b');await mkdir(deep,{recursive:true});f.targets[0].cwd=deep;
 await assert.rejects(()=>readFile(f.limitsPath));
 assert.equal((await f.call('send',f.envelope({id:'deep-1'}))).status,'submitted');
 assert.ok((await f.call('sessions',f.envelope({recipient:'*',text:'',id:'deep-list'}))).candidates.some((c:any)=>c.id==='claude:claude-b'));
 // A registration listing only the other folder does not reach it, limits file or not.
 await f.writePeers(peerRecord({scope:[f.other]}));
 assert.equal((await f.call('send',f.envelope({id:'deep-2'}))).status,'scope_conflict');
 await f.writePeers(peerRecord({scope:'all'}));
 assert.equal((await f.call('send',f.envelope({id:'deep-3',recipient:'claude:claude-out:43@100'}))).status,'submitted');
 assert.equal((await f.call('send',f.envelope({id:'deep-4'}))).status,'submitted');
 // A folder that does not exist is outside every listed folder.
 f.targets[0].cwd=join(f.work,'gone');await f.writePeers(peerRecord({scope:[f.work]}));
 assert.equal((await f.call('send',f.envelope({id:'deep-5'}))).status,'scope_conflict');
});
test('the key version is looked at again just before the write: a rotation in between delivers nothing',async t=>{
 const f=await externalFixture(t);
 f.beforeWrite(async()=>{await f.writePeers(peerRecord({scope:[f.work],keyVersion:2}));});
 const r=await f.call('send',f.envelope({id:'rot-1'}));
 assert.equal(r.status,'key_version_mismatch');assert.equal(f.writes(),0);assert.equal(await f.reserved(),0);
 f.beforeWrite(async()=>{});
 assert.equal((await f.call('send',f.envelope({id:'rot-1',keyVersion:2}))).status,'submitted');
});
test('a conversation that moved to another folder inside the scope between the first look and the write is not delivered to',async t=>{
 const f=await externalFixture(t);
 const sub=join(f.work,'sub');await mkdir(sub);
 f.beforeWrite(async()=>{f.targets[0].cwd=sub;});
 const r=await f.call('send',f.envelope({id:'move-1'}));
 assert.equal(r.status,'workspace_changed');assert.equal(f.writes(),0);assert.equal(await f.reserved(),0);
 f.beforeWrite(async()=>{});
 assert.equal((await f.call('send',f.envelope({id:'move-1'}))).status,'submitted');
});
test('an outside sender whose registration covers none of the live conversations gets an empty list (nothing to name), not a refusal; naming one anyway is refused',async t=>{
 const f=await externalFixture(t);
 const away=join(f.home,'away');await mkdir(away);await f.writePeers(peerRecord({scope:[away]}));
 const list=await f.call('sessions',f.envelope({recipient:'*',text:'',id:'none-listed'}));
 assert.equal(list.status,'ok');assert.deepEqual(list.candidates,[]);
 const named=await f.call('send',f.envelope({id:'none-named'}));
 assert.equal(named.status,'scope_conflict');assert.equal(f.writes(),0);
});

// The Keychain (specs/202610-more-peers, MVP): the receive key, and the other keys it is compared with, come from the environment and,
// when the environment has none, from the Keychain. The reader is injected here; no test reaches the real Keychain.
const noKeyVariables=(f:Awaited<ReturnType<typeof externalFixture>>)=>{for(const n of ['CHACHAMARU_RECV_KEY','CHACHAMARU_SEND_KEY','SECOND_RECV_KEY','SECOND_SEND_KEY'])delete f.env[n];};
test('keychain: the receive key can come from the Keychain, and an empty environment value falls through to it',async t=>{
 const f=await externalFixture(t);noKeyVariables(f);
 const k=fakeKeychain({CHACHAMARU_RECV_KEY:f.keys.recv,CHACHAMARU_SEND_KEY:f.keys.send});const auto=f.make({keychain:k.read});
 const r=await f.call('send',f.envelope(),'chachamaru',auto);
 assert.equal(r.status,'submitted',JSON.stringify(r));assert.equal(f.writes(),1);
 assert.deepEqual([...new Set(k.asked)].sort(),['CHACHAMARU_RECV_KEY','CHACHAMARU_SEND_KEY'],'the key and the keys it is compared with; never an address');
 f.env.CHACHAMARU_RECV_KEY='';
 assert.equal((await f.call('send',f.envelope(),'chachamaru',auto)).status,'submitted');
 // A wrong key is still a wrong key, wherever it was read from.
 assert.equal((await f.call('send',f.envelope({key:f.keys.send}),'chachamaru',auto)).status,'signature_mismatch');
 const text=JSON.stringify([r,await f.readNonces(),f.diagnostics]);for(const key of Object.values(f.keys))assert.ok(!text.includes(key));
});
test('keychain: no key in the environment or the Keychain, or a Keychain that fails, is key_unavailable',async t=>{
 const f=await externalFixture(t);noKeyVariables(f);
 for(const reader of [fakeKeychain().read,async()=>{throw new Error('locked');},async()=>'']){
  await expectRejected(f,f.envelope(),'key_unavailable');
  assert.equal((await f.call('send',f.envelope(),'chachamaru',f.make({keychain:reader}))).status,'key_unavailable');
 }
 assert.equal(f.writes(),0);assert.equal(await f.noncesWritten(),0);
});
test('keychain: two keys that are one value are caught when either one lives in the Keychain',async t=>{
 const f=await externalFixture(t);noKeyVariables(f);
 await f.writePeers(peerRecord({scope:[f.work]}),secondRecord({scope:[f.work]}));
 const items={CHACHAMARU_RECV_KEY:f.keys.recv,CHACHAMARU_SEND_KEY:f.keys.send,SECOND_RECV_KEY:f.keys.secondRecv,SECOND_SEND_KEY:f.keys.secondSend};
 const control=f.make({keychain:fakeKeychain(items).read});
 assert.equal((await f.call('send',f.envelope(),'chachamaru',control)).status,'submitted');
 // The second registration's send key (in the Keychain) holds the first one's receive key.
 const twin=f.make({keychain:fakeKeychain({...items,SECOND_SEND_KEY:f.keys.recv}).read});
 const r=await f.call('send',f.envelope(),'chachamaru',twin);
 assert.equal(r.status,'key_unavailable',JSON.stringify(r));
 assert.deepEqual(f.diagnostics,['keys_not_distinct: chachamaru receiveKeyEnv equals second sendKeyEnv']);
 for(const line of f.diagnostics)for(const key of Object.values(f.keys))assert.ok(!line.includes(key));
 // The environment and the Keychain are one set of keys: the twin may be in the environment while the key is in the Keychain.
 f.env.SECOND_RECV_KEY=f.keys.recv;
 const mixed=f.make({keychain:fakeKeychain({CHACHAMARU_RECV_KEY:f.keys.recv,CHACHAMARU_SEND_KEY:f.keys.send,SECOND_SEND_KEY:f.keys.secondSend}).read});
 assert.equal((await f.call('send',f.envelope(),'chachamaru',mixed)).status,'key_unavailable');
 assert.equal(f.writes(),1,'only the control was delivered');
});
test('keychain: listing the roster never reads a value',async t=>{
 const f=await externalFixture(t);noKeyVariables(f);
 const k=fakeKeychain({CHACHAMARU_RECV_KEY:f.keys.recv});
 const caller={provider:'claude' as const,nativeId:'claude-b',generation:'42@100',cwd:f.work,socket:'unused',source:'claude-ancestor' as const};
 const auto=f.make({keychain:k.read,caller:async()=>({status:'ok' as const,caller})});
 const r=await auto('sessions',{peek:true});assert.equal(r.external.length,1);assert.deepEqual(k.asked,[]);
});
