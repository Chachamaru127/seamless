// M2 測定用サーバー。tunnel-client の --mcp-command（stdio）から起動される。
// M1 のスタブと同じ応答を返し、そのうえで events/subscribe を受理して、OpenAI の手順どおりに callback を確認し、通知を 1 件だけ送る。
// 「1 件だけ」は、記録ファイルの隣の印（<log>.sent）で、再起動や 2 回目の起動をまたいでも守る。印を消すまで、通知は二度と送らない。
// 外へ出る通信は、注入された fetch が行う callback への POST だけ。宛先は connectors.api.openai.com に固定する。
// 記録するのは、時刻、結果、HTTP の状態の数、確認にかかった時間、ホスト名だけ。secret、URL のパスとクエリ、challenge、署名、本文、ID は書かない。
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {closeSync,constants,fchmodSync,fstatSync,lstatSync,openSync,realpathSync,writeSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

type Obj=Record<string,unknown>;

const VERSION='2026-07-28';
// ChatGPT は登録の時に読んだ能力を使い回したので、M1 のスタブと名前も形も変えない。
const SERVER_INFO={name:'seamless-dot-m1-stub',version:'0.0.0'};
const EVENT_NAME='m1.probe.created';
const CALLBACK_HOST='connectors.api.openai.com';
const MAX_VERIFY_BYTES=16_384;
// ホスト名の直後は、既定のポートの :443 を明示したものか、/ ? # か終端。
const CALLBACK_URL=new RegExp('^https://'+CALLBACK_HOST.replace(/\./g,'\\.')+'(?::443)?(?:[/?#]|$)');
const MAX_LINE=1024*1024;
const CACHE={ttlMs:60_000,cacheScope:'private'};
const MAX_GRANT_MS=3600_000;
const CALLBACK_TIMEOUT_MS=10_000;
const NOTIFY_DELAY_MS=5_000;
const KNOWN_METHODS=new Set(['initialize','notifications/initialized','notifications/cancelled','ping','server/discover','tools/list','tools/call','events/list','events/subscribe','events/unsubscribe','resources/list','prompts/list','subscriptions/listen']);

// 外との接点は全てここから注入する。fetch、時計、タイマー、記録の書き込み、標準出力。
export type Deps={
 fetch:(url:string,init:RequestInit)=>Promise<Response>;
 now:()=>number;
 setTimer:(fn:()=>void,ms:number)=>unknown;
 clearTimer:(handle:unknown)=>void;
 write:(line:string)=>void;
 send:(line:string)=>void;
 // 通知を送る直前に 1 回だけ呼ぶ。'reserved' なら送ってよい。'taken' は別の実行が先に送った。'error' は取れなかった（送らない）。
 reserve:()=>'reserved'|'taken'|'error';
};
type Sub={id:string;url:string;secret:string;expiresAt:number};
type Parsed={url:string;secret:string;args:Obj;grant:number}|{reason:string};
type Posted={status:number|null;reason:string|null;text:string|null};

const isObject=(v:unknown):v is Obj=>typeof v==='object'&&v!==null&&!Array.isArray(v);
// 記録する method は既知の名前だけ。ほかの文字列は形が合っても書かない（secret の形の文字列が method に入っても残さない）。
const methodName=(m:unknown):string=>typeof m!=='string'?'(none)':KNOWN_METHODS.has(m)?m:'(other)';
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':isObject(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':(JSON.stringify(v)??'null');
const identityOf=(url:string,args:Obj):string=>'sub_'+createHash('sha256').update(canonical([url,EVENT_NAME,args])).digest('hex').slice(0,32);
const iso=(ms:number)=>new Date(ms).toISOString();

function hostOf(url:unknown):string|null{
 if(typeof url!=='string')return null;
 try{
  const host=new URL(url).hostname;
  return host.length>0&&host.length<=253&&/^[a-z0-9._:[\]-]+$/.test(host)?host:'(invalid)';
 }catch{return '(invalid)';}
}

// Standard Webhooks の署名鍵。whsec_ に続く base64 が、24〜64 バイトに復号でき、その鍵の base64 の正しい書き方（= の詰め物あり、または無し）と一致するものだけ。
function keyOf(secret:unknown):Buffer|null{
 if(typeof secret!=='string'||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))return null;
 const text=secret.slice(6);
 const key=Buffer.from(text,'base64');
 const canonical=key.toString('base64');
 return key.length>=24&&key.length<=64&&(text===canonical||text===canonical.replace(/=+$/,''))?key:null;
}
// experiments/dot-events/events.ts の signature と同じ計算（試験が同じ入力で一致を確かめる）。
export function signature(secret:string,id:string,time:number,body:string):string{
 const key=keyOf(secret);
 if(!key)throw Error('invalid_secret');
 if(!Number.isSafeInteger(time))throw Error('invalid_time');
 return 'v1,'+createHmac('sha256',key).update(`${id}.${time}.${body}`).digest('base64');
}

