import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,statSync,symlinkSync,writeFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createNotify,reserveFile,signature,type Deps} from './notify.ts';
import {publicTestSecret,signature as eventsSignature} from '../dot-events/events.ts';

// 偽の fetch と偽の時計を注入して、購読、確認、通知を確かめる。外のネットワーク、ChatGPT、tunnel-client は使わない。
// 子プロセスの試験も、fetch を差し替える前読み（--import）を必ず付けて、実際の通信が起きないようにする。
type J=Record<string,any>;
type Cleanup={after:(fn:()=>void)=>void};
type Call={url:string;method:string;redirect:string;headers:Record<string,string>;body:string;signal:AbortSignal};
type Handler=(call:Call)=>Promise<Response>|Response;

const here=dirname(fileURLToPath(import.meta.url));
const notifyPath=join(here,'notify.ts');
const stubPath=join(here,'..','dot-m1','stub.ts');
const VERSION='2026-07-28';
const EVENT='m1.probe.created';
const HOST='connectors.api.openai.com';
const CB=`https://${HOST}/mcp-events/PATH_RAW_123?token=QRY_RAW_9`;
const SECRET=publicTestSecret;
const SECRET_2='whsec_'+Buffer.from('abcdef0123456789abcdef0123456789').toString('base64');
const START=1791468000000;

