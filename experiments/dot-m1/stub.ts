// M1 測定用スタブ。tunnel-client の --mcp-command（stdio）から起動され、届いたものを記録する。
// 呼び出されたことと、何が届いたか（キーの名前と指紋）だけを記録する。値、本文、URL の全体は書かない。
// ネットワーク処理は持たない。events/subscribe を受けても callback へ POST しない。
import {createHmac,randomBytes} from 'node:crypto';
import {closeSync,constants,fchmodSync,fstatSync,lstatSync,openSync,writeSync} from 'node:fs';
import {isAbsolute} from 'node:path';

type Obj=Record<string,unknown>;

const VERSION='2026-07-28';
const SERVER_INFO={name:'seamless-dot-m1-stub',version:'0.0.0'};
const EVENT_NAME='m1.probe.created';
const MAX_LINE=1024*1024;
const MAX_META_KEYS=64;
// 2026-07-28 の DiscoverResult と ListToolsResult は ttlMs と cacheScope が必須（CacheableResult）。60 秒にして、Dot と Chat の間（1 分以上空ける）で discover が取り直されるようにする。
const CACHE={ttlMs:60_000,cacheScope:'private'};
const META_PROTOCOL='io.modelcontextprotocol/protocolVersion';
const META_CLIENT='io.modelcontextprotocol/clientInfo';
const META_CAPS='io.modelcontextprotocol/clientCapabilities';
const KNOWN_METHODS=new Set(['initialize','notifications/initialized','notifications/cancelled','ping','server/discover','tools/list','tools/call','events/list','events/subscribe','events/unsubscribe','resources/list','prompts/list','subscriptions/listen']);
// 名前に認証情報らしい語を含むキーや値は、名前ごと記録に出さない。
const CREDENTIAL_LIKE=/authoriz|secret|token|passw|cookie|credential|bearer|signature|api[-_]?key/i;
const KEY_NAME=/^[A-Za-z0-9][A-Za-z0-9_./:@-]{0,79}$/;
const LABEL=/^[A-Za-z0-9][A-Za-z0-9 _./:+@()-]{0,63}$/;
const METHOD_SHAPE=/^[a-z][a-z0-9]*(?:[/_.-][a-z][a-z0-9]*){0,3}$/;

type Options={log:string;noTools:boolean;acceptSubscribe:boolean};

