import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type IncomingHttpHeaders,type IncomingMessage,type ServerResponse,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {readdir,readFile,stat,writeFile,chmod,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createAutomatic,issueTicket,parseTicket} from '../src/automatic.ts';
import {runCli} from '../src/cli.ts';
import {requests,reservationFile} from '../src/request-store.ts';
import {SEAMLESS_ENVELOPE_MARK} from '../src/adapters/grok.ts';
import {SAME_CONTENT_HOLD_MS} from '../src/external-inbound.ts';
import {endpointOf,WEBHOOK_TIMEOUT_MS,MAX_BOT_TEXT} from '../src/webhook-send.ts';
import {externalFixture,peerRecord,secondRecord,T0} from './support/signed-fixture.ts';
import {fakeKeychain} from './support/keychain-fixture.ts';
import type {Caller,CallerResult} from '../src/caller.ts';

// specs/202610-more-peers T2-2: a Mac conversation sends to a registered Grok Bot by POSTing the envelope to its webhook.
// Every request goes to a fake server on 127.0.0.1 (the only http address the test seam allows); no real address or key is read.
type Cleanup={after:(fn:()=>Promise<void>)=>void};
type Hit={method:string|undefined;path:string|undefined;headers:IncomingHttpHeaders;raw:string;json:any};
type Handler=(hit:Hit,req:IncomingMessage,res:ServerResponse,index:number)=>void|Promise<void>;
const ok:Handler=(_hit,_req,res)=>{res.statusCode=200;res.end('accepted');};
async function botServer(t:Cleanup,handler:Handler=ok){
 const hits:Hit[]=[];
 const server:Server=createServer((req,res)=>{
  const chunks:Buffer[]=[];
  req.on('data',c=>chunks.push(c));
  req.on('end',()=>{
   const raw=Buffer.concat(chunks).toString('utf8');let json:any=null;try{json=JSON.parse(raw);}catch{}
   const hit:Hit={method:req.method,path:req.url,headers:req.headers,raw,json};hits.push(hit);
   Promise.resolve(handler(hit,req,res,hits.length-1)).catch(()=>res.destroy());
  });
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const close=async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));};
 let closed=false;t.after(async()=>{if(!closed)await close();});
 const port=(server.address() as AddressInfo).port;
 return {hits,port,url:`http://127.0.0.1:${port}/hook/${randomBytes(6).toString('hex')}`,close:async()=>{closed=true;await close();}};
}
const claudeB=(cwd:string):Caller=>({provider:'claude',nativeId:'claude-b',generation:'42@100',cwd,socket:'unused',source:'claude-ancestor'});
async function setup(t:Cleanup,handler?:Handler,timeoutMs=3000){
 const f=await externalFixture(t);
 const bot=await botServer(t,handler);
 f.env.CHACHAMARU_WEBHOOK_URL=bot.url;
 const caller=claudeB(f.work);
 const mac=(extra:Record<string,unknown>={})=>f.make({caller:async()=>({status:'ok' as const,caller}),webhook:{loopbackHttp:true,timeoutMs},...extra});
 const auto=mac();
 const listing=async(using=auto)=>(await using('sessions',{peek:true})).external as Array<Record<string,any>>;
 const ticket=async(using=auto)=>(await listing(using)).find(e=>e.id==='grok-bot:chachamaru')?.ticket as string|null|undefined;
 const send=async(id:string,text='ビルドして',extra:Record<string,unknown>={},using=auto)=>{const tk=await ticket(using);assert.ok(tk,'a ticket was issued');return using('send',{ticket:tk,id,text,...extra});};
 const records=()=>requests(f.reservations);
 return {f,bot,caller,mac,auto,listing,ticket,send,records};
}
type Setup=Awaited<ReturnType<typeof setup>>;
const putLimits=async(f:Setup['f'],value:object)=>{await writeFile(f.limitsPath,JSON.stringify({version:1,exclude:[],scope:null,operations:null,...value}),{mode:0o600});await chmod(f.limitsPath,0o600);};
async function treeText(dir:string):Promise<string>{
 let out='';
 for(const name of await readdir(dir,{recursive:true})){const p=join(dir,name);const s=await stat(p).catch(()=>null);if(s?.isFile())out+='\n'+(await readFile(p)).toString('latin1');}
 return out;
}
async function silent<T>(fn:()=>Promise<T>):Promise<{value:T;output:string}>{
 let output='';const log=console.log,error=console.error,warn=console.warn,write=process.stderr.write;
 const take=(...a:unknown[])=>{output+=a.join(' ')+'\n';};
 console.log=take;console.error=take;console.warn=take;process.stderr.write=((chunk:unknown)=>{output+=String(chunk);return true;}) as typeof process.stderr.write;
 try{return {value:await fn(),output};}finally{console.log=log;console.error=error;console.warn=warn;process.stderr.write=write;}
}
const stageMap=(r:any)=>Object.fromEntries((r.stages as Array<{stage:string;status:string}>).map(s=>[s.stage,s.status]));

// Scene 1.
test('scene 1: a 2xx answer is accepted (submitted); the body is the envelope as JSON, posted once, with the notice that it is not the person\'s approval',async t=>{
 for(const status of [200,201,202,204]){
  const s=await setup(t,(_h,_q,res)=>{res.statusCode=status;res.end(status===204?undefined:'accepted');});
  const r=await s.send(`s1-${status}`,'ビルドが終わったら教えて');
  assert.equal(r.status,'submitted',JSON.stringify(r));assert.equal(s.bot.hits.length,1,String(status));
  const hit=s.bot.hits[0];
  assert.equal(hit.method,'POST');assert.equal(hit.headers['content-type'],'application/json');assert.equal(new URL(s.f.env.CHACHAMARU_WEBHOOK_URL!).pathname,hit.path);
  assert.deepEqual(Object.keys(hit.json).sort(),['id','mark','notice','recipient','replyToken','schemaVersion','sender','text']);
  assert.equal(hit.json.schemaVersion,1);assert.equal(hit.json.id,`s1-${status}`);assert.equal(hit.json.text,'ビルドが終わったら教えて');
  assert.deepEqual(hit.json.sender,{id:'claude:claude-b',nativeId:'claude-b',generation:'42@100'});
  assert.deepEqual(hit.json.recipient,{id:'grok-bot:chachamaru',nativeId:'chachamaru',generation:'1'});
  assert.equal(hit.json.mark,SEAMLESS_ENVELOPE_MARK);
  assert.match(hit.json.notice,/別の会話/);assert.match(hit.json.notice,/承認ではありません/);
  // The reservation is the record of the request, in the shape the receiving path and the status read.
  const [record]=await s.records();
  assert.equal(record.status,'submitted');assert.equal(record.id,`s1-${status}`);
  assert.deepEqual(record.recipient,{id:'grok-bot:chachamaru',provider:'grok-bot',nativeId:'chachamaru',generation:'1',cwd:''});
  assert.deepEqual([record.sender.id,record.sender.provider,record.sender.nativeId,record.sender.generation],['claude:claude-b','claude','claude-b','42@100']);
 }
});