const meta=(extra:J={}):J=>({'io.modelcontextprotocol/protocolVersion':VERSION,'io.modelcontextprotocol/clientInfo':{name:'TestClient',version:'1.0.0'},'io.modelcontextprotocol/clientCapabilities':{},...extra});
const req=(id:number|string,method:string,params:J={}):J=>({jsonrpc:'2.0',id,method,params});
const subParams=(patch:J={},delivery:J={}):J=>({name:EVENT,arguments:{},delivery:{mode:'webhook',url:CB,secret:SECRET,...delivery},cursor:null,_meta:meta(),...patch});
const sub=(id:number,patch:J={},delivery:J={}):J=>req(id,'events/subscribe',subParams(patch,delivery));
const unsub=(id:number,patch:J={},delivery:J={}):J=>req(id,'events/unsubscribe',{name:EVENT,arguments:{},delivery:{mode:'webhook',url:CB,...delivery},...patch});
const tmp=(t:Cleanup):string=>{const dir=realpathSync(mkdtempSync(join(tmpdir(),'m2-notify-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;};
const flush=async()=>{for(let i=0;i<4;i++)await new Promise<void>(resolve=>setImmediate(resolve));};
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const lines=(s:string)=>s.split('\n').filter(l=>l.length>0);

// 受け取った側の再計算。events.ts の signature とは別に、ここで HMAC を組む。
const receiverSignature=(secret:string,id:string,time:string,body:string)=>'v1,'+createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${id}.${time}.${body}`).digest('base64');
const echoBody=(call:Call)=>JSON.stringify({challenge:JSON.parse(call.body).challenge});
const json=(body:string,status=200)=>new Response(body,{status,headers:{'content-type':'application/json'}});
const okEcho:Handler=call=>{const b=JSON.parse(call.body);return json(b.type==='verification'?echoBody(call):'{}');};
const gate=()=>{let release!:(r:Response)=>void;const promise=new Promise<Response>(resolve=>{release=resolve;});return {promise,release};};

// 偽の時計と偽のタイマー。advance が時間を進め、期限の来たタイマーを順に実行する。
// reserve は、プロセスをまたぐ「送信は 1 回だけ」の予約の代わり。既定は、この harness（= 1 つのプロセス）で最初の 1 回だけ取れる。
function harness(initial:Handler=okEcho,reserve?:Deps['reserve']){
 let clock=START,nextTimer=1,handler=initial;
 let reservedHere=false;
 const timers:{id:number;at:number;fn:()=>void}[]=[];
 const logLines:string[]=[];
 const out:J[]=[];
 const calls:Call[]=[];
 const deps:Deps={
  fetch:async(url,init)=>{
   const headers:Record<string,string>={};
   new Headers(init.headers).forEach((v,k)=>{headers[k]=v;});
   const call:Call={url:String(url),method:String(init.method),redirect:String(init.redirect),headers,body:String(init.body),signal:init.signal as AbortSignal};
   calls.push(call);
   return handler(call);
  },
  now:()=>clock,
  setTimer:(fn,ms)=>{const id=nextTimer++;timers.push({id,at:clock+ms,fn});return id;},
  clearTimer:handle=>{const i=timers.findIndex(x=>x.id===handle);if(i>=0)timers.splice(i,1);},
  write:line=>{logLines.push(line);},
  send:line=>{out.push(JSON.parse(line));},
  reserve:reserve??(()=>{if(reservedHere)return 'taken';reservedHere=true;return 'reserved';})
 };
 const server=createNotify(deps);
 const h={
  calls,out,server,
  now:()=>clock,
  pending:()=>timers.length,
  set:(next:Handler)=>{handler=next;},
  send:(message:J|string)=>server.handleLine(typeof message==='string'?message:JSON.stringify(message)),
  reply:(id:number|string):J=>{const found=out.find(m=>m.id===id);assert.ok(found,`no reply for id ${id}`);return found;},
  records:():J[]=>logLines.map(l=>JSON.parse(l) as J),
  rawLog:()=>logLines.join(''),
  verifications:()=>calls.filter(c=>JSON.parse(c.body).type==='verification'),
  deliveries:()=>calls.filter(c=>JSON.parse(c.body).type!=='verification'),
  async advance(ms:number){
   const target=clock+ms;
   for(;;){
    const due=timers.filter(x=>x.at<=target).sort((a,b)=>a.at-b.at||a.id-b.id)[0];
    if(!due)break;
    timers.splice(timers.indexOf(due),1);
    clock=Math.max(clock,due.at);
    due.fn();
    await flush();
   }
   clock=target;
   await flush();
  }
 };
 return h;
}
type H=ReturnType<typeof harness>;
// 購読を 1 件受理させる。
async function accepted(h:H,id=1,patch:J={},delivery:J={}):Promise<string>{
 await h.send(sub(id,patch,delivery));
 const result=h.reply(id).result;
 assert.ok(result,`subscribe ${id} was not accepted: ${JSON.stringify(h.reply(id))}`);
 return result.id as string;
}

// 記録の許可名簿。宣言していない欄があれば落とし、宣言した欄も決まった形の値だけを通す。
const HEX8=/^[0-9a-f]{8}$/;
const REASONS=/^(challenge_failed|timeout|network|http_[1-5]\d\d|bad_event|bad_delivery|bad_url|bad_secret|bad_ttl|bad_arguments|no_subscription|expired|stdin_end|already_sent|reserve_failed|internal)$/;
const isBool=(v:unknown)=>typeof v==='boolean';
const nullOr=(f:(v:any)=>boolean)=>(v:any)=>v===null||f(v);
const RECORD_FIELDS:Record<string,(v:any)=>boolean>={
 v:v=>v===1,
 run:v=>typeof v==='string'&&HEX8.test(v),
 seq:v=>Number.isInteger(v)&&v>0,
 t:v=>typeof v==='string'&&new Date(v).toISOString()===v,
 kind:v=>['lifecycle','request','notification','response','invalid','internal_error','verification','delivery'].includes(v),
 method:v=>typeof v==='string'&&v.length<=48&&(/^\([a-z_]+\)$/.test(v)||/^[a-z][a-z0-9]*(?:[/_.-][a-z][a-z0-9]*){0,3}$/.test(v)),
 reply:v=>['result','error','none'].includes(v),
 error_code:v=>Number.isInteger(v)&&v<0&&v>=-32768,
 has_id:isBool,
 event:nullOr(v=>v===EVENT||v==='(other)'),
 delivery_mode:nullOr(v=>v==='webhook'||v==='(other)'),
 callback_host:nullOr(v=>typeof v==='string'&&(v==='(invalid)'||(v.length>0&&v.length<=253&&/^[a-z0-9._:[\]-]+$/.test(v)))),
 has_secret:isBool,
 accepted:isBool,
 renewal:isBool,
 removed:isBool,
 reason:v=>typeof v==='string'&&REASONS.test(v),
 result:v=>['ok','failed','attempt','delivered','skipped'].includes(v),
 duration_ms:v=>Number.isInteger(v)&&v>=0&&v<=3_600_000,
 http_status:nullOr(v=>Number.isInteger(v)&&v>=100&&v<=599),
 pid:v=>Number.isInteger(v)&&v>0,
 node:v=>typeof v==='string'&&/^v\d+\.\d+\.\d+$/.test(v),
 error_name:v=>typeof v==='string'&&(v==='(other)'||/^[A-Za-z]{1,40}$/.test(v)),
};
function validateRecord(record:J):void{
 for(const [key,value] of Object.entries(record)){
  const check=RECORD_FIELDS[key];
  assert.ok(check,`the record has an undeclared field: ${key}`);
  assert.ok(check(value),`the record field ${key} has a value outside the allowed shapes`);
 }
 assert.equal(/[0-9a-f]{64}/i.test(JSON.stringify(record)),false,'a 64-hex string is in the record');
}
const checkedRecords=(h:H):J[]=>{const records=h.records();records.forEach(validateRecord);return records;};
// 送信の直前の 'attempt' 行を除いた、配送の結果の行。
const outcomeOf=(h:H):J=>h.records().find(r=>r.kind==='delivery'&&r.result!=='attempt')!;

test('(1) the signature is the Standard Webhooks one: frozen vector, same as events.ts, and it refuses bad secrets',()=>{
 assert.equal(signature(publicTestSecret,'evt_sample',1791468000,'{"text":"sample"}'),'v1,bhUnGT5J3cuKv1Z3+1M4As26PwxppH3hfLSyDWRN2gM=');
 for(const [secret,id,time,body] of [[publicTestSecret,'a',0,''],[SECRET_2,'msg_verification_x',1791468123,'{"type":"verification","challenge":"c"}'],[SECRET_2,'evt_m2_00',1,'日本語']] as const){
  assert.equal(signature(secret,id,time,body),eventsSignature(secret,id,time,body));
  assert.equal(signature(secret,id,time,body),receiverSignature(secret,id,String(time),body));
 }
 for(const secret of ['bad','whsec_YQ==','whsec_!','']) assert.throws(()=>signature(secret,'id',0,'{}'));
});

test('(2) events/subscribe with a wrong event, delivery, callback URL, secret, ttl or arguments is -32602 and sends nothing',async()=>{
 const h=harness();
 const key=(bytes:number)=>'whsec_'+Buffer.alloc(bytes,7).toString('base64');
 const cases:[string,string,J,J][]=[
  ['bad_event','another event',{name:'seamless.message.created'},{}],
  ['bad_event','no event name',{name:undefined},{}],
  ['bad_delivery','mode polling',{},{mode:'polling'}],
  ['bad_delivery','mode missing',{},{mode:undefined}],
  ['bad_delivery','no delivery object',{delivery:undefined},{}],
  ['bad_url','http',{},{url:`http://${HOST}/x`}],
  ['bad_url','other host',{},{url:'https://example.com/x'}],
  ['bad_url','parent domain',{},{url:'https://api.openai.com/x'}],
  ['bad_url','suffix trick',{},{url:`https://${HOST}.evil.test/x`}],
  ['bad_url','prefix trick',{},{url:`https://evil.test/${HOST}`}],
  ['bad_url','user info after the host name',{},{url:`https://${HOST}@evil.test/x`}],
  ['bad_url','user info before the host name',{},{url:`https://user:pw@${HOST}/x`}],
  ['bad_url','port',{},{url:`https://${HOST}:8443/x`}],
  ['bad_url','a port that only starts like the default',{},{url:`https://${HOST}:4430/x`}],
  ['bad_url','the default port with a leading zero',{},{url:`https://${HOST}:0443/x`}],
  ['bad_url','the default port with nothing after it but a dot',{},{url:`https://${HOST}:443./x`}],
  ['bad_url','backslash trick',{},{url:`https://${HOST}\\@evil.test/x`}],
  ['bad_url','tab in the host',{},{url:`https://${HOST}\t/x`}],
  ['bad_url','trailing dot',{},{url:`https://${HOST}./x`}],
  ['bad_url','upper case host',{},{url:'https://CONNECTORS.api.openai.com/x'}],
  ['bad_url','IP address',{},{url:'https://104.18.0.1/x'}],
  ['bad_url','not a string',{},{url:42}],
  ['bad_url','missing',{},{url:undefined}],
  ['bad_secret','missing',{},{secret:undefined}],
  ['bad_secret','not a string',{},{secret:12345}],
  ['bad_secret','no whsec_ prefix',{},{secret:SECRET.slice(6)}],
  ['bad_secret','23 bytes',{},{secret:key(23)}],
  ['bad_secret','65 bytes',{},{secret:key(65)}],
  ['bad_secret','not base64',{},{secret:'whsec_!!!!'}],
  ['bad_secret','base64 with non-zero trailing bits (not the canonical text of its bytes)',{},{secret:SECRET.slice(0,-2)+'Z='}],
  ['bad_secret','base64 whose length is 1 more than a multiple of 4',{},{secret:SECRET.replace(/=*$/,'')+'AA'}],
  ['bad_ttl','zero',{ttlMs:0},{}],
  ['bad_ttl','negative',{ttlMs:-5},{}],
  ['bad_ttl','string',{ttlMs:'60000'},{}],
  ['bad_arguments','array',{arguments:[1]},{}],
  ['bad_arguments','string',{arguments:'x'},{}],
 ];
 let id=0;
 for(const [reason,label,patch,delivery] of cases){
  id++;
  await h.send(sub(id,patch,delivery));
  const reply=h.reply(id);
  assert.equal('result' in reply,false,`${label}: must not be accepted`);
  assert.equal(reply.error.code,-32602,`${label}: error code`);
  const record=h.records().filter(r=>r.method==='events/subscribe').at(-1)!;
  assert.equal(record.reason,reason,`${label}: reason`);
  assert.equal(record.accepted,false,`${label}: accepted`);
 }
 assert.equal(h.calls.length,0,'a rejected subscription must not reach the network');
 await h.advance(60_000);
 assert.equal(h.calls.length,0,'no notification is armed by a rejected subscription');
 checkedRecords(h);
});

test('(2b) a lenient request is accepted: no arguments, ttlMs null, no cursor, extra fields, a path-less URL',async()=>{
 const h=harness();
 await h.send(req(1,'events/subscribe',{name:EVENT,delivery:{mode:'webhook',url:`https://${HOST}`,secret:SECRET},ttlMs:null,extra:{a:1}}));
 assert.equal(h.reply(1).result.cursor,null);
 assert.equal(h.verifications().length,1);
});

test('(2c) the default port written out (:443) and a base64 secret without its = padding are accepted, and the signature is the one a receiver computes from the same bytes',async()=>{
 // OpenAI の手順は「24〜64 バイトに復号できる」としか書かない。:443 は既定のポートで、同じ宛先に同じ 443 で接続する。
 const unpadded=SECRET.replace(/=+$/,'');
 assert.notEqual(unpadded,SECRET,'the fixture really loses padding');
 for(const [label,delivery,secret] of [
  ['explicit :443',{url:`https://${HOST}:443/mcp-events/x?token=y`},SECRET],
  ['explicit :443 and no path',{url:`https://${HOST}:443`},SECRET],
  ['unpadded secret',{secret:unpadded},unpadded],
  ['both',{url:`https://${HOST}:443/x`,secret:unpadded},unpadded],
 ] as [string,J,string][]){
  const h=harness();
  await h.send(sub(1,{},delivery));
  assert.ok(h.reply(1).result,`${label}: accepted`);
  assert.equal(h.verifications().length,1,label);
  const call=h.calls[0];
  assert.equal(call.url,delivery.url??CB,`${label}: posted to the URL as given`);
  assert.equal(new URL(call.url).hostname,HOST);
  assert.equal(new URL(call.url).port,'');
  assert.equal(call.headers['webhook-signature'],receiverSignature(secret,call.headers['webhook-id'],call.headers['webhook-timestamp'],call.body),`${label}: signature`);
  await h.advance(5_000);
  const notice=h.deliveries()[0];
  assert.equal(notice.url,delivery.url??CB);
  assert.equal(notice.headers['webhook-signature'],receiverSignature(secret,notice.headers['webhook-id'],notice.headers['webhook-timestamp'],notice.body),`${label}: notification signature`);
 }
 // 同じ鍵の 2 つの書き方は、同じ署名になる。
 assert.equal(signature(unpadded,'id',1,'{}'),signature(SECRET,'id',1,'{}'));
});

test('(3) the subscribe reply waits for the callback check, which is a signed POST of a fresh challenge that is never followed through a redirect',async()=>{
 const g=gate();
 const h=harness(()=>g.promise);
 const pending=h.send(sub(1));
 await flush();
 assert.equal(h.calls.length,1,'the verification is sent first');
 assert.equal(h.out.length,0,'no reply before the callback answers');
 await h.send(req(2,'ping'));
 assert.deepEqual(h.reply(2).result,{},'other requests are served while the check is pending');
 const call=h.calls[0];
 g.release(json(echoBody(call)));
 await pending;
 const result=h.reply(1).result;
 assert.equal(result.resultType,'complete');
 assert.equal(typeof result.id,'string');
 assert.equal(result.cursor,null);
 assert.equal(result.truncated,false);
 assert.equal(result.refreshBefore,new Date(START+3600_000).toISOString());

 assert.equal(call.method,'POST');
 assert.equal(call.url,CB);
 assert.equal(call.redirect,'manual');
 assert.ok(call.signal instanceof AbortSignal);
 const body=JSON.parse(call.body);
 assert.deepEqual(Object.keys(body).sort(),['challenge','type']);
 assert.equal(body.type,'verification');
 assert.match(body.challenge,/^[A-Za-z0-9_-]{22,}$/);
 assert.equal(call.headers['content-type'],'application/json');
 assert.match(call.headers['webhook-id'],/^msg_verification_[A-Za-z0-9_-]{8,}$/);
 assert.equal(call.headers['webhook-timestamp'],String(Math.floor(START/1000)));
 assert.equal(call.headers['webhook-signature'],receiverSignature(SECRET,call.headers['webhook-id'],call.headers['webhook-timestamp'],call.body));
 assert.equal(call.headers['x-mcp-subscription-id'],result.id);
 assert.equal(h.records().find(r=>r.kind==='verification')!.duration_ms,0,'the record says how long the check took (the fake clock did not move)');
 // 毎回新しい乱数。
 const other=harness();
 await other.send(sub(1));
 assert.notEqual(JSON.parse(other.calls[0].body).challenge,body.challenge);
 assert.notEqual(other.calls[0].headers['webhook-id'],call.headers['webhook-id']);
});

test('(3b) the granted expiry is now plus the smaller of ttlMs and one hour',async()=>{
 for(const [ttl,granted] of [[60_000,60_000],[7200_000,3600_000],[null,3600_000],[undefined,3600_000],[1,1]] as const){
  const h=harness();
  await h.send(sub(1,{ttlMs:ttl}));
  assert.equal(h.reply(1).result.refreshBefore,new Date(START+granted).toISOString(),`ttlMs ${ttl}`);
 }
});

test('(4) a failed callback check is -32015 with a category: challenge_failed, timeout, http_<status>, network',async()=>{
 const wrong:[string,Handler][]=[
  ['challenge_failed',()=>json('{"challenge":"someone-else"}')],
  ['challenge_failed',()=>json('{"challenge":"short"}')],
  ['challenge_failed',call=>json(JSON.stringify({challenge:JSON.parse(call.body).challenge+'x'}))],
  ['challenge_failed',()=>json('{}')],
  ['challenge_failed',()=>json('{"challenge":42}')],
  ['challenge_failed',()=>json('not json')],
  ['challenge_failed',()=>new Response(null,{status:200})],
  ['http_500',()=>json('{"error":"x"}',500)],
  ['http_404',call=>json(echoBody(call),404)],
  ['http_302',call=>new Response(echoBody(call),{status:302,headers:{location:'https://evil.test/'}})],
  ['http_401',()=>new Response(null,{status:401})],
  ['network',()=>{throw new TypeError('fetch failed');}],
 ];
 for(const [reason,handler] of wrong){
  const h=harness(handler);
  await h.send(sub(1));
  const reply=h.reply(1);
  assert.equal('result' in reply,false);
  assert.deepEqual(reply.error,{code:-32015,message:reply.error.message,data:{reason}},reason);
  assert.equal(typeof reply.error.message,'string');
  assert.equal(JSON.stringify(reply).includes('PATH_RAW'),false,'the error does not echo the URL');
  const record=h.records().find(r=>r.method==='events/subscribe')!;
  assert.equal(record.reply,'error');
  assert.equal(record.error_code,-32015);
  assert.equal(record.reason,reason);
  assert.equal(record.accepted,false);
  await h.advance(60_000);
  assert.equal(h.calls.length,1,'a failed check arms no notification');
  checkedRecords(h);
 }
});

// 偽の時計は進まないので、上限が壊れた実装では「失敗」でなく「永久に待つ」になる。node:test の時間切れで、失敗として落とす。
test('(4b) a callback that does not answer in 10 seconds is a timeout, even if it ignores the abort signal',{timeout:5000},async()=>{
 const h=harness(()=>new Promise<Response>(()=>{}));
 const pending=h.send(sub(1));
 await flush();
 await h.advance(9_999);
 assert.equal(h.out.length,0);
 assert.equal(h.calls[0].signal.aborted,false);
 await h.advance(1);
 await pending;
 assert.equal(h.calls[0].signal.aborted,true,'the request is aborted');
 assert.deepEqual(h.reply(1).error.data,{reason:'timeout'});
 const verification=h.records().find(r=>r.kind==='verification')!;
 assert.equal(verification.result,'failed');
 assert.equal(verification.reason,'timeout');
 assert.equal(verification.http_status,null);
 assert.equal(verification.duration_ms,10_000,'the record says how long the check took');

 // signal を守る fetch でも同じ。
 const polite=harness(call=>new Promise<Response>((_,reject)=>{call.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});}));
 const second=polite.send(sub(1));
 await flush();
 await polite.advance(10_000);
 await second;
 assert.deepEqual(polite.reply(1).error.data,{reason:'timeout'});
});