// https で、ホスト名がちょうど connectors.api.openai.com。:443 以外のポート、ユーザー情報、空白、制御文字、バックスラッシュは通さない。
function callbackUrl(v:unknown):string|null{
 if(typeof v!=='string'||v.length>2048||/[\u0000-\u0020\u007f\\]/.test(v)||!CALLBACK_URL.test(v))return null;
 try{
  const u=new URL(v);
  return u.protocol==='https:'&&u.hostname===CALLBACK_HOST&&u.port===''&&u.username===''&&u.password===''?v:null;
 }catch{return null;}
}

function parseSubscription(params:Obj):Parsed{
 if(params.name!==EVENT_NAME)return {reason:'bad_event'};
 const delivery=params.delivery;
 if(!isObject(delivery)||delivery.mode!=='webhook')return {reason:'bad_delivery'};
 const url=callbackUrl(delivery.url);
 if(url===null)return {reason:'bad_url'};
 const secret=delivery.secret;
 if(typeof secret!=='string'||keyOf(secret)===null)return {reason:'bad_secret'};
 // ttlMs が無い、または null（期限なしの希望）なら 1 時間。数ならその値と 1 時間の小さいほう。
 let grant=MAX_GRANT_MS;
 if(params.ttlMs!==undefined&&params.ttlMs!==null){
  if(typeof params.ttlMs!=='number'||!(params.ttlMs>=1))return {reason:'bad_ttl'};
  grant=Math.floor(Math.min(params.ttlMs,MAX_GRANT_MS));
 }
 const raw=params.arguments;
 if(raw!==undefined&&raw!==null&&!isObject(raw))return {reason:'bad_arguments'};
 const args=isObject(raw)?raw:{};
 try{canonical(args);}catch{return {reason:'bad_arguments'};}
 return {url,secret,args,grant};
}