// 立花さんの判断 1 (2026-10-12): the Bot's routine runs under a new id each time (M3-4), so a reply proves it is the Bot's by the
// one-time word this Mac sent with the request, which only the Bot's own address received.
test('each request carries its own reply word; only its hash is kept, in the private record, and nothing returned shows either',async t=>{
 const s=await setup(t);
 const a=await s.send('rt-1','一つ目'),b=await s.send('rt-2','二つ目');
 assert.equal(a.status,'submitted');assert.equal(b.status,'submitted');
 const [x,y]=s.bot.hits.map(h=>h.json.replyToken as string);
 for(const w of [x,y])assert.match(w,/^[A-Za-z0-9_-]{32}$/);
 assert.notEqual(x,y,'a new word for every request');
 const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
 const records=await s.records();
 for(const [id,word] of [['rt-1',x],['rt-2',y]] as const){
  const r=records.find(r=>r.id===id)!;assert.equal((r as any).replyTokenSha256,sha(word),id);
 }
 for(const shown of [a,b])assert.ok(!JSON.stringify(shown).includes('replyToken')&&!JSON.stringify(shown).includes(x)&&!JSON.stringify(shown).includes(y),'the caller never sees the word');
 const disk=await treeText(s.f.home);assert.ok(!disk.includes(x)&&!disk.includes(y),'the word itself is written nowhere');
});

test('the hash of the reply word is in the record before the request leaves, so a reply that comes back at once, or after this process is gone, is still known',async t=>{
 let seen:any=null;const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
 let s:Setup;
 s=await setup(t,async(hit,_req,res)=>{seen={word:hit.json.replyToken,records:await s.records()};res.statusCode=200;res.end('accepted');});
 assert.equal((await s.send('early-1','すぐ返す')).status,'submitted');
 const during=seen.records.find((r:any)=>r.id==='early-1');
 assert.equal(during.status,'pending','the POST is still in flight');assert.equal(during.replyTokenSha256,sha(seen.word),'yet the hash is already on disk');
 const after=(await s.records()).find(r=>r.id==='early-1') as any;assert.equal(after.replyTokenSha256,sha(seen.word),'and stays after the answer');
 // An address that does not answer leaves the request unknown, with the hash kept for a reply that may still come.
 const silent=await setup(t,()=>{});
 const r=await silent.send('early-2','応答なし');assert.equal(r.status,'unknown');
 assert.match(((await silent.records()).find(x=>x.id==='early-2') as any).replyTokenSha256,/^[0-9a-f]{64}$/);
});

// Scene 2.
test('scene 2: any answer that is not 2xx is not accepted (rejected); only the status number is reported, never the answer\'s body, and a redirect is not followed',async t=>{
 for(const status of [400,401,403,404,429,500,502,503,301,302,307]){
  const elsewhere=await botServer(t);
  const s=await setup(t,(_h,_q,res)=>{res.statusCode=status;if(status>=300&&status<400)res.setHeader('location',elsewhere.url);res.end('ANSWER-BODY-MARKER');});
  const r=await s.send(`s2-${status}`);
  assert.equal(r.status,'rejected',JSON.stringify(r));assert.equal(r.reason,`http_${status}`);
  assert.equal(s.bot.hits.length,1);assert.equal(elsewhere.hits.length,0,'a redirect is not followed (and the key goes nowhere else)');
  assert.ok(!JSON.stringify(r).includes('ANSWER-BODY-MARKER'));assert.ok(!(await treeText(s.f.home)).includes('ANSWER-BODY-MARKER'));
  assert.equal((await s.records())[0].status,'rejected');
 }
});

// Scene 3.
const unknownCases:Array<[string,Handler,number?]>=[
 ['the connection is cut after the request is read',(_h,req)=>{req.socket.destroy();}],
 ['the answer is cut in the middle (status line sent, body unfinished)',(_h,req,res)=>{res.writeHead(200,{'content-length':'100'});res.write('partial');setTimeout(()=>req.socket.destroy(),20);}],
 ['no answer comes before the time limit',()=>new Promise(()=>{}),250],
 // A long body is read to its end too: one cut past 64 KiB is as unknown as one cut at 7 bytes (2026-10-09 判定役の指摘 2).
 ['a long 2xx answer is cut after 70,000 bytes',(_h,req,res)=>{res.writeHead(200,{'content-length':'200000'});res.write('x'.repeat(70_000));setTimeout(()=>req.socket.destroy(),20);}],
];
for(const [label,handler,timeoutMs] of unknownCases)test(`scene 3: ${label}: unknown, one POST, and nothing is sent again`,{timeout:20_000},async t=>{
 const s=await setup(t,handler,timeoutMs);
 const started=Date.now();
 const r=await s.send('s3-1','成否不明になる依頼');
 assert.ok(Date.now()-started<5000,'it gave up at the limit, not at some far later default');
 assert.equal(r.status,'unknown',JSON.stringify(r));assert.equal(s.bot.hits.length,1);
 assert.equal((await s.records())[0].status,'unknown');
 // The same id, and the same content under another id, stop at the record. The Bot may well have got it.
 assert.equal((await s.send('s3-1','成否不明になる依頼')).status,'unknown');
 const other=await s.send('s3-2','成否不明になる依頼');
 assert.equal(other.status,'duplicate_of_unknown',JSON.stringify(other));assert.equal(other.requestId,'s3-1');
 assert.equal(s.bot.hits.length,1,'one POST per request, however often it is asked for again');
});
test('a long 2xx answer that ends whole is accepted: its length alone decides nothing',async t=>{
 const s=await setup(t,(_h,_q,res)=>{res.writeHead(200,{'content-length':'200000'});res.end('y'.repeat(200_000));});
 const r=await s.send('long-whole');
 assert.equal(r.status,'submitted',JSON.stringify(r));assert.equal(s.bot.hits.length,1);
});
test('scene 3: a connection that cannot be made at all is unknown too, and is not retried',async t=>{
 const s=await setup(t);await s.bot.close();
 const r=await s.send('s3-refused');
 assert.equal(r.status,'unknown',JSON.stringify(r));
 assert.equal((await s.send('s3-refused')).status,'unknown');assert.equal((await s.records()).length,1);
});
test('the time limit is finite (and the default is a number of seconds, not forever)',()=>{
 assert.ok(Number.isFinite(WEBHOOK_TIMEOUT_MS)&&WEBHOOK_TIMEOUT_MS>0&&WEBHOOK_TIMEOUT_MS<=60_000,String(WEBHOOK_TIMEOUT_MS));
});