test('(4c) a callback that answers the headers and then stalls on the body is still cut off at 10 seconds, with the status recorded',{timeout:5000},async()=>{
 // 本文の読み取りも 10 秒の上限の下にある。ヘッダの後に上限を外す実装は、ここで永久に待つ。
 const stalled=()=>new Response(new ReadableStream({start(){/* 閉じないし、何も流さない */}}),{status:200,headers:{'content-type':'application/json'}});
 const h=harness(stalled);
 const pending=h.send(sub(1));
 await flush();
 await h.advance(9_999);
 assert.equal(h.out.length,0,'still waiting for the body');
 await h.advance(1);
 await pending;
 assert.deepEqual(h.reply(1).error.data,{reason:'timeout'});
 const verification=h.records().find(r=>r.kind==='verification')!;
 assert.equal(verification.result,'failed');
 assert.equal(verification.reason,'timeout');
 assert.equal(verification.http_status,200,'the status that arrived before the stall is kept');
 assert.equal(verification.duration_ms,10_000);
 assert.equal(h.calls[0].signal.aborted,true);
 await h.advance(60_000);
 assert.equal(h.calls.length,1,'a failed check arms no notification');
});

test('(4d) a callback check whose 2xx answer is larger than 16 KiB is cut off as too_large and the subscription is refused',{timeout:5000},async()=>{
 // 2026-10-11 の逆の家系の点検: 確認の返事を上限なしで読んでいた。challenge の後ろに大きな詰め物を付けた返事でも受理していた。
 const huge:Handler=call=>json(JSON.stringify({challenge:JSON.parse(call.body).challenge,pad:'x'.repeat(2*1024*1024)}));
 const h=harness(huge);
 await h.send(sub(1));
 assert.deepEqual(h.reply(1).error.data,{reason:'too_large'});
 const verification=h.records().find(r=>r.kind==='verification')!;
 assert.equal(verification.result,'failed');
 assert.equal(verification.reason,'too_large');
 await h.advance(60_000);
 assert.equal(h.calls.length,1,'a refused check arms no notification');
});