export function createNotify(deps:Deps){
 // 実行ごとの乱数 4 バイトだけを run に使う。
 const run=randomBytes(4).toString('hex');
 let seq=0;
 const subs=new Map<string,Sub>();
 const locks=new Map<string,Promise<unknown>>();
 const inflight=new Set<Promise<unknown>>();
 // 通知は 1 つのプロセスで最大 1 件（プロセスをまたぐ 1 回は reserve が守る）。最初の受理で仕掛けた時点で armed が立ち、二度と仕掛けない。
 let armed=false;
 let ended=false;
 let notifyTimer:unknown=null;
 let notifyTarget='';

 function record(fields:Obj){deps.write(JSON.stringify({v:1,run,seq:++seq,t:iso(deps.now()),...fields})+'\n');}
 function send(message:Obj){deps.send(JSON.stringify({jsonrpc:'2.0',...message})+'\n');}
 const track=(p:Promise<unknown>)=>{
  inflight.add(p);
  const done=()=>{inflight.delete(p);};
  p.then(done,done);
 };

 const capabilities:Obj={tools:{},events:{},extensions:{'io.modelcontextprotocol/events':{}}};
 const tool={
  name:'ping',
  description:'Measurement probe. Returns a constant string and does nothing else.',
  inputSchema:{type:'object',properties:{},additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
 };
 const eventDefinition={
  name:EVENT_NAME,
  description:'Probe event. Fires when a probe item is created.',
  delivery:['webhook'],
  inputSchema:{type:'object',properties:{},additionalProperties:false},
  payloadSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false}
 };

 // 同じ購読の識別子への処理を 1 つずつ順に行う。確認の最中に来た同じ購読や解除は、確認の後に処理される。
 function locked<T>(id:string,work:()=>Promise<T>):Promise<T>{
  const next=(locks.get(id)??Promise.resolve()).then(work);
  const tail=next.then(()=>undefined,()=>undefined);
  locks.set(id,tail);
  tail.then(()=>{if(locks.get(id)===tail)locks.delete(id);});
  return next;
 }

 // 確認の返事は challenge が入るだけの小さな JSON。上限を超えたら読むのをやめて失敗にする（大きな返事でメモリを使い切らない）。
 async function boundedText(response:Response):Promise<string>{
  const chunks:Buffer[]=[];let size=0;
  if(response.body)for await(const chunk of response.body){size+=chunk.length;if(size>MAX_VERIFY_BYTES){await response.body.cancel().catch(()=>{});throw Error('too_large');}chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks).toString('utf8');
 }
 // callback への POST を 1 回行う。10 秒で打ち切り（fetch が signal を無視しても打ち切る）、redirect は追わない。
 async function post(url:string,secret:string,subId:string,messageId:string,body:string,readBody:boolean):Promise<Posted>{
  const signedAt=Math.floor(deps.now()/1000);
  const headers={
   'Content-Type':'application/json',
   'webhook-id':messageId,
   'webhook-timestamp':String(signedAt),
   'webhook-signature':signature(secret,messageId,signedAt,body),
   'X-MCP-Subscription-Id':subId
  };
  const controller=new AbortController();
  let status=null as number|null;
  let timedOut=false;
  let timer:unknown;
  const deadline=new Promise<never>((_,reject)=>{
   timer=deps.setTimer(()=>{timedOut=true;controller.abort();reject(Error('timeout'));},CALLBACK_TIMEOUT_MS);
  });
  deadline.catch(()=>{});
  const work=(async():Promise<string|null>=>{
   const response=await deps.fetch(url,{method:'POST',redirect:'manual',signal:controller.signal,headers,body});
   if(!(response.status>=100&&response.status<=599))throw Error('bad_status');
   status=response.status;
   if(readBody&&response.status>=200&&response.status<300)return await boundedText(response);
   response.body?.cancel().catch(()=>{});
   return null;
  })();
  work.catch(()=>{});
  try{
   const text=await Promise.race([work,deadline]);
   return {status,reason:null,text};
  }catch(error){
   return {status,reason:timedOut?'timeout':(error as Error)?.message==='too_large'?'too_large':'network',text:null};
  }finally{deps.clearTimer(timer);}
 }

 function sameChallenge(text:string|null,challenge:string):boolean{
  let parsed:unknown;
  try{parsed=JSON.parse(text??'');}catch{return false;}
  const echo=isObject(parsed)?parsed.challenge:undefined;
  if(typeof echo!=='string')return false;
  const a=Buffer.from(echo),b=Buffer.from(challenge);
  return a.length===b.length&&timingSafeEqual(a,b);
 }
 // callback の確認。成功なら null、失敗なら理由（challenge_failed、timeout、http_<状態>、network）。
 async function verify(url:string,secret:string,subId:string):Promise<string|null>{
  const challenge=randomBytes(24).toString('base64url');
  const body=JSON.stringify({type:'verification',challenge});
  const startedAt=deps.now();
  const r=await post(url,secret,subId,'msg_verification_'+randomBytes(12).toString('hex'),body,true);
  const durationMs=Math.max(0,deps.now()-startedAt);
  const reason=r.reason??(r.status!==null&&r.status>=200&&r.status<300?(sameChallenge(r.text,challenge)?null:'challenge_failed'):`http_${r.status}`);
  record({kind:'verification',method:'(verification)',callback_host:CALLBACK_HOST,result:reason?'failed':'ok',...(reason?{reason}:{}),http_status:r.status,duration_ms:durationMs});
  return reason;
 }

 function skipped(reason:string){record({kind:'delivery',method:'(delivery)',callback_host:CALLBACK_HOST,result:'skipped',reason,http_status:null});}
 // 通知 1 件。送り直さない（測定なので、失敗は記録して終わり）。
 async function notify(){
  const sub=subs.get(notifyTarget);
  if(!sub){skipped('no_subscription');return;}
  if(sub.expiresAt<=deps.now()){skipped('expired');return;}
  // 送る直前に「1 回だけ」の印を取る。他の実行が先に取っていた、または取れなかったなら送らない。
  const reserved=deps.reserve();
  if(reserved!=='reserved'){skipped(reserved==='taken'?'already_sent':'reserve_failed');return;}
  const eventId='evt_m2_'+randomBytes(8).toString('hex');
  // 本文のバイト列を 1 回だけ作り、その同じ文字列に署名して、その同じ文字列を送る。
  const body=JSON.stringify({eventId,name:EVENT_NAME,timestamp:iso(deps.now()),data:{id:'m2-test-1'},cursor:null});
  // 要求を出す前に 1 行書く。要求の最中にプロセスが終わっても、送ろうとしたことが残る。
  record({kind:'delivery',method:'(delivery)',callback_host:CALLBACK_HOST,result:'attempt',http_status:null});
  const r=await post(sub.url,sub.secret,sub.id,eventId,body,false);
  const reason=r.reason??(r.status===null?'network':r.status>=200&&r.status<300?null:`http_${r.status}`);
  record({kind:'delivery',method:'(delivery)',callback_host:CALLBACK_HOST,result:reason?'failed':'delivered',...(reason?{reason}:{}),http_status:r.status});
 }
 function arm(id:string){
  if(armed||ended)return;
  armed=true;
  notifyTarget=id;
  notifyTimer=deps.setTimer(()=>{
   notifyTimer=null;
   track(notify().catch(()=>{record({kind:'delivery',method:'(delivery)',callback_host:CALLBACK_HOST,result:'failed',reason:'internal',http_status:null});}));
  },NOTIFY_DELAY_MS);
 }

 // 購読の作成と更新。同じ識別子で期限内なら、同じ secret の更新は確認をやり直さず期限だけ延ばす。secret が変われば新しい secret で確認し、失敗したら購読を消す。
 async function register(id:string,url:string,secret:string,grant:number):Promise<{renewal:boolean;refreshBefore:string}|{reason:string}>{
  const now=deps.now();
  const existing=subs.get(id);
  const live=existing&&existing.expiresAt>now?existing:undefined;
  if(live&&live.secret===secret){
   live.expiresAt=now+grant;
   return {renewal:true,refreshBefore:iso(live.expiresAt)};
  }
  const reason=await verify(url,secret,id);
  if(reason){subs.delete(id);return {reason};}
  const at=deps.now();
  subs.set(id,{id,url,secret,expiresAt:at+grant});
  arm(id);
  return {renewal:live!==undefined,refreshBefore:iso(at+grant)};
 }

 async function dispatch(line:string,state:{answered:boolean}){
  let msg:unknown;
  try{msg=JSON.parse(line);}
  catch{
   record({kind:'invalid',method:'(parse_error)',reply:'error',error_code:-32700});
   send({id:null,error:{code:-32700,message:'Parse error'}});
   return;
  }
  if(!isObject(msg)){
   record({kind:'invalid',method:'(not_object)',reply:'error',error_code:-32600});
   send({id:null,error:{code:-32600,message:'Invalid Request'}});
   return;
  }
  if(typeof msg.method!=='string'){
   // クライアントからの応答など。中身は読まない。
   record({kind:'response',method:'(response)',reply:'none'});
   return;
  }
  const params=isObject(msg.params)?msg.params:{};
  const id=msg.id;
  const isRequest=typeof id==='string'||typeof id==='number';
  const method=msg.method;
  const base:Obj={kind:isRequest?'request':'notification',method:methodName(method),has_id:isRequest};
  const reply=(fields:Obj,message:Obj)=>{
   const isError='error' in message;
   record({...base,...fields,reply:isRequest?(isError?'error':'result'):'none',...(isRequest&&isError?{error_code:(message.error as Obj).code}:{})});
   if(isRequest){state.answered=true;send({id,...message});}
  };
  const ok=(result:Obj)=>({result:{resultType:'complete',...result}});
  const fail=(code:number,message:string,data?:Obj)=>({error:{code,message,...(data?{data}:{})}});
  const notFound=()=>fail(-32601,'Method not found');

  switch(method){
   case 'initialize':
    reply({},{result:{protocolVersion:VERSION,supportedVersions:[VERSION],capabilities,serverInfo:SERVER_INFO}});
    return;
   case 'server/discover':
    reply({},ok({...CACHE,supportedVersions:[VERSION],capabilities,_meta:{'io.modelcontextprotocol/serverInfo':SERVER_INFO}}));
    return;
   case 'ping':
    reply({},{result:{}});
    return;
   case 'tools/list':
    reply({},ok({...CACHE,tools:[tool]}));
    return;
   case 'tools/call':
    if(params.name==='ping')reply({},ok({content:[{type:'text',text:'pong'}],isError:false}));
    else reply({},fail(-32602,'Unknown tool'));
    return;
   case 'events/list':
    reply({},ok({...CACHE,events:[eventDefinition]}));
    return;
   case 'events/subscribe':
   case 'events/unsubscribe':{
    const delivery=isObject(params.delivery)?params.delivery:{};
    const fields:Obj={
     event:typeof params.name==='string'?(params.name===EVENT_NAME?EVENT_NAME:'(other)'):null,
     delivery_mode:typeof delivery.mode==='string'?(delivery.mode==='webhook'?'webhook':'(other)'):null,
     callback_host:hostOf(delivery.url),
     has_secret:typeof delivery.secret==='string'&&delivery.secret.length>0
    };
    if(method==='events/unsubscribe'){
     // 見つからない購読の解除も成功として返す（冪等）。
     let removed=false;
     if(params.name===EVENT_NAME&&typeof delivery.url==='string'){
      let key:string|null=null;
      try{key=identityOf(delivery.url,isObject(params.arguments)?params.arguments:{});}catch{/* 深すぎる引数は、どの購読とも一致しない */}
      if(key!==null){
       const target=key;
       await locked(target,async()=>{removed=subs.delete(target);});
      }
     }
     reply({...fields,removed},ok({}));
     return;
    }
    const parsed=parseSubscription(params);
    if('reason' in parsed){
     reply({...fields,accepted:false,reason:parsed.reason},fail(-32602,'Invalid params'));
     return;
    }
    const subId=identityOf(parsed.url,parsed.args);
    const outcome=await locked(subId,()=>register(subId,parsed.url,parsed.secret,parsed.grant));
    if('reason' in outcome)reply({...fields,accepted:false,reason:outcome.reason},fail(-32015,'Callback endpoint error',{reason:outcome.reason}));
    else reply({...fields,accepted:true,renewal:outcome.renewal},ok({id:subId,refreshBefore:outcome.refreshBefore,cursor:null,truncated:false}));
    return;
   }
   default:
    reply({},notFound());
  }
 }

 // 1 行の処理で想定外の例外が出ても、共有している子プロセスは落とさない。id が取れて、まだ答えていなければ定数のエラーを返す。
 async function handle(line:string){
  const state={answered:false};
  try{await dispatch(line,state);}
  catch{
   let id:string|number|null=null;
   try{
    const parsed:unknown=JSON.parse(line);
    if(isObject(parsed)&&(typeof parsed.id==='string'||typeof parsed.id==='number'))id=parsed.id;
   }catch{/* id は取れなかった */}
   const answer=id!==null&&!state.answered;
   record({kind:'internal_error',method:'(internal_error)',has_id:id!==null,reply:answer?'error':'none',...(answer?{error_code:-32603}:{})});
   if(answer)send({id,error:{code:-32603,message:'Internal error'}});
  }
 }

 record({kind:'lifecycle',method:'(start)',pid:process.pid,node:process.version});

 return {
  // 確認の最中でも他の行を止めない。呼び出し側は待たなくてよい。
  handleLine(line:string):Promise<void>{
   const p=handle(line);
   track(p);
   return p;
  },
  tooLarge(){
   record({kind:'invalid',method:'(too_large)',reply:'error',error_code:-32600});
   send({id:null,error:{code:-32600,message:'Request too large'}});
  },
  // 想定外の例外が処理の外へ漏れたとき。名前だけを記録する。
  uncaught(name:string){record({kind:'lifecycle',method:'(uncaught)',error_name:name});},
  // 入力の終わり。仕掛け中の通知は取り消し、処理中のものが終わるのを待ち、その後は何も仕掛けない。
  async close(){
   ended=true;
   if(notifyTimer!==null){
    deps.clearTimer(notifyTimer);
    notifyTimer=null;
    skipped('stdin_end');
   }
   await Promise.allSettled([...inflight]);
   record({kind:'lifecycle',method:'(stdin_end)'});
  }
 };
}