// Scene 4.
test('scene 4: the same id is never posted again: the earlier result comes back, accepted or not',async t=>{
 let answer=200;
 const s=await setup(t,(_h,_q,res)=>{res.statusCode=answer;res.end('x');});
 assert.equal((await s.send('s4-ok')).status,'submitted');
 assert.equal((await s.send('s4-ok')).status,'submitted');
 assert.equal((await s.send('s4-ok',undefined,{},s.mac())).status,'submitted','from another process\'s automatic as well');
 assert.equal(s.bot.hits.length,1);
 answer=500;
 assert.equal((await s.send('s4-bad','別の依頼')).status,'rejected');
 answer=200;
 const again=await s.send('s4-bad','別の依頼');
 assert.equal(again.status,'rejected',JSON.stringify(again));assert.equal(s.bot.hits.length,2,'the refused one is not posted again, even though the Bot would take it now');
 // The id with other content is a conflict, and posts nothing either.
 assert.equal((await s.send('s4-ok','違う本文')).status,'id_conflict');
 assert.equal(s.bot.hits.length,2);
});
test('scene 4: two asks for one id at the same moment, even from two separate processes, post once',async t=>{
 const s=await setup(t,async(_h,_q,res)=>{await new Promise(r=>setTimeout(r,60));res.statusCode=200;res.end('x');});
 const tk=await s.ticket();assert.ok(tk);
 const results=await Promise.all([s.auto('send',{ticket:tk,id:'s4-race',text:'同時'}),s.mac()('send',{ticket:tk,id:'s4-race',text:'同時'}),s.auto('send',{ticket:tk,id:'s4-race',text:'同時'})]);
 assert.equal(s.bot.hits.length,1,JSON.stringify(results));
 for(const r of results)assert.ok(['submitted','unknown'].includes(r.status),JSON.stringify(r));
 assert.equal((await s.records()).length,1);
});

test('scene 5: the same content under two ids at the same moment posts once, the other waits on the first',async t=>{
 const s=await setup(t,async(_h,_q,res)=>{await new Promise(r=>setTimeout(r,60));res.statusCode=200;res.end('x');});
 const tk=await s.ticket();assert.ok(tk);
 const results=await Promise.all([s.auto('send',{ticket:tk,id:'same-a',text:'同じ中身'}),s.mac()('send',{ticket:tk,id:'same-b',text:'同じ中身'})]);
 assert.equal(s.bot.hits.length,1,JSON.stringify(results));
 assert.ok(results.some(r=>r.status==='submitted')&&results.some(r=>['duplicate','duplicate_of_unknown'].includes(r.status)),JSON.stringify(results));
});

// Scene 5.
test('scene 5: the same content under another id is a duplicate for a day after it was accepted, and is free after that; other content, replyTo or destination is a new request',async t=>{
 const s=await setup(t);
 assert.equal((await s.send('s5-1','デプロイして')).status,'submitted');
 s.f.advance(60_000);
 const second=await s.send('s5-2','デプロイして');
 assert.equal(second.status,'duplicate',JSON.stringify(second));assert.equal(second.requestId,'s5-1');assert.equal(second.previous,'submitted');
 assert.equal(s.bot.hits.length,1);assert.equal((await s.records()).length,1,'the duplicate reserved nothing');
 assert.equal((await s.send('s5-3','デプロイして',{},s.mac())).status,'duplicate');
 assert.equal((await s.send('s5-4','デプロイしない')).status,'submitted');
 assert.equal(s.bot.hits.length,2);
 s.f.advance(SAME_CONTENT_HOLD_MS-60_000-1000);
 assert.equal((await s.send('s5-5','デプロイして')).status,'duplicate');
 s.f.advance(5000);
 assert.equal((await s.send('s5-6','デプロイして')).status,'submitted');
 assert.equal(s.bot.hits.length,3);
});
test('scene 5: an answer that was not accepted does not hold the content: the same words may be sent again under another id',async t=>{
 let answer=503;
 const s=await setup(t,(_h,_q,res)=>{res.statusCode=answer;res.end('x');});
 assert.equal((await s.send('s5b-1','もう一度')).status,'rejected');
 answer=200;
 assert.equal((await s.send('s5b-2','もう一度')).status,'submitted');
 assert.equal(s.bot.hits.length,2);
});

// Scene 6.
for(const form of ['the key itself','the key with "Bearer " in front (copied from the app\'s field)'])test(`scene 6: Authorization is "Bearer " and the send key (${form}), and neither the key nor the address is in any output or record`,async t=>{
 const s=await setup(t);
 const key=randomBytes(24).toString('hex');
 s.f.env.CHACHAMARU_SEND_KEY=form==='the key itself'?key:`Bearer ${key}`;
 const tk=await s.ticket();assert.ok(tk);
 const {value:r,output}=await silent(()=>s.auto('send',{ticket:tk,id:'s6-1',text:'鍵の扱い'}));
 assert.equal(r.status,'submitted',JSON.stringify(r));
 assert.equal(s.bot.hits[0].headers.authorization,`Bearer ${key}`);
 assert.ok(!s.bot.hits[0].raw.includes(key),'the key is not in the body either');
 const token=new URL(s.bot.url).pathname.split('/').pop()!;
 const where=[JSON.stringify(r),output,await treeText(s.f.home),s.f.diagnostics.join('\n'),JSON.stringify(await s.auto('sessions',{peek:true}))];
 for(const text of where){for(const secret of [key,s.bot.url,token,String(s.bot.port)])assert.ok(!text.includes(secret),'a secret reached an output or a record');}
 // Through the command line the printed result is the same.
 const printed=await silent(()=>runCli(['send',JSON.stringify({ticket:tk,id:'s6-2',text:'鍵の扱い 2'})],s.auto));
 for(const secret of [key,s.bot.url,token])assert.ok(!printed.output.includes(secret));
 assert.equal(JSON.parse(printed.output).status,'submitted');assert.equal(s.bot.hits[1].headers.authorization,`Bearer ${key}`);
});
test('scene 6: only one "Bearer " is taken off; a key that then still has a space, or a line break, is not a key and nothing is sent',async t=>{
 const s=await setup(t);
 for(const bad of ['Bearer Bearer abc','Bearer ','abc def','abc\r\nX-Injected: 1','bearer abc','abcあ']){
  s.f.env.CHACHAMARU_SEND_KEY=bad;
  const r=await s.send(`s6-bad-${randomBytes(3).toString('hex')}`,`本文 ${bad.length}`);
  assert.equal(r.status,'key_unavailable',bad+JSON.stringify(r));
 }
 assert.equal(s.bot.hits.length,0);assert.equal((await s.records()).length,0);
});
test('the send key is the only key the sending path reads; the receive key is never touched',async t=>{
 const s=await setup(t);let reads=0;
 Object.defineProperty(s.f.env,'CHACHAMARU_RECV_KEY',{get(){reads++;return 'never-read';},enumerable:true,configurable:true});
 assert.equal((await s.send('s6-recv')).status,'submitted');assert.equal(reads,0);
});

// Scene 7.
test('scene 7: two requests answered in the opposite order end the same way and post once each, however they end',async t=>{
 const outcomes:Array<[string,'200'|'500'|'503'|'cut','200'|'500'|'503'|'cut']>=[['both accepted','200','200'],['first refused','500','200'],['second refused','200','503'],['first cut','cut','200'],['second cut','200','cut'],['both refused','500','503']];
 for(const [label,a,b] of outcomes){
  const runs:Record<string,string>={};
  for(const order of ['in order','reversed'] as const){
   let releaseA!:()=>void,releaseB!:()=>void;const aDone=new Promise<void>(r=>{releaseA=r;}),bDone=new Promise<void>(r=>{releaseB=r;});
   const s=await setup(t,async(hit,req,res)=>{
    const mine=hit.json.id==='r-a'?{answer:a,wait:order==='reversed'?bDone:Promise.resolve(),release:releaseA}:{answer:b,wait:order==='in order'?aDone:Promise.resolve(),release:releaseB};
    await mine.wait;
    if(mine.answer==='cut')req.socket.destroy();else{res.statusCode=Number(mine.answer);res.end('x');}
    mine.release();
   });
   const tk=await s.ticket();assert.ok(tk);
   const [ra,rb]=await Promise.all([s.auto('send',{ticket:tk,id:'r-a',text:'最初'}),s.auto('send',{ticket:tk,id:'r-b',text:'二番目'})]);
   const posts=(id:string)=>s.bot.hits.filter(h=>h.json.id===id).length;
   runs[order]=JSON.stringify({a:ra.status,b:rb.status,posts:{a:posts('r-a'),b:posts('r-b')},kept:(await s.records()).map(r=>[r.id,r.status]).sort()});
  }
  assert.equal(runs.reversed,runs['in order'],label);
  const want=(x:string)=>x==='200'?'submitted':x==='cut'?'unknown':'rejected';
  assert.deepEqual(JSON.parse(runs.reversed).posts,{a:1,b:1},label);
  assert.deepEqual([JSON.parse(runs.reversed).a,JSON.parse(runs.reversed).b],[want(a),want(b)],label);
 }
});