test('(5) a re-subscribe of the same callback and event returns the same id, checks nothing again and extends the expiry',async()=>{
 const h=harness();
 const first=await accepted(h,1,{ttlMs:60_000});
 await h.advance(1_000);
 for(const [id,patch] of [[2,{}],[3,{arguments:undefined}],[4,{arguments:null}],[5,{ttlMs:120_000,cursor:'abc'}]] as [number,J][]){
  await h.send(sub(id,patch));
  assert.equal(h.reply(id).result.id,first,`re-subscribe ${id}`);
 }
 assert.equal(h.verifications().length,1,'one check only');
 assert.equal(h.reply(2).result.refreshBefore,new Date(START+1_000+3600_000).toISOString(),'no ttlMs: the default of one hour, counted from now');
 assert.equal(h.reply(5).result.refreshBefore,new Date(START+1_000+120_000).toISOString());
 const renewals=h.records().filter(r=>r.method==='events/subscribe').map(r=>r.renewal);
 assert.deepEqual(renewals,[false,true,true,true,true]);

 // 引数の順番は同一性に影響しない。違う引数、違う callback、違うイベントは別の購読。
 const ordered=harness();
 const a=await accepted(ordered,1,{arguments:{a:1,b:{c:2,d:3}}});
 await ordered.send(sub(2,{arguments:{b:{d:3,c:2},a:1}}));
 assert.equal(ordered.reply(2).result.id,a);
 assert.equal(ordered.verifications().length,1);
 await ordered.send(sub(3,{arguments:{a:2}}));
 const c=ordered.reply(3).result.id;
 assert.notEqual(c,a);
 await ordered.send(sub(4,{},{url:`https://${HOST}/another`}));
 const d=ordered.reply(4).result.id;
 assert.ok(d!==a&&d!==c);
 assert.equal(ordered.verifications().length,3);
});

test('(5b) two identical subscribes at the same moment share one callback check',async()=>{
 const g=gate();
 const h=harness(()=>g.promise);
 const p1=h.send(sub(1)),p2=h.send(sub(2));
 await flush();
 assert.equal(h.calls.length,1);
 g.release(json(echoBody(h.calls[0])));
 await Promise.all([p1,p2]);
 assert.equal(h.calls.length,1);
 assert.equal(h.reply(1).result.id,h.reply(2).result.id);
 await h.advance(5_000);
 assert.equal(h.deliveries().length,1,'still one notification');
});

test('(5c) a new secret is checked again with the new secret; if that fails the subscription is dropped',async()=>{
 const h=harness();
 const id=await accepted(h,1);
 await h.send(sub(2,{},{secret:SECRET_2}));
 assert.equal(h.reply(2).result.id,id);
 assert.equal(h.verifications().length,2);
 const second=h.verifications()[1];
 assert.equal(second.headers['webhook-signature'],receiverSignature(SECRET_2,second.headers['webhook-id'],second.headers['webhook-timestamp'],second.body));
 await h.advance(5_000);
 const delivery=h.deliveries()[0];
 assert.equal(delivery.headers['webhook-signature'],receiverSignature(SECRET_2,delivery.headers['webhook-id'],delivery.headers['webhook-timestamp'],delivery.body),'the replaced secret is the one that signs');

 const failing=harness();
 await accepted(failing,1);
 failing.set(()=>json('{"challenge":"no"}'));
 await failing.send(sub(2,{},{secret:SECRET_2}));
 assert.deepEqual(failing.reply(2).error.data,{reason:'challenge_failed'});
 await failing.advance(5_000);
 assert.equal(failing.deliveries().length,0,'a subscription whose new secret was not confirmed is not used');
 assert.equal(outcomeOf(failing).reason,'no_subscription');
});

test('(5d) after the granted expiry the same subscribe is a new subscription and is checked again',async()=>{
 const h=harness();
 const id=await accepted(h,1,{ttlMs:2_000});
 await h.advance(2_000);
 await h.send(sub(2));
 assert.equal(h.reply(2).result.id,id);
 assert.equal(h.verifications().length,2);
 assert.equal(h.records().filter(r=>r.method==='events/subscribe').map(r=>r.renewal).join(),'false,false');
});

test('(6) exactly one notification, 5 seconds after the first acceptance, signed over the one body that is sent',async()=>{
 const h=harness();
 const id=await accepted(h,1);
 await h.advance(4_999);
 assert.equal(h.deliveries().length,0);
 await h.advance(1);
 assert.equal(h.deliveries().length,1);
 const call=h.deliveries()[0];
 assert.equal(call.method,'POST');
 assert.equal(call.url,CB);
 assert.equal(call.redirect,'manual');
 assert.equal(typeof call.body,'string');
 const body=JSON.parse(call.body);
 assert.deepEqual(Object.keys(body).sort(),['cursor','data','eventId','name','timestamp']);
 assert.match(body.eventId,/^evt_m2_[0-9a-f]{8,}$/);
 assert.equal(body.name,EVENT);
 assert.equal(body.timestamp,new Date(START+5_000).toISOString());
 assert.deepEqual(body.data,{id:'m2-test-1'});
 assert.equal(body.cursor,null);
 assert.equal(call.headers['content-type'],'application/json');
 assert.equal(call.headers['webhook-id'],body.eventId);
 assert.equal(call.headers['webhook-timestamp'],String(Math.floor((START+5_000)/1000)));
 assert.equal(call.headers['x-mcp-subscription-id'],id);
 // 受け取った側が、同じ secret で、受け取った本文のバイト列そのものに署名を再計算して一致する。
 assert.equal(call.headers['webhook-signature'],receiverSignature(SECRET,call.headers['webhook-id'],call.headers['webhook-timestamp'],call.body));
 assert.equal(call.headers['webhook-signature'],eventsSignature(SECRET,body.eventId,Number(call.headers['webhook-timestamp']),call.body));
 assert.notEqual(call.headers['webhook-signature'],receiverSignature(SECRET_2,call.headers['webhook-id'],call.headers['webhook-timestamp'],call.body));
 assert.ok(Buffer.byteLength(call.body)<262_144);
 const record=outcomeOf(h);
 assert.equal(record.result,'delivered');
 assert.equal(record.http_status,200);
 assert.equal(record.callback_host,HOST);
 const deliveryRecords=h.records().filter(r=>r.kind==='delivery');
 assert.deepEqual(deliveryRecords.map(r=>r.result),['attempt','delivered'],'a line before the request, a line after it');
 assert.equal(deliveryRecords[0].http_status,null);
 assert.equal(deliveryRecords[0].callback_host,HOST);

 // 更新、別の購読、時間の経過があっても 2 件目は出ない。
 await h.send(sub(2));
 await h.send(sub(3,{},{url:`https://${HOST}/another`}));
 await h.advance(3600_000);
 await h.send(sub(4));
 await h.advance(3600_000);
 assert.equal(h.deliveries().length,1,'one notification per process');
 checkedRecords(h);
});