function parseOptions(argv:string[]):{log:string}{
 let log='';
 for(let i=0;i<argv.length;i++){
  const a=argv[i];
  if(a==='--log'){const v=argv[++i];if(v===undefined)throw Error('log_path_required');log=v;}
  else if(a.startsWith('--log='))log=a.slice(6);
  else throw Error('unknown_argument');
 }
 if(!log)throw Error('log_path_required');
 if(!isAbsolute(log))throw Error('log_path_not_absolute');
 return {log};
}

// 通知を送る直前に取る「1 回だけ」の印。空の 0600 ファイルを O_EXCL で作る。もうあれば別の実行が先に取った（taken）。symlink は辿らない。作れなければ error。
export function reserveFile(path:string):'reserved'|'taken'|'error'{
 try{
  closeSync(openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600));
  return 'reserved';
 }catch(e){return (e as NodeJS.ErrnoException).code==='EEXIST'?'taken':'error';}
}

// 記録ファイルは本人だけが読める 0600 の通常ファイル 1 つ。symlink は辿らず、無ければ作り、親のディレクトリは作らない。
function openLog(path:string):number{
 try{
  const before=lstatSync(path);
  if(before.isSymbolicLink()||!before.isFile())throw Error('log_unusable');
 }catch(e){
  if((e as NodeJS.ErrnoException).code!=='ENOENT')throw Error('log_unusable');
 }
 let fd:number;
 try{fd=openSync(path,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600);}catch{throw Error('log_unusable');}
 try{
  const st=fstatSync(fd);
  if(!st.isFile()||st.uid!==process.getuid?.())throw Error('log_unusable');
  fchmodSync(fd,0o600);
 }catch{closeSync(fd);throw Error('log_unusable');}
 return fd;
}