// Scene 8.
test('scene 8: 8,001 characters (counted as code points) is text_too_long and posts nothing, reserves nothing; 8,000 goes through',async t=>{
 assert.equal(MAX_BOT_TEXT,8000);
 for(const unit of ['あ','😀','a']){
  const s=await setup(t);
  const long=await s.send('s8-long',unit.repeat(8001));
  assert.equal(long.status,'text_too_long',unit);assert.equal(s.bot.hits.length,0);assert.equal((await s.records()).length,0);
  const fine=await s.send('s8-fine',unit.repeat(8000));
  assert.equal(fine.status,'submitted',`${unit} ${JSON.stringify(fine)}`);assert.equal(s.bot.hits.length,1);assert.equal(s.bot.hits[0].json.text,unit.repeat(8000));
  // The refusal is not remembered as an id: the same id may carry a shorter text.
  assert.equal((await s.send('s8-long','短くした')).status,'submitted');
 }
});

// The roster, the key version, the operation and the range: each decides whether there is a ticket, and again just before the write.
test('a ticket is issued for a registered, send-enabled registration whose range holds the caller\'s folder, and it carries no address, key or variable name',async t=>{
 const s=await setup(t);
 const [entry]=await s.listing();
 assert.equal(entry.status,'registered');assert.deepEqual(entry.operations,{read:false,send:true});
 assert.equal(typeof entry.ticket,'string');
 assert.deepEqual(parseTicket(entry.ticket),{provider:'grok-bot',nativeId:'chachamaru',generation:'1',cwd:'',branch:null});
 assert.equal(entry.ticket,issueTicket({provider:'grok-bot',nativeId:'chachamaru',generation:'1',cwd:'',branch:null}));
 const decoded=Buffer.from(entry.ticket,'base64url').toString('utf8');
 for(const word of ['CHACHAMARU','http','127.0.0.1',s.f.keys.send,s.f.keys.recv,s.bot.url])assert.ok(!decoded.includes(word),word);
 // A listing that names the Bot gives the same ticket.
 assert.equal((await s.auto('sessions',{peek:true,target:'grok-bot:chachamaru'})).external[0].ticket,entry.ticket);
});
test('no ticket when the registration is revoked, does not allow send, the limits do not allow send, or the limits scope cannot hold the caller; an unset scope is not listed at all',async t=>{
 const s=await setup(t);const f=s.f;
 const none=async(label:string)=>{const [e]=await s.listing();assert.ok(e,label);assert.equal(e.ticket,null,label);return e;};
 await f.writePeers(peerRecord({scope:[f.work],revoked:{at:'2026-10-09T09:00:00Z'}}));
 assert.equal((await none('revoked')).status,'revoked');
 await f.writePeers(peerRecord({scope:[f.work],operations:{read:false,send:false}}));await none('registration send false');
 await f.writePeers(peerRecord({scope:[f.work]}));
 await putLimits(f,{operations:{read:true,send:false}});await none('limits send false');
 await putLimits(f,{});
 assert.equal(typeof (await s.listing())[0].ticket,'string','back to a ticket once the limits allow it');
 // The limits scope is measured from each folder of the registration; "all" has no folder to measure it from.
 await putLimits(f,{scope:'current_work'});
 assert.equal(typeof (await s.listing())[0].ticket,'string','a registration for the caller\'s own folder fits "current_work"');
 await f.writePeers(peerRecord({scope:'all'}));await none('"all" cannot satisfy a narrower limits scope');
 await putLimits(f,{scope:'any'});
 assert.equal(typeof (await s.listing())[0].ticket,'string','"all" with limits scope "any"');
 await rm0(f.limitsPath);
 const unset=peerRecord({});await f.writePeers(unset);
 assert.deepEqual(await s.listing(),[],'a registration with no scope is not listed, so there is no ticket to ask for');
 // A caller in a folder outside the registration's folders does not see it either.
 await f.writePeers(peerRecord({scope:[f.other]}));
 assert.deepEqual(await s.listing(),[]);
});
const rm0=(path:string)=>rm(path,{force:true});
test('a ticket is checked again when it is used: a roster that changed since (revoked, new key version, send off, other folders, removed, broken) sends nothing and reserves nothing',async t=>{
 const s=await setup(t);const f=s.f;
 const tk=await s.ticket();assert.ok(tk);
 const attempt=async(label:string,want:string)=>{
  const r=await s.auto('send',{ticket:tk,id:`late-${label}`,text:'名簿が変わった後'});
  assert.equal(r.status,want,`${label} ${JSON.stringify(r)}`);assert.equal(s.bot.hits.length,0,label);assert.equal((await s.records()).length,0,label);
 };
 await f.writePeers(peerRecord({scope:[f.work],revoked:{at:'2026-10-09T09:00:00Z'}}));await attempt('revoked','key_revoked');
 await f.writePeers(peerRecord({scope:[f.work],keyVersion:2}));await attempt('rotated','generation_mismatch');
 await f.writePeers(peerRecord({scope:[f.work],operations:{read:false,send:false}}));await attempt('send-off','operation_not_permitted');
 await f.writePeers(peerRecord({scope:[f.other]}));await attempt('other-folder','scope_conflict');
 await f.writePeers(peerRecord({}));await attempt('scope-unset','scope_unset');
 await f.writePeers();await attempt('removed','target_unavailable');
 await writeFile(f.peersPath,'{broken',{mode:0o600});await attempt('broken','peers_unusable');
 await f.writePeers(peerRecord({scope:[f.work]}));await chmod(f.peersPath,0o644);await attempt('mode','peers_unusable');
 // The limits are looked at again as well.
 await f.writePeers(peerRecord({scope:[f.work]}));await putLimits(f,{operations:{read:true,send:false}});await attempt('limits-send','operation_not_permitted');
 await putLimits(f,{scope:'same_repository'});await f.writePeers(peerRecord({scope:'all'}));await attempt('limits-scope','scope_conflict');
 await writeFile(f.limitsPath,'{broken',{mode:0o600});await attempt('limits-broken','limits_unusable');
 // And once the roster is as it was, the same ticket works.
 await f.writePeers(peerRecord({scope:[f.work]}));await rm0(f.limitsPath);
 assert.equal((await s.auto('send',{ticket:tk,id:'late-ok',text:'元に戻った'})).status,'submitted');assert.equal(s.bot.hits.length,1);
});
test('a ticket used from another folder (outside the registration\'s folders) is refused',async t=>{
 const s=await setup(t);const tk=await s.ticket();assert.ok(tk);
 const elsewhere=s.mac({caller:async()=>({status:'ok' as const,caller:claudeB(s.f.other)})});
 const r=await elsewhere('send',{ticket:tk,id:'elsewhere-1',text:'別の作業場所から'});
 assert.equal(r.status,'scope_conflict',JSON.stringify(r));assert.equal(s.bot.hits.length,0);
});
test('the roster changing between the first look and the write sends nothing: caught before the reservation is made and again right before the POST',async t=>{
 // The caller is observed at the start of the call (1), in the ticket's own look (2), in the delivery's look before it reserves (3), in
 // the authorization right after the reservation (4) and once more inside the write, right before the POST (5). Changing the roster
 // as the Nth observation returns lands in that gap.
 for(const [nth,label] of [[3,'before the reservation'],[4,'in the authorization after the reservation'],[5,'in the check right before the POST']] as const)for(const change of ['revoked','address renamed','scope moved','limits closed send','limits broken'] as const){
  const s=await setup(t);let calls=0;
  const racing=s.mac({caller:async()=>{
   calls++;
   if(calls===nth){
    if(change==='revoked')await s.f.writePeers(peerRecord({scope:[s.f.work],revoked:{at:'2026-10-09T09:00:00Z'}}));
    else if(change==='address renamed')await s.f.writePeers(peerRecord({scope:[s.f.work],addressEnv:'CHACHAMARU_OTHER_URL'}));
    else if(change==='scope moved')await s.f.writePeers(peerRecord({scope:[s.f.other]}));
    else if(change==='limits closed send')await putLimits(s.f,{operations:{read:true,send:false}});
    else await writeFile(s.f.limitsPath,'{broken',{mode:0o600});
   }
   return {status:'ok' as const,caller:s.caller};
  }});
  const tk=await s.ticket();assert.ok(tk);
  const r=await racing('send',{ticket:tk,id:`race-${nth}-${change}`,text:'直前に変わる'});
  assert.equal(s.bot.hits.length,0,`${label} ${change} ${JSON.stringify(r)}`);
  assert.ok(['key_revoked','peer_changed','scope_conflict','operation_not_permitted','limits_unusable'].includes(r.status),`${label} ${change} ${JSON.stringify(r)}`);
  assert.equal((await s.records()).length,0,'the reservation was taken back, so the id is free');
  await s.f.writePeers(peerRecord({scope:[s.f.work]}));await rm0(s.f.limitsPath);
  assert.equal((await s.send(`race-${nth}-${change}`,'直前に変わる')).status,'submitted','the same id goes out once the roster is as it was');
 }
});