test('(6b) a notification is not sent again after a failure, and the failure is recorded with the status',async()=>{
 const cases:[string,Handler,number|null][]=[
  ['http_500',call=>JSON.parse(call.body).type==='verification'?json(echoBody(call)):json('{"err":"BODY_RAW"}',500),500],
  ['http_410',call=>JSON.parse(call.body).type==='verification'?json(echoBody(call)):new Response(null,{status:410}),410],
  ['http_413',call=>JSON.parse(call.body).type==='verification'?json(echoBody(call)):new Response(null,{status:413}),413],
  ['http_302',call=>JSON.parse(call.body).type==='verification'?json(echoBody(call)):new Response(null,{status:302,headers:{location:'https://evil.test/'}}),302],
  ['network',call=>{if(JSON.parse(call.body).type==='verification')return json(echoBody(call));throw new TypeError('fetch failed');},null],
 ];
 for(const [reason,handler,status] of cases){
  const h=harness(handler);
  await accepted(h);
  await h.advance(5_000);
  await h.advance(600_000);
  assert.equal(h.deliveries().length,1,`${reason}: no resend`);
  const record=outcomeOf(h);
  assert.equal(record.result,'failed',reason);
  assert.equal(record.reason,reason);
  assert.equal(record.http_status,status);
  assert.equal(h.rawLog().includes('BODY_RAW'),false,'the response body is not logged');
  checkedRecords(h);
 }
 // 2xx なら何でも届いた扱い。
 for(const status of [200,201,204]){
  const h=harness(call=>JSON.parse(call.body).type==='verification'?json(echoBody(call)):new Response(null,{status}));
  await accepted(h);
  await h.advance(5_000);
  const record=outcomeOf(h);
  assert.equal(record.result,'delivered');
  assert.equal(record.http_status,status);
 }
 // 10 秒で止める。
 const slow=harness(call=>JSON.parse(call.body).type==='verification'?json(echoBody(call)):new Promise<Response>(()=>{}));
 await accepted(slow);
 await slow.advance(5_000);
 assert.equal(slow.deliveries()[0].signal.aborted,false);
 await slow.advance(10_000);
 assert.equal(slow.deliveries()[0].signal.aborted,true);
 const record=outcomeOf(slow);
 assert.equal(record.reason,'timeout');
 assert.equal(slow.deliveries().length,1);
});

test('(6c) one notification across processes: when the one-time reservation is already taken (a restart, a second run), nothing is sent and the skip is recorded',async()=>{
 // 状態の置き場を共有する別のプロセス（再起動、2 回目の起動、tunnel-client による子の再起動）を、共有した予約で表す。
 let taken=false;
 const shared=():'reserved'|'taken'=>{if(taken)return 'taken';taken=true;return 'reserved';};
 const first=harness(okEcho,shared);
 await accepted(first,1);
 await first.advance(5_000);
 assert.equal(first.deliveries().length,1);

 const second=harness(okEcho,shared);
 await accepted(second,1);
 await second.advance(5_000);
 await second.advance(3600_000);
 assert.equal(second.deliveries().length,0,'the restarted process does not notify again');
 assert.equal(second.verifications().length,1,'it still checks and accepts the subscription, so ChatGPT is not told that it failed');
 const record=outcomeOf(second);
 assert.equal(record.result,'skipped');
 assert.equal(record.reason,'already_sent');
 assert.equal(record.http_status,null);
 assert.deepEqual(second.records().filter(r=>r.kind==='delivery').map(r=>r.result),['skipped'],'no request was started, so no attempt line');
 // 更新も、別の購読も、もう仕掛けない。
 await second.send(sub(2));
 await second.send(sub(3,{},{url:`https://${HOST}/another`}));
 await second.advance(3600_000);
 assert.equal(second.deliveries().length,0);
 assert.equal(second.records().filter(r=>r.kind==='delivery').length,1);
 checkedRecords(first);
 checkedRecords(second);
});

test('(6d) if the one-time reservation cannot be made, nothing is sent (fail closed) and the reason is recorded',async()=>{
 const h=harness(okEcho,()=>'error');
 await accepted(h,1);
 await h.advance(5_000);
 assert.equal(h.deliveries().length,0);
 const record=outcomeOf(h);
 assert.equal(record.result,'skipped');
 assert.equal(record.reason,'reserve_failed');
 assert.equal(h.reply(1).result.resultType,'complete','the subscription itself was accepted');
 checkedRecords(h);
});

test('(6e) the reservation is taken right before the request, once, and a skipped notification does not use it up',async()=>{
 let reserveCalls=0,callsAtReserve=-1;
 let current:H|undefined;
 const counting=():'reserved'=>{reserveCalls++;callsAtReserve=current!.calls.length;return 'reserved';};
 const h=harness(okEcho,counting);
 current=h;
 await accepted(h,1);
 assert.equal(reserveCalls,0,'a subscription alone does not reserve');
 await h.advance(5_000);
 assert.equal(reserveCalls,1);
 assert.equal(callsAtReserve,1,'taken after the check and before the notification request');
 await h.advance(3600_000);
 assert.equal(reserveCalls,1);

 // 5 秒の間に解除された、期限が切れた、入力が閉じた。どれも予約を使い切らないので、次の起動は送れる。
 for(const how of ['unsubscribed','expired','closed']){
  let calls=0;
  const other=harness(okEcho,()=>{calls++;return 'reserved';});
  await accepted(other,1,how==='expired'?{ttlMs:3_000}:{});
  if(how==='unsubscribed')await other.send(unsub(2));
  if(how==='closed')await other.server.close();
  await other.advance(10_000);
  assert.equal(calls,0,how);
  assert.equal(other.deliveries().length,0,how);
  assert.equal(outcomeOf(other).result,'skipped',how);
 }
});

test('(6f) reserveFile makes the one-time marker: an empty 0600 file created exclusively, never through a symlink, and it reports a failure instead of throwing',t=>{
 const dir=tmp(t);
 const path=join(dir,'m2.jsonl.sent');
 assert.equal(reserveFile(path),'reserved');
 assert.equal(statSync(path).mode&0o777,0o600);
 assert.equal(statSync(path).size,0);
 assert.equal(reserveFile(path),'taken');
 writeFileSync(join(dir,'target'),'');
 symlinkSync(join(dir,'target'),join(dir,'link'));
 assert.equal(reserveFile(join(dir,'link')),'taken');
 assert.equal(readFileSync(join(dir,'target'),'utf8'),'');
 symlinkSync(join(dir,'nowhere'),join(dir,'dangling'));
 assert.equal(reserveFile(join(dir,'dangling')),'taken');
 assert.equal(existsSync(join(dir,'nowhere')),false);
 mkdirSync(join(dir,'a-directory'));
 assert.equal(reserveFile(join(dir,'a-directory')),'taken');
 assert.equal(reserveFile(join(dir,'no-such-dir','x')),'error');
 assert.equal(existsSync(join(dir,'no-such-dir')),false);
});