function main(){
 let options:{log:string};
 try{options=parseOptions(process.argv.slice(2));}
 catch(e){
  process.stderr.write(`m2-notify: 起動を拒否した（${(e as Error).message}）。--log <絶対パス> で記録ファイルを指定する。\n`);
  process.exit(2);
 }
 let fd:number;
 try{fd=openLog(options.log);}
 catch(e){process.stderr.write(`m2-notify: 起動を拒否した（${(e as Error).message}）。\n`);process.exit(2);}

 process.stdout.on('error',()=>process.exit(0));
 const server=createNotify({
  // 実行時の fetch を取るのは、起動の配線のここ 1 か所だけ。
  fetch:(url,init)=>globalThis.fetch(url,init),
  now:Date.now,
  setTimer:(fn,ms)=>setTimeout(fn,ms),
  clearTimer:handle=>clearTimeout(handle as NodeJS.Timeout),
  write:line=>{try{writeSync(fd,line);}catch{process.stderr.write('m2-notify: 記録の書き込みに失敗した\n');process.exit(1);}},
  send:line=>{process.stdout.write(line);},
  reserve:()=>reserveFile(options.log+'.sent')
 });
 // それでも漏れた例外は、名前だけを記録して終わる。スタックやメッセージは書かない。
 process.on('uncaughtException',(e:unknown)=>{
  const name=isObject(e)&&typeof e.name==='string'&&/^[A-Za-z]{1,40}$/.test(e.name)?e.name:'(other)';
  try{server.uncaught(name);}catch{/* 記録できなくても終わる */}
  process.exit(1);
 });

 let buffer='';
 let discarding=false;
 process.stdin.setEncoding('utf8');
 process.stdin.on('data',(chunk:string)=>{
  buffer+=chunk;
  let i:number;
  while((i=buffer.indexOf('\n'))>=0){
   const line=buffer.slice(0,i).replace(/\r$/,'');
   buffer=buffer.slice(i+1);
   if(discarding){discarding=false;server.tooLarge();continue;}
   if(line.length>MAX_LINE){server.tooLarge();continue;}
   if(line.trim()!=='')void server.handleLine(line);
  }
  if(buffer.length>MAX_LINE){buffer='';discarding=true;}
 });
 process.stdin.on('end',()=>{
  if(!discarding&&buffer.trim()!=='')void server.handleLine(buffer);
  void server.close().then(()=>closeSync(fd));
 });
}

// 試験が import したときは起動しない。node で直接起動されたときだけ main を走らせる。
function isEntry():boolean{
 try{return process.argv[1]!==undefined&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url);}
 catch{return false;}
}
if(isEntry())main();