test('the caller turning out to be someone else, or not observable, at any look sends nothing and reserves nothing: another generation, folder or conversation',async t=>{
 // The looks are numbered as in the roster test above; 1 is the call\'s own start and cannot be a change of caller.
 for(const nth of [2,3,4,5])for(const kind of ['another generation','another folder','another conversation','not observed'] as const){
  const s=await setup(t);let calls=0;
  const swap=():CallerResult=>kind==='another generation'?{status:'ok',caller:{...s.caller,generation:'99@1'}}:kind==='another folder'?{status:'ok',caller:{...s.caller,cwd:s.f.other}}
   :kind==='another conversation'?{status:'ok',caller:{...s.caller,nativeId:'claude-z'}}:{status:'caller_unobserved',reason:'native_ancestor_missing'};
  const racing=s.mac({caller:async()=>{calls++;return calls===nth?swap():{status:'ok' as const,caller:s.caller};}});
  const tk=await s.ticket();assert.ok(tk);
  const r=await racing('send',{ticket:tk,id:`who-${nth}`,text:'呼び手が変わる'});
  assert.equal(r.status,'caller_unobserved',`look ${nth} ${kind} ${JSON.stringify(r)}`);
  assert.equal(s.bot.hits.length,0,`look ${nth} ${kind}`);assert.equal((await s.records()).length,0,`look ${nth} ${kind}: the reservation was taken back`);
  assert.equal((await s.send(`who-${nth}`,'呼び手が変わる')).status,'submitted','the same id goes out for the real caller');
 }
});
test('a Bot ticket names a registration and a key version and nothing else: one with a folder or a branch, or an empty name or version, is not a ticket, and a conversation\'s ticket still needs its folder',async t=>{
 const s=await setup(t);
 const forge=(over:object)=>Buffer.from(JSON.stringify({provider:'grok-bot',nativeId:'chachamaru',generation:'1',cwd:'',branch:null,...over})).toString('base64url');
 assert.deepEqual(parseTicket(forge({})),{provider:'grok-bot',nativeId:'chachamaru',generation:'1',cwd:'',branch:null});
 for(const over of [{cwd:'/tmp'},{cwd:s.f.work},{cwd:null},{branch:'main'},{branch:undefined},{nativeId:''},{generation:''},{generation:1},{extra:true}]){
  assert.throws(()=>parseTicket(forge(over)),/invalid_ticket/,JSON.stringify(over));
  await assert.rejects(s.auto('send',{ticket:forge(over),id:'forged-ticket',text:'偽の切符'}),/invalid_ticket/,JSON.stringify(over));
 }
 assert.equal(s.bot.hits.length,0);assert.equal((await s.records()).length,0);
 for(const provider of ['codex','claude','grok'])assert.throws(()=>parseTicket(forge({provider,cwd:''})),/invalid_ticket/,`${provider} without a folder`);
 assert.deepEqual(parseTicket(forge({provider:'codex',cwd:'/work',branch:'main'})),{provider:'codex',nativeId:'chachamaru',generation:'1',cwd:'/work',branch:'main'});
});