test('(7) unsubscribe removes the subscription: nothing is sent to it, also when it happens inside the 5 seconds; it is idempotent',async()=>{
 const h=harness();
 await accepted(h,1);
 await h.advance(2_000);
 await h.send(unsub(2));
 assert.deepEqual(h.reply(2).result,{resultType:'complete'});
 await h.advance(3_000);
 assert.equal(h.deliveries().length,0);
 const delivery=outcomeOf(h);
 assert.equal(delivery.result,'skipped');
 assert.equal(delivery.reason,'no_subscription');
 await h.send(unsub(3));
 assert.deepEqual(h.reply(3).result,{resultType:'complete'});
 const removed=h.records().filter(r=>r.method==='events/unsubscribe').map(r=>r.removed);
 assert.deepEqual(removed,[true,false]);
 await h.advance(600_000);
 assert.equal(h.deliveries().length,0);

 // 知らない購読の解除、別の callback の解除は何も消さない。
 const other=harness();
 await accepted(other,1);
 await other.send(unsub(2,{},{url:`https://${HOST}/another`}));
 await other.send(unsub(3,{name:'another.event'}));
 await other.send(req(4,'events/unsubscribe',{}));
 for(const id of [2,3,4])assert.deepEqual(other.reply(id).result,{resultType:'complete'});
 await other.advance(5_000);
 assert.equal(other.deliveries().length,1,'the real subscription survived');
 checkedRecords(h);
 checkedRecords(other);
});

test('(7b) an unsubscribe that arrives while the callback check is pending is applied after it, so the subscription does not come back',async()=>{
 const g=gate();
 const h=harness(()=>g.promise);
 const p1=h.send(sub(1));
 await flush();
 const p2=h.send(unsub(2));
 await flush();
 g.release(json(echoBody(h.calls[0])));
 await Promise.all([p1,p2]);
 assert.ok(h.reply(1).result);
 assert.deepEqual(h.reply(2).result,{resultType:'complete'});
 assert.ok(h.out.findIndex(m=>m.id===1)<h.out.findIndex(m=>m.id===2));
 await h.advance(5_000);
 assert.equal(h.deliveries().length,0);
});

test('(7c) a subscription whose granted time is over before the 5 seconds is not notified',async()=>{
 const h=harness();
 await accepted(h,1,{ttlMs:3_000});
 await h.advance(5_000);
 assert.equal(h.deliveries().length,0);
 const delivery=outcomeOf(h);
 assert.equal(delivery.result,'skipped');
 assert.equal(delivery.reason,'expired');
});

test('(8) closing the input cancels a pending notification, records it, and arms nothing afterwards',async()=>{
 const h=harness();
 await accepted(h,1);
 assert.equal(h.pending(),1,'the 5 second timer');
 await h.server.close();
 assert.equal(h.pending(),0);
 await h.advance(60_000);
 assert.equal(h.deliveries().length,0);
 const records=h.records();
 const delivery=outcomeOf(h);
 assert.equal(delivery.result,'skipped');
 assert.equal(delivery.reason,'stdin_end');
 assert.equal(records.at(-1)!.method,'(stdin_end)');
 checkedRecords(h);

 // 確認の途中で閉じても、確認が終わるまで待ち、その後に通知は仕掛けない。
 const g=gate();
 const late=harness(()=>g.promise);
 const p=late.send(sub(1));
 await flush();
 let lateClosed=false;
 const closing=late.server.close().then(()=>{lateClosed=true;});
 await flush();
 assert.equal(lateClosed,false,'close() waits for the check that is still running');
 g.release(json(echoBody(late.calls[0])));
 await Promise.all([p,closing]);
 assert.equal(lateClosed,true);
 const lateRecords=late.records();
 const verifiedAt=lateRecords.findIndex(r=>r.kind==='verification');
 assert.ok(verifiedAt>=0&&verifiedAt<lateRecords.findIndex(r=>r.method==='(stdin_end)'),'the check is recorded before the end of the input');
 assert.equal(late.pending(),0,'no notification is armed after the input closed');
 await late.advance(60_000);
 assert.equal(late.deliveries().length,0);
});

test('(8b) closing the input while a notification is on its way waits for it and records its result before the end of the input',{timeout:5000},async()=>{
 const g=gate();
 const h=harness(call=>JSON.parse(call.body).type==='verification'?json(echoBody(call)):g.promise);
 await accepted(h,1);
 await h.advance(5_000);
 assert.equal(h.deliveries().length,1,'the notification has been sent and is waiting for its answer');
 let closed=false;
 const closing=h.server.close().then(()=>{closed=true;});
 await flush();
 assert.equal(closed,false,'close() waits for the notification that is on its way');
 assert.equal(outcomeOf(h),undefined,'no result yet');
 assert.deepEqual(h.records().filter(r=>r.kind==='delivery').map(r=>r.result),['attempt'],'the line that says a request was started is already there');
 g.release(new Response(null,{status:200}));
 await closing;
 const records=h.records();
 const resultAt=records.findIndex(r=>r.kind==='delivery'&&r.result==='delivered');
 assert.ok(resultAt>=0,'the result of the notification is recorded');
 assert.ok(resultAt<records.findIndex(r=>r.method==='(stdin_end)'),'and it comes before the end of the input');
 assert.equal(h.deliveries().length,1);
 checkedRecords(h);
});

test('(9) the log has the records of subscribe, check and notification and no secret, URL path or query, challenge, signature, body or ids',async()=>{
 const h=harness();
 const id=await accepted(h,1);
 await h.advance(5_000);
 await h.send(sub(2));
 await h.send(unsub(3));
 h.set(()=>json('{"challenge":"CHAL_WRONG_RAW"}'));
 await h.send(sub(4,{},{url:`https://${HOST}/second/PATH_RAW_456?token=QRY_RAW_8`,secret:SECRET_2}));
 const records=checkedRecords(h);
 assert.deepEqual(records.map(r=>r.method),['(start)','(verification)','events/subscribe','(delivery)','(delivery)','events/subscribe','events/unsubscribe','(verification)','events/subscribe']);
 assert.deepEqual(records.map(r=>r.seq),[1,2,3,4,5,6,7,8,9]);
 assert.equal(new Set(records.map(r=>r.run)).size,1);
 const verification=records[1];
 assert.equal(verification.kind,'verification');
 assert.equal(verification.result,'ok');
 assert.equal(verification.http_status,200);
 assert.equal(verification.callback_host,HOST);
 assert.equal(records[2].accepted,true);
 assert.equal(records[2].callback_host,HOST);
 assert.equal(records[2].has_secret,true);
 assert.equal(records[2].event,EVENT);
 assert.equal(records[2].delivery_mode,'webhook');
 assert.equal(records[3].kind,'delivery');
 assert.equal(records[3].result,'attempt');
 assert.equal(records[4].result,'delivered');
 assert.equal(records[7].result,'failed');
 assert.equal(records[7].reason,'challenge_failed');
 assert.equal(records[7].http_status,200);

 const everything=h.rawLog();
 const secrets=[SECRET,SECRET.slice(6),SECRET_2,SECRET_2.slice(6),'whsec_'];
 const bodies=h.calls.map(c=>c.body);
 const leaks=[...secrets,'PATH_RAW','QRY_RAW','mcp-events','/second','token=','https:','CHAL_WRONG_RAW','m2-test-1','evt_m2_',id,
  ...h.calls.flatMap(c=>[JSON.parse(c.body).challenge,JSON.parse(c.body).eventId,c.headers['webhook-signature'],c.headers['webhook-id'],c.headers['webhook-signature'].slice(3)]).filter(x=>typeof x==='string'),
  ...bodies];
 for(const value of leaks)assert.equal(everything.includes(value),false,`the log leaked ${String(value).slice(0,24)}`);
 assert.equal(/v1,|msg_verification|challenge|signature|authorization|secret/i.test(everything.replace(/has_secret|challenge_failed/g,'')),false);
});