function parseOptions(argv:string[],env:NodeJS.ProcessEnv):Options{
 let log=env.M1_LOG??'';
 let noTools=false;
 let acceptSubscribe=false;
 for(let i=0;i<argv.length;i++){
  const a=argv[i];
  if(a==='--no-tools')noTools=true;
  else if(a==='--accept-subscribe')acceptSubscribe=true;
  else if(a==='--log'){const v=argv[++i];if(v===undefined)throw Error('log_path_required');log=v;}
  else if(a.startsWith('--log='))log=a.slice(6);
  else throw Error('unknown_argument');
 }
 if(!log)throw Error('log_path_required');
 if(!isAbsolute(log))throw Error('log_path_not_absolute');
 return {log,noTools,acceptSubscribe};
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

const isObject=(v:unknown):v is Obj=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const label=(v:unknown):string|null=>typeof v==='string'&&LABEL.test(v)&&!CREDENTIAL_LIKE.test(v)?v:null;
const keyName=(k:string):string=>CREDENTIAL_LIKE.test(k)?'(redacted-key)':KEY_NAME.test(k)?k:'(unsafe-key)';
const methodName=(m:unknown):string=>typeof m!=='string'?'(none)':KNOWN_METHODS.has(m)?m:m.length<=48&&METHOD_SHAPE.test(m)?m:'(other)';

function hostOf(url:unknown):string|null{
 if(typeof url!=='string')return null;
 try{
  const host=new URL(url).hostname;
  return host.length>0&&host.length<=253&&/^[a-z0-9._:[\]-]+$/.test(host)?host:'(invalid)';
 }catch{return '(invalid)';}
}

function main(){
 let options:Options;
 try{options=parseOptions(process.argv.slice(2),process.env);}
 catch(e){
  process.stderr.write(`m1-stub: 起動を拒否した（${(e as Error).message}）。--log <絶対パス> か環境変数 M1_LOG で記録ファイルを指定する。\n`);
  process.exit(2);
 }
 let fd:number;
 try{fd=openLog(options.log);}
 catch(e){process.stderr.write(`m1-stub: 起動を拒否した（${(e as Error).message}）。\n`);process.exit(2);}

 // salt は実行ごとの乱数で、メモリの中だけに置く。記録しない。
 // tunnel-client は stdio の子プロセスを全ての論理接続で共有するので、1 回の実行の中の指紋は比べられる。
 const salt=randomBytes(32);
 const run=randomBytes(4).toString('hex');
 let seq=0;
 // 深い入れ子の値は JSON.stringify が RangeError を投げる。固定の文字列に置き換えて指紋を取り、子プロセスを落とさない。
 const fp=(v:unknown):string=>{
  let text:string;
  try{text=typeof v==='string'?v:(JSON.stringify(v)??'undefined');}catch{text='(unhashable)';}
  return createHmac('sha256',salt).update(text).digest('hex').slice(0,8);
 };

 function record(fields:Obj){
  const line=JSON.stringify({v:1,run,seq:++seq,t:new Date().toISOString(),...fields})+'\n';
  try{writeSync(fd,line);}catch{process.stderr.write('m1-stub: 記録の書き込みに失敗した\n');process.exit(1);}
 }
 function send(message:Obj){process.stdout.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');}
 process.stdout.on('error',()=>process.exit(0));

 const capabilities:Obj={...(options.noTools?{}:{tools:{}}),events:{},extensions:{'io.modelcontextprotocol/events':{}}};
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

 // 届いた _meta の要約。キーの名前、subject と session の指紋、そのほかの値の指紋（値そのものは書かない）。
 function describeMeta(msg:Obj,params:Obj):Obj{
  const sources=[params._meta,msg._meta].filter(isObject);
  const names=new Set<string>();
  const fps:Record<string,string>={};
  const hiddenKeys:string[]=[];
  let subject:string|null=null;
  let session:string|null=null;
  let truncated=false;
  let count=0;
  for(const source of sources){
   for(const [k,v] of Object.entries(source)){
    if(++count>MAX_META_KEYS){truncated=true;break;}
    const name=keyName(k);
    names.add(name);
    if(name!==k){hiddenKeys.push(fp(k));continue;}
    if(k==='openai/subject')subject=fp(v);
    else if(k==='openai/session')session=fp(v);
    else fps[k]=fp(v);
   }
  }
  // 名前を伏せたキー（認証らしい語を含む、または変な文字を含む）は、個数と、名前の HMAC の先頭 8 桁だけを残す。Dot 専用のキーがここに入っても、個数と Dot と Chat の差は読める。
  return {meta_keys:[...names].sort(),redacted_key_count:hiddenKeys.length,redacted_key_fp:hiddenKeys.sort(),subject,session,meta_fp:fps,...(truncated?{meta_truncated:true}:{})};
 }
 function describeClient(params:Obj):Obj{
  const meta=isObject(params._meta)?params._meta:{};
  const info=isObject(meta[META_CLIENT])?meta[META_CLIENT]:isObject(params.clientInfo)?params.clientInfo:null;
  const protocol=meta[META_PROTOCOL]??params.protocolVersion;
  const caps=isObject(meta[META_CAPS])?meta[META_CAPS]:isObject(params.capabilities)?params.capabilities:null;
  const capNames:string[]=[];
  if(caps){
   for(const [k,v] of Object.entries(caps)){
    capNames.push(keyName(k));
    if(k==='extensions'&&isObject(v))for(const e of Object.keys(v))capNames.push('extensions/'+keyName(e));
   }
  }
  return {
   protocol:typeof protocol==='string'?(/^\d{4}-\d{2}-\d{2}$/.test(protocol)?protocol:'(other)'):null,
   client:info?{name:label(info.name),version:label(info.version)}:null,
   client_caps:capNames.slice(0,16).sort()
  };
 }

 let answered=false;
 function handleLine(line:string){
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
  const base:Obj={kind:isRequest?'request':'notification',method:methodName(method),has_id:isRequest,...describeMeta(msg,params),...describeClient(params)};
  const reply=(fields:Obj,message:Obj)=>{
   const isError='error' in message;
   record({...base,...fields,reply:isRequest?(isError?'error':'result'):'none',...(isRequest&&isError?{error_code:(message.error as Obj).code}:{})});
   if(isRequest){answered=true;send({id,...message});}
  };
  const ok=(result:Obj)=>({result:{resultType:'complete',...result}});
  const fail=(code:number,message:string)=>({error:{code,message}});
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
    reply({},options.noTools?notFound():ok({...CACHE,tools:[tool]}));
    return;
   case 'tools/call':{
    const name=params.name;
    const fields:Obj={tool:typeof name==='string'?(name==='ping'?'ping':'(other)'):null};
    if(options.noTools)reply(fields,notFound());
    else if(name==='ping')reply(fields,ok({content:[{type:'text',text:'pong'}],isError:false}));
    else reply(fields,fail(-32602,'Unknown tool'));
    return;
   }
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
    if(method==='events/unsubscribe')reply(fields,ok({}));
    else if(options.acceptSubscribe)reply({...fields,accepted:true},ok({id:'m1-'+randomBytes(8).toString('hex'),refreshBefore:new Date(Date.now()+3600_000).toISOString(),cursor:null,truncated:false}));
    else reply({...fields,accepted:false},fail(-32602,'M1 measurement stub: events/subscribe was recorded and not accepted'));
    return;
   }
   default:
    reply({},notFound());
  }
 }

 // 1 行の処理で想定外の例外が出ても、共有している子プロセスは落とさない。id が取れて、まだ答えていなければ定数のエラーを返す。
 function handle(line:string){
  answered=false;
  try{handleLine(line);}
  catch{
   let id:string|number|null=null;
   try{
    const parsed:unknown=JSON.parse(line);
    if(isObject(parsed)&&(typeof parsed.id==='string'||typeof parsed.id==='number'))id=parsed.id;
   }catch{/* id は取れなかった */}
   const reply=id!==null&&!answered;
   record({kind:'internal_error',method:'(internal_error)',has_id:id!==null,reply:reply?'error':'none',...(reply?{error_code:-32603}:{})});
   if(reply)send({id,error:{code:-32603,message:'Internal error'}});
  }
 }
 // それでも漏れた例外は、名前だけを記録して終わる。スタックやメッセージは書かない。
 process.on('uncaughtException',(e:unknown)=>{
  const name=isObject(e)&&typeof e.name==='string'&&/^[A-Za-z]{1,40}$/.test(e.name)?e.name:'(other)';
  try{record({kind:'lifecycle',method:'(uncaught)',error_name:name});}catch{/* 記録できなくても終わる */}
  process.exit(1);
 });

 record({kind:'lifecycle',method:'(start)',pid:process.pid,node:process.version,no_tools:options.noTools,accept_subscribe:options.acceptSubscribe});

 let buffer='';
 let discarding=false;
 const tooLarge=()=>{
  record({kind:'invalid',method:'(too_large)',reply:'error',error_code:-32600});
  send({id:null,error:{code:-32600,message:'Request too large'}});
 };
 process.stdin.setEncoding('utf8');
 process.stdin.on('data',(chunk:string)=>{
  buffer+=chunk;
  let i:number;
  while((i=buffer.indexOf('\n'))>=0){
   const line=buffer.slice(0,i).replace(/\r$/,'');
   buffer=buffer.slice(i+1);
   if(discarding){discarding=false;tooLarge();continue;}
   if(line.length>MAX_LINE){tooLarge();continue;}
   if(line.trim()!=='')handle(line);
  }
  if(buffer.length>MAX_LINE){buffer='';discarding=true;}
 });
 process.stdin.on('end',()=>{
  if(!discarding&&buffer.trim()!=='')handle(buffer);
  record({kind:'lifecycle',method:'(stdin_end)'});
  closeSync(fd);
 });
}

main();