// The address and the key are looked at before anything is reserved (their form only: no value is kept); what is wrong with them stops
// the request like any other unusable registration, and the id stays free.
test('an address or key that is unset or empty, or an address that is not https, posts nothing and reserves nothing; revalidate says so, and the same id goes out once it is fixed',async t=>{
 const s=await setup(t);const url=s.f.env.CHACHAMARU_WEBHOOK_URL!;let n=0;const asked:Array<[string,string]>=[];
 const tk=await s.ticket();assert.ok(tk);
 const attempt=async(set:()=>void,reason:string)=>{
  set();const id=`bad-${++n}`,text=`本文 ${n}`;asked.push([id,text]);
  const r=await s.auto('send',{ticket:tk,id,text});assert.equal(r.status,reason,JSON.stringify(r));assert.equal(Object.hasOwn(r,'reason'),false,'a status word, as for any unusable registration');
  assert.equal(s.bot.hits.length,0,reason);assert.equal((await s.records()).length,0,`${reason}: nothing is reserved`);
  assert.equal((await s.auto('send',{ticket:tk,id,text})).status,reason,'asked again, it is still the same refusal, not a remembered one');
  assert.equal((await s.auto('revalidate',{ticket:tk,operation:'send'})).status,reason,'revalidate does not call it usable');
 };
 await attempt(()=>{delete s.f.env.CHACHAMARU_WEBHOOK_URL;},'address_unavailable');
 await attempt(()=>{s.f.env.CHACHAMARU_WEBHOOK_URL='';},'address_unavailable');
 await attempt(()=>{s.f.env.CHACHAMARU_WEBHOOK_URL='http://bot.example/hook';},'address_not_https');
 await attempt(()=>{s.f.env.CHACHAMARU_WEBHOOK_URL='http://127.0.0.2/hook';},'address_not_https');
 await attempt(()=>{s.f.env.CHACHAMARU_WEBHOOK_URL='http://localhost:1/hook';},'address_not_https');
 await attempt(()=>{s.f.env.CHACHAMARU_WEBHOOK_URL='ftp://bot.example/hook';},'address_invalid');
 await attempt(()=>{s.f.env.CHACHAMARU_WEBHOOK_URL='not a url';},'address_invalid');
 await attempt(()=>{s.f.env.CHACHAMARU_WEBHOOK_URL='https://user:pass@bot.example/hook';},'address_invalid');
 await attempt(()=>{s.f.env.CHACHAMARU_WEBHOOK_URL=url;delete s.f.env.CHACHAMARU_SEND_KEY;},'key_unavailable');
 await attempt(()=>{s.f.env.CHACHAMARU_SEND_KEY='';},'key_unavailable');
 await attempt(()=>{s.f.env.CHACHAMARU_SEND_KEY='Bearer Bearer abc';},'key_unavailable');
 s.f.env.CHACHAMARU_SEND_KEY=s.f.keys.send;
 assert.equal((await s.auto('revalidate',{ticket:tk,operation:'send'})).status,'validated');
 // The ids that were refused were never spent: each goes out now, with the text it had.
 for(const [id,text] of asked.slice(0,3))assert.equal((await s.auto('send',{ticket:tk,id,text})).status,'submitted',id);
 assert.equal(s.bot.hits.length,3);
 // None of what was wrong left a value in the records.
 for(const secret of ['bot.example','user:pass','127.0.0.2'])assert.ok(!(await treeText(s.f.home)).includes(secret));
});
test('plain http to 127.0.0.1 is the test seam only: closed by default, so the same address is refused without one connection made',async t=>{
 const s=await setup(t);
 const closed=createAutomatic({home:s.f.home,env:s.f.env,caller:async()=>({status:'ok',caller:s.caller}),scan:async()=>({sessions:[],codexWorkspace:'observed'}),inspect:async()=>null,scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd})},adapter:s.f.adapter,clock:{now:()=>T0,sleep:async()=>{}}});
 const r=await s.send('closed-1','閉じている',{},closed);
 assert.equal(r.status,'address_not_https',JSON.stringify(r));assert.equal(s.bot.hits.length,0);assert.equal((await s.records()).length,0);
 // The seam cannot be reached from the command line, the server or the environment.
 for(const file of ['cli.ts','mcp.ts','serve.ts'])assert.ok(!readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8').includes('loopbackHttp'),file);
 const code=readFileSync(new URL('../src/webhook-send.ts',import.meta.url),'utf8').split('\n').filter(l=>!l.trimStart().startsWith('//')).join('\n');
 assert.equal(/process\.env/.test(code),false,'the sending code takes its environment as an argument');
 // https is accepted by the address check without touching the network.
 const ok=endpointOf({CHACHAMARU_WEBHOOK_URL:'https://bot.example/hook',CHACHAMARU_SEND_KEY:'k'},{addressEnv:'CHACHAMARU_WEBHOOK_URL',sendKeyEnv:'CHACHAMARU_SEND_KEY'},false);
 assert.ok('url' in ok);assert.equal(ok.url.hostname,'bot.example');assert.equal(ok.key,'k');
 assert.deepEqual(endpointOf({A:'http://127.0.0.1:9/h',K:'k'},{addressEnv:'A',sendKeyEnv:'K'},false),{reason:'address_not_https'});
 assert.ok('url' in endpointOf({A:'http://127.0.0.1:9/h',K:'k'},{addressEnv:'A',sendKeyEnv:'K'},true));
});

// The envelope.
for(const marked of [false,true])test(`the envelope carries humanApproval:false only under markUnapproved, and never true (markUnapproved=${marked})`,async t=>{
 const s=await setup(t);await putLimits(s.f,marked?{markUnapproved:true}:{});
 assert.equal((await s.send('mark-1','印')).status,'submitted');
 const body=s.bot.hits[0].json;
 if(marked)assert.equal(body.humanApproval,false);else assert.ok(!Object.hasOwn(body,'humanApproval'));
 assert.notEqual(body.humanApproval,true);assert.match(body.notice,/承認ではありません/);
});
test('a reply to a request the Bot made carries replyTo; a replyTo that is not a request of that Bot posts nothing',async t=>{
 const s=await setup(t);
 // The Bot\'s request, as the conversation holds it (the receiving path delivered it).
 const asked={id:'bot-ask-1',sender:{id:'grok-bot:chachamaru',nativeId:'chachamaru',generation:'1'},recipient:{id:'claude:claude-b',nativeId:'claude-b',generation:'42@100'},text:''};
 const holder=s.mac({adapter:{...s.f.adapter,inbound:async()=>[asked]}});
 const reply=await s.send('reply-1','できました',{replyTo:'bot-ask-1'},holder);
 assert.equal(reply.status,'submitted',JSON.stringify(reply));assert.equal(s.bot.hits[0].json.replyTo,'bot-ask-1');
 const unknownTarget=await s.send('reply-2','誰への返信でもない',{replyTo:'never-asked'},holder);
 assert.ok(['invalid_reply','reply_target_not_yet_visible'].includes(unknownTarget.status),JSON.stringify(unknownTarget));
 assert.equal(s.bot.hits.length,1);
});

test('a reply to a request the Bot made before its key was rotated is still a reply (the registration is the same; only the key version moved), but not when the request came from another Bot or a look-alike',async t=>{
 const s=await setup(t);
 const asked=(over:object={},sender:object={})=>({id:'bot-ask-rot',sender:{id:'grok-bot:chachamaru',nativeId:'chachamaru',generation:'1',...sender},recipient:{id:'claude:claude-b',nativeId:'claude-b',generation:'42@100'},text:'',...over});
 await s.f.writePeers(peerRecord({scope:[s.f.work],keyVersion:2}));
 const holder=(...envelopes:object[])=>s.mac({adapter:{...s.f.adapter,inbound:async()=>envelopes}});
 const ok=await s.send('rot-1','回転の後の返信',{replyTo:'bot-ask-rot'},holder(asked()));
 assert.equal(ok.status,'submitted',JSON.stringify(ok));assert.equal(s.bot.hits[0].json.replyTo,'bot-ask-rot');
 assert.deepEqual(s.bot.hits[0].json.recipient,{id:'grok-bot:chachamaru',nativeId:'chachamaru',generation:'2'},'it goes to the registration under its current key version');
 // Another registration\'s request, or a sender spelled like a conversation, is not this Bot\'s.
 await s.f.writePeers(peerRecord({scope:[s.f.work],keyVersion:2}),{...peerRecord({scope:[s.f.work]}),name:'second',displayName:'二番目',addressEnv:'SECOND_WEBHOOK_URL',sendKeyEnv:'SECOND_SEND_KEY',receiveKeyEnv:'SECOND_RECV_KEY'});
 const other=await s.send('rot-2','別の Bot の依頼への返信',{replyTo:'bot-ask-rot'},holder(asked({},{id:'grok-bot:second',nativeId:'second'})));
 assert.equal(other.status,'invalid_reply',JSON.stringify(other));
 const lookalike=await s.send('rot-3','似せた送り手',{replyTo:'bot-ask-rot'},holder(asked({},{id:'claude:chachamaru'})));
 assert.equal(lookalike.status,'invalid_reply',JSON.stringify(lookalike));
 assert.equal(s.bot.hits.length,1);
});