test('(9b) a method name that is not a known one is never written, whatever its shape (a secret-shaped name stays out of the log)',async()=>{
 // 2026-10-11 の逆の家系の点検: 形の合う未知の method を、そのまま記録に書いていた。
 const h=harness();
 for(const [i,name] of [['secretlike','whsecret.abcdefgh'],['short','foo'],['path','tools/steal']].entries())await h.send(req(i+1,name[1]));
 const methods=h.records().filter(r=>r.kind==='request').map(r=>r.method);
 assert.deepEqual(methods,['(other)','(other)','(other)']);
 const everything=h.rawLog();
 for(const raw of ['whsecret','abcdefgh','foo','tools/steal'])assert.equal(everything.includes(raw),false,`the log leaked ${raw}`);
});

test('(10) the other methods answer exactly like the M1 stub; unknown methods, notifications and broken lines are handled',async()=>{
 const h=harness();
 await h.send({jsonrpc:'2.0',method:'notifications/initialized'});
 await h.send(req(1,'server/discover',{_meta:meta()}));
 await h.send(req(2,'tools/call',{name:'steal_RAW'}));
 await h.send(req(3,'resources/list'));
 await h.send('this is not json');
 await h.send('[1,2,3]');
 await h.send({jsonrpc:'2.0',id:5,result:{leak:'RESP_RAW'}});
 await h.send(req(6,'events/list'));
 assert.equal(h.out.length,6,'notifications and client responses get no reply');
 assert.equal(h.reply(2).error.code,-32602);
 assert.equal(h.reply(3).error.code,-32601);
 assert.deepEqual(h.out.filter(m=>m.id===null).map(m=>m.error.code),[-32700,-32600]);
 assert.equal(h.reply(6).result.events[0].name,EVENT);
 const records=checkedRecords(h);
 assert.equal(h.rawLog().includes('RESP_RAW'),false);
 assert.equal(h.rawLog().includes('steal_RAW'),false);
 assert.ok(records.some(r=>r.method==='(parse_error)'));
});

// 子プロセスの試験。fetch を差し替える前読みを必ず付ける（実際の通信を起こさない）。
const GUARD=`
import {appendFileSync} from 'node:fs';
globalThis.fetch=async(url,init)=>{
 const body=String(init&&init.body!==undefined?init.body:'');
 appendFileSync(process.env.M2_FETCH_LOG,JSON.stringify({url:String(url),method:init&&init.method,redirect:init&&init.redirect,headers:Object.fromEntries(new Headers(init&&init.headers).entries()),body})+'\\n');
 let parsed={};try{parsed=JSON.parse(body);}catch{}
 return new Response(parsed.type==='verification'?JSON.stringify({challenge:parsed.challenge}):'{}',{status:200,headers:{'content-type':'application/json'}});
};
`;
function guard(t:Cleanup):{env:Record<string,string>;fetchLog:string;calls:()=>J[]}{
 const dir=tmp(t),file=join(dir,'guard.mjs'),fetchLog=join(dir,'fetch.jsonl');
 writeFileSync(file,GUARD);
 // 前読みが効かないまま子プロセスを走らせると本物の fetch が残る。先に、同じ NODE_OPTIONS で fetch が差し替わっていることを確かめる。
 const env={NODE_OPTIONS:`--import=file://${file}`,M2_FETCH_LOG:fetchLog};
 const probe=spawnSync(process.execPath,['-e','process.stdout.write(String(String(globalThis.fetch).includes("M2_FETCH_LOG")))'],{env:{...process.env,...env},encoding:'utf8'});
 assert.equal(probe.stdout,'true','the fetch replacement did not load; refusing to run a child process');
 return {env,fetchLog,calls:()=>existsSync(fetchLog)?lines(readFileSync(fetchLog,'utf8')).map(l=>JSON.parse(l) as J):[]};
}
function exec(script:string,args:string[],input:(J|string)[],env:Record<string,string>={},cwd?:string,timeoutMs=20000):Promise<{code:number|null;stdout:string;stderr:string}>{
 return new Promise((resolve,reject)=>{
  const base:NodeJS.ProcessEnv={...process.env};
  delete base.M1_LOG;
  const child=spawn(process.execPath,[script,...args],{env:{...base,...env},cwd,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.setEncoding('utf8').on('data',(c:string)=>{stdout+=c;});
  child.stderr.setEncoding('utf8').on('data',(c:string)=>{stderr+=c;});
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('process did not exit after stdin ended'));},timeoutMs);
  child.on('error',reject);
  child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
  child.stdin.on('error',()=>{});
  child.stdin.end(input.length?input.map(l=>typeof l==='string'?l:JSON.stringify(l)).join('\n')+'\n':'');
 });
}

test('(11) the server answers discover, initialize, tools and events/list exactly like the M1 stub',async t=>{
 const g=guard(t);
 const input=[
  req(1,'server/discover',{_meta:meta()}),
  req(2,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'Legacy',version:'0.0.9'}}),
  req(3,'tools/list'),
  req(4,'tools/call',{name:'ping',arguments:{}}),
  req(5,'tools/call',{name:'other'}),
  req(6,'events/list'),
  req(7,'ping'),
  req('s','ping'),
  req(8,'resources/list'),
  'this is not json',
  '[1,2,3]',
  {jsonrpc:'2.0',method:'notifications/initialized'},
  // 解除は同じ識別子の処理の順番を待つので、返事の順番が変わらないよう最後に置く。
  req(9,'events/unsubscribe',{name:EVENT,arguments:{},delivery:{mode:'webhook',url:CB}}),
 ];
 const dir=tmp(t);
 const stub=await exec(stubPath,['--log',join(dir,'m1.jsonl')],input);
 const notify=await exec(notifyPath,['--log',join(dir,'m2.jsonl')],input,g.env);
 assert.equal(stub.code,0);
 assert.equal(notify.code,0);
 assert.equal(notify.stderr,'');
 const replies=(s:string)=>lines(s).map(l=>JSON.parse(l) as J);
 assert.deepEqual(replies(notify.stdout),replies(stub.stdout));
 assert.equal(replies(notify.stdout).length,12);
 assert.equal(g.calls().length,0,'no network call');
});

test('(12) a rejected subscribe over stdio is -32602 and makes no call',async t=>{
 const g=guard(t);
 const dir=tmp(t),log=join(dir,'m2.jsonl');
 const r=await exec(notifyPath,['--log',log],[sub(1,{},{url:'https://example.com/x'}),sub(2,{},{secret:'whsec_X'})],g.env);
 assert.equal(r.code,0);
 const replies=lines(r.stdout).map(l=>JSON.parse(l) as J);
 assert.deepEqual(replies.map(m=>m.error.code),[-32602,-32602]);
 assert.equal(g.calls().length,0);
 const records=lines(readFileSync(log,'utf8')).map(l=>JSON.parse(l) as J);
 records.forEach(validateRecord);
 assert.equal(records.at(-1)!.method,'(stdin_end)');
 assert.equal(readFileSync(log,'utf8').includes('example.com/x'),false,'only the host name is recorded');
});