// Reading is never offered; the list says so.
test('read stays impossible for a Bot: the listing says read false, a ticket cannot be revalidated for read, and naming the Bot to read finds nothing',async t=>{
 const s=await setup(t);const tk=await s.ticket();assert.ok(tk);
 for(const e of await s.listing())assert.equal(e.operations.read,false);
 const read=await s.auto('revalidate',{ticket:tk,operation:'read'});
 assert.equal(read.status,'operation_not_permitted',JSON.stringify(read));
 assert.equal((await s.auto('revalidate',{ticket:tk,operation:'send'})).status,'validated');
 const named=await s.auto('read',{target:'grok-bot:chachamaru'});
 assert.notEqual(named.status,'ok');assert.ok(!Array.isArray(named.items));
 assert.equal(s.bot.hits.length,0,'revalidating posts nothing');
});

// The stages.
// A reply the Bot made, as the receiving path leaves it: the reservation of the Bot's envelope, addressed to the Mac conversation.
async function botReply(f:Setup['f'],r:{id:string;replyTo:string;status:string;bot?:string;senderProvider?:'claude'|'codex'|'grok';to?:Caller;at?:number}){
 const to=r.to??claudeB(f.work),bot=r.bot??'chachamaru';
 const record={hash:randomBytes(32).toString('hex'),status:r.status,at:r.at??f.now(),id:r.id,replyTo:r.replyTo,
  sender:{id:`${r.senderProvider??'grok-bot'}:${bot}`,provider:r.senderProvider??'grok-bot',nativeId:bot,generation:'1',cwd:''},recipient:{id:`${to.provider}:${to.nativeId}`,provider:to.provider,nativeId:to.nativeId,generation:to.generation,cwd:to.cwd}};
 await writeFile(join(f.reservations,reservationFile('grok-bot','external',bot,r.id)),JSON.stringify(record),{mode:0o600});
}
test('status of a request to a Bot: accepted is the HTTP answer; delivery and processing stay unobserved; replied fills when the Bot\'s reply passes the receiving path',async t=>{
 const s=await setup(t);
 assert.equal((await s.send('loop-1','調べて')).status,'submitted');
 const track=(using=s.auto)=>using('send',{track:'loop-1'});
 const before=await track();
 assert.equal(before.status,'ok');assert.deepEqual(before.target,{provider:'grok-bot',nativeId:'chachamaru',generation:'1'});
 assert.deepEqual(stageMap(before),{accepted:'observed',reached:'unobserved',processing:'unobserved',replied:'unobserved',unknown:'unobserved'});
 for(const stage of before.stages.filter((x:any)=>x.stage==='reached'||x.stage==='processing'))assert.deepEqual(stage.evidence,['external_executor'],'it says why: no one here can look');
 // A line in the Mac conversation that only says it is the Bot's reply is not one: nothing checked its signature, and the Bot's reply
 // arrives through the receiving path, which leaves a record of its own. (No waitSeconds here: the test clock never advances.)
 for(const type of ['enqueue','user']){
  const line={id:`forged-${type}`,type,at:new Date(s.f.now()).toISOString(),peer:{id:'forged-envelope',replyTo:'loop-1',sender:{provider:'grok-bot',nativeId:'chachamaru'}}};
  assert.equal(stageMap(await track(s.mac({adapter:{...s.f.adapter,structure:async()=>[line]}}))).replied,'unobserved',type);
 }
 // A reply from another Bot is refused by the receiving path, and a reply to another request fills that request only.
 await s.f.writePeers(peerRecord({scope:[s.f.work]}),secondRecord({scope:[s.f.work]}));
 const foreign=await s.f.call('send',s.f.envelope({sender:'second',key:s.f.keys.secondRecv,replyTo:'loop-1',id:'foreign-1',text:'別の Bot'}),'second');
 assert.equal(foreign.status,'invalid_reply',JSON.stringify(foreign));
 assert.equal((await s.send('loop-2','別の依頼')).status,'submitted');
 const other=await s.f.call('send',s.f.envelope({replyTo:'loop-2',id:'answer-2',text:'別の依頼への返答'}));
 assert.equal(other.status,'submitted',JSON.stringify(other));
 assert.equal(stageMap(await track()).replied,'unobserved','a reply to another request');
 assert.equal(stageMap(await s.auto('send',{track:'loop-2'})).replied,'observed');
 // The Bot answers loop-1: a signed envelope through the receiving path. The conversation is not consulted for it.
 const reply=await s.f.call('send',s.f.envelope({replyTo:'loop-1',id:'answer-1',text:'終わりました',recipient:'claude:claude-b:42@100'}));
 assert.equal(reply.status,'submitted',JSON.stringify(reply));
 assert.equal(s.f.sent.at(-1)!.replyTo,'loop-1');
 const after=await track();
 assert.deepEqual(stageMap(after),{accepted:'observed',reached:'unobserved',processing:'unobserved',replied:'observed',unknown:'unobserved'});
 assert.deepEqual(after.stages.find((x:any)=>x.stage==='replied').evidence,['answer-1']);
 // Waiting for a reply that does come ends at it.
 const waited=await s.auto('send',{track:'loop-1',waitSeconds:5});
 assert.equal(waited.status,'ok');
});
test('only a reply that the receiving path accepted and left a record of fills replied: not one that was refused, one whose result is unknown, or one aimed elsewhere',async t=>{
 const s=await setup(t);
 assert.equal((await s.send('rec-1','調べて')).status,'submitted');
 const replied=async()=>stageMap(await s.auto('send',{track:'rec-1'})).replied;
 const lonely:Caller={...claudeB(s.f.work),nativeId:'claude-other'};
 const cases:Array<[string,{status:string;bot?:string;senderProvider?:'claude'|'codex'|'grok';to?:Caller;replyTo?:string}]>=[
  ['refused (rejected)',{status:'rejected'}],['result unknown',{status:'unknown'}],['still pending',{status:'pending'}],
  ['aimed at another conversation',{status:'submitted',to:lonely}],['aimed at another generation of the conversation',{status:'submitted',to:{...claudeB(s.f.work),generation:'43@100'}}],['from another Bot',{status:'submitted',bot:'second'}],['from a conversation spelled like the Bot',{status:'submitted',senderProvider:'claude'}],['for another request',{status:'submitted',replyTo:'rec-2'}],
 ];
 for(const [label,reply] of cases){
  await botReply(s.f,{id:'rec-answer',replyTo:'rec-1',...reply});
  assert.equal(await replied(),'unobserved',label);
  await rm(join(s.f.reservations,reservationFile('grok-bot','external',reply.bot??'chachamaru','rec-answer')));
 }
 await botReply(s.f,{id:'rec-answer',replyTo:'rec-1',status:'submitted'});
 assert.equal(await replied(),'observed');
 // Another conversation asking about the same id sees nothing: the request is not its own.
 const stranger=s.mac({caller:async()=>({status:'ok' as const,caller:lonely})});
 assert.equal((await stranger('send',{track:'rec-1'})).status,'not_found');
});
test('status of a request whose result is unknown says so, and only that',async t=>{
 const s=await setup(t,(_h,req)=>{req.socket.destroy();});
 assert.equal((await s.send('unk-1')).status,'unknown');
 const r=await s.auto('send',{track:'unk-1'});
 assert.deepEqual(stageMap(r),{accepted:'unobserved',reached:'unobserved',processing:'unobserved',replied:'unobserved',unknown:'observed'});
});
test('the status of a request to a Mac conversation is unchanged by the Bot rule: reached and processing carry no external marker',async t=>{
 const f=await externalFixture(t);
 const caller=claudeB(f.work);
 const auto=f.make({caller:async()=>({status:'ok' as const,caller})});
 const ticket=issueTicket({provider:'codex',nativeId:'codex-c',generation:'owner-1',cwd:f.work,branch:null});
 assert.equal((await auto('send',{ticket,id:'mac-1',text:'Mac の会話へ'})).status,'submitted');
 const r=await auto('send',{track:'mac-1'});
 for(const stage of r.stages)assert.deepEqual(stage.evidence,stage.stage==='accepted'?['reservation:submitted']:[],stage.stage);
});
test('the reply from the Bot is the only thing that moves a request on; asking for the status posts nothing',async t=>{
 const s=await setup(t);
 assert.equal((await s.send('quiet-1')).status,'submitted');
 for(let i=0;i<3;i++)await s.auto('send',{track:'quiet-1'});
 s.f.advance(10*60_000);await s.auto('send',{track:'quiet-1'});
 assert.equal(s.bot.hits.length,1);assert.equal((await s.records()).length,1);
});

// The Keychain (specs/202610-more-peers, MVP): the address and the send key are read from the environment, and when the environment has
// no value, from the Keychain. The reader is injected here; no test reaches the real Keychain.
const secretsOf=(s:Setup,key:string)=>[key,s.bot.url,new URL(s.bot.url).pathname.split('/').pop()!,'Bearer '+key];
test('keychain: the address and the send key come from the Keychain when the environment has none; the POST is the same, listing reads nothing, and no value leaks',async t=>{
 const s=await setup(t);const key=randomBytes(24).toString('hex');
 const k=fakeKeychain({CHACHAMARU_WEBHOOK_URL:s.bot.url,CHACHAMARU_SEND_KEY:key});
 delete s.f.env.CHACHAMARU_WEBHOOK_URL;delete s.f.env.CHACHAMARU_SEND_KEY;
 const using=s.mac({keychain:k.read});
 const tk=await s.ticket(using);assert.ok(tk,'listing offers a ticket without having read any value');assert.deepEqual(k.asked,[],'listing never reads a value');
 const {value:r,output}=await silent(()=>using('send',{ticket:tk,id:'kc-1',text:'キーチェーンから'}));
 assert.equal(r.status,'submitted',JSON.stringify(r));assert.equal(s.bot.hits.length,1);
 assert.equal(s.bot.hits[0].headers.authorization,`Bearer ${key}`);assert.equal(s.bot.hits[0].json.id,'kc-1');
 assert.deepEqual([...new Set(k.asked)].sort(),['CHACHAMARU_SEND_KEY','CHACHAMARU_WEBHOOK_URL'],'only the address and the send key are looked up, never the receive key');
 const where=[JSON.stringify(r),output,await treeText(s.f.home),s.f.diagnostics.join('\n'),JSON.stringify(await using('sessions',{peek:true}))];
 for(const text of where)for(const secret of secretsOf(s,key))assert.ok(!text.includes(secret),'a value reached an output or a record');
});
test('keychain: a value in the environment wins and the Keychain is not asked; an empty one falls through to it',async t=>{
 const s=await setup(t);const k=fakeKeychain({CHACHAMARU_WEBHOOK_URL:'https://keychain.invalid/h',CHACHAMARU_SEND_KEY:'keychain-key'});
 const using=s.mac({keychain:k.read});
 assert.equal((await s.send('kc-env',"環境変数",{},using)).status,'submitted');
 assert.equal(s.bot.hits[0].headers.authorization,`Bearer ${s.f.keys.send}`);assert.deepEqual(k.asked,[]);
 s.f.env.CHACHAMARU_SEND_KEY='';
 assert.equal((await s.send('kc-empty','空の値',{},using)).status,'submitted');
 assert.equal(s.bot.hits[1].headers.authorization,'Bearer keychain-key');assert.deepEqual(k.asked,['CHACHAMARU_SEND_KEY']);
});
test('keychain: a key stored as "Bearer <key>" is sent as that key, like one set in the environment',async t=>{
 const s=await setup(t);const key=randomBytes(24).toString('hex');
 const k=fakeKeychain({CHACHAMARU_SEND_KEY:`Bearer ${key}`});delete s.f.env.CHACHAMARU_SEND_KEY;
 assert.equal((await s.send('kc-bearer','Bearer 付き',{},s.mac({keychain:k.read}))).status,'submitted');
 assert.equal(s.bot.hits[0].headers.authorization,`Bearer ${key}`);
});
test('keychain: nothing in either place, or a Keychain that fails, is the same refusal as before; nothing is posted and the id stays free',async t=>{
 const s=await setup(t);const url=s.f.env.CHACHAMARU_WEBHOOK_URL!;
 delete s.f.env.CHACHAMARU_WEBHOOK_URL;delete s.f.env.CHACHAMARU_SEND_KEY;
 const empty=fakeKeychain();const broken=s.mac({keychain:async()=>{throw new Error('locked sv-secret-text');}});
 const tk=await s.ticket();assert.ok(tk);
 for(const using of [s.mac({keychain:empty.read}),broken,s.auto]){
  const r=await using('send',{ticket:tk,id:'kc-none',text:'どこにも無い'});
  assert.equal(r.status,'address_unavailable',JSON.stringify(r));assert.ok(!JSON.stringify(r).includes('sv-secret-text'));
 }
 const onlyAddress=fakeKeychain({CHACHAMARU_WEBHOOK_URL:url});
 assert.equal((await s.mac({keychain:onlyAddress.read})('send',{ticket:tk,id:'kc-none',text:'どこにも無い'})).status,'key_unavailable');
 assert.equal(s.bot.hits.length,0);assert.equal((await s.records()).length,0,'nothing was reserved');
 const both=fakeKeychain({CHACHAMARU_WEBHOOK_URL:url,CHACHAMARU_SEND_KEY:s.f.keys.send});
 assert.equal((await s.mac({keychain:both.read})('send',{ticket:tk,id:'kc-none',text:'どこにも無い'})).status,'submitted','the id was never spent');
});
test('keychain: without a reader (tests, embedding) the environment is all there is',async t=>{
 const s=await setup(t);delete s.f.env.CHACHAMARU_SEND_KEY;
 const r=await s.send('kc-default','環境だけ');
 assert.equal(r.status,'key_unavailable',JSON.stringify(r));
});