test('(13) the whole flow in a real process (fetch replaced by a preload): check, reply, one notification after 5 seconds, clean exit, 0600 log',{timeout:30000},async t=>{
 const g=guard(t);
 const dir=tmp(t),log=join(dir,'m2.jsonl');
 writeFileSync(log,'',{mode:0o644});chmodSync(log,0o644);
 const child=spawn(process.execPath,[notifyPath,'--log',log],{env:{...process.env,...g.env},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';
 child.stdout.setEncoding('utf8').on('data',(c:string)=>{stdout+=c;});
 child.stderr.setEncoding('utf8').on('data',(c:string)=>{stderr+=c;});
 const closed=new Promise<number|null>(resolve=>child.on('close',resolve));
 t.after(()=>{child.kill('SIGKILL');});
 const began=Date.now();
 child.stdin.write(JSON.stringify(sub(1))+'\n');
 while(!stdout.includes('"id":1')&&Date.now()-began<10000)await sleep(20);
 const answeredAt=Date.now();
 const reply=JSON.parse(lines(stdout)[0]) as J;
 assert.equal(typeof reply.result.id,'string');
 assert.equal(g.calls().length,1,'only the check has been sent so far');
 while(g.calls().length<2&&Date.now()-answeredAt<12000)await sleep(50);
 const waited=Date.now()-answeredAt;
 assert.equal(g.calls().length,2,'the notification arrived');
 assert.ok(waited>=4_800&&waited<9_000,`the notification came ${waited} ms after the reply`);
 await sleep(500);
 assert.equal(g.calls().length,2);
 const [check,notice]=g.calls();
 assert.equal(check.url,CB);
 assert.equal(check.redirect,'manual');
 assert.equal(notice.headers['webhook-signature'],receiverSignature(SECRET,notice.headers['webhook-id'],notice.headers['webhook-timestamp'],notice.body));
 assert.equal(notice.headers['x-mcp-subscription-id'],reply.result.id);
 child.stdin.end();
 assert.equal(await closed,0);
 assert.equal(stderr,'');
 assert.equal(statSync(log).mode&0o777,0o600);
 const records=lines(readFileSync(log,'utf8')).map(l=>JSON.parse(l) as J);
 records.forEach(validateRecord);
 assert.deepEqual(records.map(r=>r.method),['(start)','(verification)','events/subscribe','(delivery)','(delivery)','(stdin_end)']);
 assert.deepEqual(records.filter(r=>r.kind==='delivery').map(r=>r.result),['attempt','delivered']);
 // 送信の前に作る「1 回だけ」の印。本人だけが読める空のファイル。
 assert.equal(statSync(log+'.sent').mode&0o777,0o600);
 assert.equal(statSync(log+'.sent').size,0);
});

test('(13b) a second run in a real process: the marker of the first send exists, so the check passes and the subscription is accepted but nothing is sent after 5 seconds',{timeout:30000},async t=>{
 const g=guard(t);
 const dir=tmp(t),log=join(dir,'m2.jsonl');
 writeFileSync(log+'.sent','',{mode:0o600});
 const child=spawn(process.execPath,[notifyPath,'--log',log],{env:{...process.env,...g.env},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';
 child.stdout.setEncoding('utf8').on('data',(c:string)=>{stdout+=c;});
 child.stderr.setEncoding('utf8').on('data',(c:string)=>{stderr+=c;});
 const closed=new Promise<number|null>(resolve=>child.on('close',resolve));
 t.after(()=>{child.kill('SIGKILL');});
 const began=Date.now();
 child.stdin.write(JSON.stringify(sub(1))+'\n');
 while(!stdout.includes('"id":1')&&Date.now()-began<10000)await sleep(20);
 assert.equal(typeof (JSON.parse(lines(stdout)[0]) as J).result.id,'string','the subscription is accepted');
 const skippedLine=()=>existsSync(log)&&lines(readFileSync(log,'utf8')).map(l=>JSON.parse(l) as J).some(r=>r.kind==='delivery');
 while(!skippedLine()&&Date.now()-began<15000)await sleep(50);
 await sleep(300);
 assert.equal(g.calls().length,1,'only the check; the notification was not sent');
 child.stdin.end();
 assert.equal(await closed,0);
 assert.equal(stderr,'');
 const records=lines(readFileSync(log,'utf8')).map(l=>JSON.parse(l) as J);
 records.forEach(validateRecord);
 const delivery=records.filter(r=>r.kind==='delivery');
 assert.deepEqual(delivery.map(r=>[r.result,r.reason]),[['skipped','already_sent']]);
 assert.equal(statSync(log+'.sent').size,0,'the marker is left as it was');
});

test('(14) it refuses to start without an explicit, absolute, regular-file --log and creates nothing',async t=>{
 const g=guard(t);
 const dir=tmp(t);
 const refused=async(label:string,args:string[],env:Record<string,string>={})=>{
  const result=await exec(notifyPath,args,[req(1,'ping')],{...g.env,...env},dir);
  assert.equal(result.code,2,`${label}: exit code`);
  assert.equal(result.stdout,'',`${label}: stdout must stay empty`);
  assert.match(result.stderr,/m2-notify/,`${label}: reason on stderr`);
 };
 await refused('no --log',[]);
 await refused('M1_LOG alone is not enough',[],{M1_LOG:join(dir,'m1.jsonl')});
 assert.equal(existsSync(join(dir,'m1.jsonl')),false);
 await refused('--log without a value',['--log']);
 await refused('empty --log',['--log=']);
 await refused('relative path',['--log','m2.jsonl']);
 assert.deepEqual(readdirSync(dir),[],'nothing was created');
 await refused('unknown argument',['--bogus','--log',join(dir,'x.jsonl')]);
 await refused('M1 option',['--accept-subscribe','--log',join(dir,'x.jsonl')]);
 assert.equal(existsSync(join(dir,'x.jsonl')),false);
 await refused('missing parent directory',['--log',join(dir,'no-such-dir','m2.jsonl')]);
 assert.equal(existsSync(join(dir,'no-such-dir')),false);
 mkdirSync(join(dir,'a-directory'));
 await refused('path is a directory',['--log',join(dir,'a-directory')]);
 writeFileSync(join(dir,'target.jsonl'),'');
 symlinkSync(join(dir,'target.jsonl'),join(dir,'link.jsonl'));
 await refused('symlink',['--log',join(dir,'link.jsonl')]);
 assert.equal(readFileSync(join(dir,'target.jsonl'),'utf8'),'','the symlink target was written');
 symlinkSync(join(dir,'dangling-target'),join(dir,'dangling.jsonl'));
 await refused('dangling symlink',['--log',join(dir,'dangling.jsonl')]);
 assert.equal(existsSync(join(dir,'dangling-target')),false);
 assert.equal(g.calls().length,0);
});

test('(15) the source imports no network, process or worker module; fetch is only the injected one, and the one place it is taken from the runtime is the start-up wiring',()=>{
 const source=readFileSync(notifyPath,'utf8');
 assert.equal(/node:(net|http|https|http2|dns|tls|dgram|child_process|worker_threads|cluster|inspector|vm)\b/.test(source),false);
 assert.equal(/\b(XMLHttpRequest|WebSocket|EventSource)\b/.test(source),false);
 assert.equal(/\b(require|import)\s*\(/.test(source),false,'no dynamic import');
 const imports=[...source.matchAll(/from '([^']+)'/g)].map(m=>m[1]).sort();
 assert.deepEqual(imports,['node:crypto','node:fs','node:path','node:url']);
 assert.equal(/(?<![.\w$])fetch\s*\(/.test(source),false,'a bare call of the global fetch');
 assert.equal((source.match(/globalThis\.fetch/g)??[]).length,1,'the runtime fetch is taken in exactly one place');
});
