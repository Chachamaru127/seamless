import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// 偽の JSON-RPC を stdio で流し、応答と記録ファイルを確かめる。実際のネットワーク、ChatGPT、tunnel-client は使わない。
type J=Record<string,any>;
type Cleanup={after:(fn:()=>void)=>void};
type Run={code:number|null;stdout:string;stderr:string;replies:J[];log:string;records:J[];logPath:string;dir:string};

const stubPath=join(dirname(fileURLToPath(import.meta.url)),'stub.ts');
const VERSION='2026-07-28';
const meta=(extra:J={}):J=>({'io.modelcontextprotocol/protocolVersion':VERSION,'io.modelcontextprotocol/clientInfo':{name:'TestClient',version:'1.0.0'},'io.modelcontextprotocol/clientCapabilities':{},...extra});
const req=(id:number|string,method:string,params:J={}):J=>({jsonrpc:'2.0',id,method,params});
const tmp=(t:Cleanup):string=>{const dir=realpathSync(mkdtempSync(join(tmpdir(),'m1-stub-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;};
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const sha256_8=(v:string)=>createHash('sha256').update(v).digest('hex').slice(0,8);

function exec(args:string[],input:(J|string)[],env:Record<string,string>={},cwd?:string,timeoutMs=20000):Promise<{code:number|null;stdout:string;stderr:string}>{
 return new Promise((resolve,reject)=>{
  const base:NodeJS.ProcessEnv={...process.env};
  delete base.M1_LOG;
  const child=spawn(process.execPath,[stubPath,...args],{env:{...base,...env},cwd,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.setEncoding('utf8').on('data',(c:string)=>{stdout+=c;});
  child.stderr.setEncoding('utf8').on('data',(c:string)=>{stderr+=c;});
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('stub did not exit after stdin ended'));},timeoutMs);
  child.on('error',reject);
  child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
  child.stdin.on('error',()=>{});
  child.stdin.end(input.length?input.map(l=>typeof l==='string'?l:JSON.stringify(l)).join('\n')+'\n':'');
 });
}

// 記録ファイルを新しい一時ディレクトリに置いて走らせる。既定は環境変数 M1_LOG で渡す。
async function run(t:Cleanup,args:string[],input:(J|string)[],opts:{via?:'env'|'arg';preexistingMode?:number}={}):Promise<Run>{
 const dir=tmp(t),logPath=join(dir,'m1.jsonl');
 if(opts.preexistingMode!==undefined){writeFileSync(logPath,'',{mode:opts.preexistingMode});chmodSync(logPath,opts.preexistingMode);}
 const via=opts.via??'env';
 const result=await exec(via==='arg'?['--log',logPath,...args]:args,input,via==='env'?{M1_LOG:logPath}:{});
 const log=existsSync(logPath)?readFileSync(logPath,'utf8'):'';
 const lines=(s:string)=>s.split('\n').filter(l=>l.length>0);
 const records=lines(log).map(l=>JSON.parse(l) as J);
 records.forEach(validateRecord);
 return {...result,replies:lines(result.stdout).map(l=>JSON.parse(l) as J),log,records,logPath,dir};
}
const byId=(r:Run,id:number|string):J=>{const found=r.replies.find(m=>m.id===id);assert.ok(found,`no reply for id ${id}`);return found;};
const calls=(r:Run,method:string):J[]=>r.records.filter(x=>x.method===method);

// 記録の許可名簿。黒名簿（特定の値が無いこと）だけだと、将来の変更で別の欄が漏れても気づけない。
// 宣言していない欄があれば落とし、宣言した欄も、値の形が決まった形のどれかに合うものだけを通す。
const HEX8=/^[0-9a-f]{8}$/;
const KEY_NAME=/^[A-Za-z0-9][A-Za-z0-9_./:@-]{0,79}$/;
const LABEL=/^[A-Za-z0-9][A-Za-z0-9 _./:+@()-]{0,63}$/;
const METHOD_SHAPE=/^[a-z][a-z0-9]*(?:[/_.-][a-z][a-z0-9]*){0,3}$/;
const isBool=(v:unknown)=>typeof v==='boolean';
const nullOr=(f:(v:any)=>boolean)=>(v:any)=>v===null||f(v);
const strArray=(f:(v:string)=>boolean,max:number)=>(v:any)=>Array.isArray(v)&&v.length<=max&&v.every(x=>typeof x==='string'&&f(x));
const RECORD_FIELDS:Record<string,(v:any)=>boolean>={
 v:v=>v===1,
 run:v=>typeof v==='string'&&HEX8.test(v),
 seq:v=>Number.isInteger(v)&&v>0,
 t:v=>typeof v==='string'&&new Date(v).toISOString()===v,
 kind:v=>['lifecycle','request','notification','response','invalid','internal_error'].includes(v),
 method:v=>typeof v==='string'&&v.length<=48&&(/^\([a-z_]+\)$/.test(v)||METHOD_SHAPE.test(v)),
 reply:v=>['result','error','none'].includes(v),
 error_code:v=>Number.isInteger(v)&&v<0&&v>=-32768,
 has_id:isBool,
 meta_keys:strArray(x=>x==='(redacted-key)'||x==='(unsafe-key)'||KEY_NAME.test(x),64),
 redacted_key_count:v=>Number.isInteger(v)&&v>=0&&v<=64,
 redacted_key_fp:strArray(x=>HEX8.test(x),64),
 subject:nullOr(v=>typeof v==='string'&&HEX8.test(v)),
 session:nullOr(v=>typeof v==='string'&&HEX8.test(v)),
 meta_fp:v=>typeof v==='object'&&v!==null&&!Array.isArray(v)&&Object.entries(v).every(([k,x])=>KEY_NAME.test(k)&&typeof x==='string'&&HEX8.test(x)),
 meta_truncated:v=>v===true,
 protocol:nullOr(v=>typeof v==='string'&&(/^\d{4}-\d{2}-\d{2}$/.test(v)||v==='(other)')),
 client:nullOr(v=>typeof v==='object'&&v!==null&&Object.keys(v).sort().join()==='name,version'&&[v.name,v.version].every((x:unknown)=>x===null||(typeof x==='string'&&LABEL.test(x)))),
 client_caps:strArray(x=>x==='(redacted-key)'||x==='(unsafe-key)'||KEY_NAME.test(x),16),
 tool:nullOr(v=>v==='ping'||v==='(other)'),
 event:nullOr(v=>v==='m1.probe.created'||v==='(other)'),
 delivery_mode:nullOr(v=>v==='webhook'||v==='(other)'),
 callback_host:nullOr(v=>typeof v==='string'&&(v==='(invalid)'||(v.length>0&&v.length<=253&&/^[a-z0-9._:[\]-]+$/.test(v)))),
 has_secret:isBool,
 accepted:isBool,
 pid:v=>Number.isInteger(v)&&v>0,
 node:v=>typeof v==='string'&&/^v\d+\.\d+\.\d+$/.test(v),
 no_tools:isBool,
 accept_subscribe:isBool,
 error_name:v=>typeof v==='string'&&(v==='(other)'||/^[A-Za-z]{1,40}$/.test(v)),
};
function validateRecord(record:J):void{
 for(const [key,value] of Object.entries(record)){
  const check=RECORD_FIELDS[key];
  assert.ok(check,`the record has an undeclared field: ${key}`);
  assert.ok(check(value),`the record field ${key} has a value outside the allowed shapes`);
 }
 assert.equal(/[0-9a-f]{64}/i.test(JSON.stringify(record)),false,'a 64-hex string (looks like a salt or a full digest) is in the record');
}

test('(1) server/discover and initialize both declare 2026-07-28 and events; tools, one ping tool and one event by default',async t=>{
 const r=await run(t,[],[req(1,'server/discover',{_meta:meta()}),req(2,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'Legacy',version:'0.0.9'}}),req(3,'tools/list'),req(4,'events/list')]);
 assert.equal(r.code,0);
 for(const id of [1,2]){
  const result=byId(r,id).result;
  assert.ok(result.supportedVersions.includes(VERSION),`reply ${id} lacks ${VERSION}`);
  assert.deepEqual(result.capabilities.events,{});
  assert.deepEqual(result.capabilities.tools,{});
  assert.deepEqual(result.capabilities.extensions['io.modelcontextprotocol/events'],{});
 }
 assert.equal(byId(r,1).result.resultType,'complete');
 // 2026-07-28 の schema では DiscoverResult と ListToolsResult は CacheableResult（ttlMs と cacheScope が必須）。
 for(const id of [1,3,4]){
  const result=byId(r,id).result;
  assert.equal(typeof result.ttlMs,'number',`reply ${id}: ttlMs`);
  assert.ok(Number.isFinite(result.ttlMs)&&result.ttlMs>=0);
  assert.ok(['public','private'].includes(result.cacheScope),`reply ${id}: cacheScope`);
 }
 assert.equal('ttlMs' in byId(r,2).result,false,'initialize is not a cacheable result');
 assert.equal(byId(r,1).result._meta['io.modelcontextprotocol/serverInfo'].name,'seamless-dot-m1-stub');
 assert.equal(byId(r,2).result.protocolVersion,VERSION);
 assert.equal(byId(r,2).result.serverInfo.name,'seamless-dot-m1-stub');
 const tools=byId(r,3).result.tools;
 assert.deepEqual(tools.map((x:J)=>x.name),['ping']);
 assert.equal(tools[0].inputSchema.type,'object');
 const events=byId(r,4).result.events;
 assert.equal(events.length,1);
 assert.deepEqual(events[0].delivery,['webhook']);
 // 説明が「出ない」と読めると、モデルが監視の依頼を断る材料になる。
 assert.equal(/never|not emitted|does not fire|no events?/i.test(events[0].description),false,'the event description discourages a subscription');
 assert.match(events[0].description,/fires when/i);
 assert.deepEqual(events[0].inputSchema.required??[],[]);
});

test('(2) --no-tools removes the tools capability and rejects tools/*, while events stay',async t=>{
 const r=await run(t,['--no-tools'],[req(1,'server/discover',{_meta:meta()}),req(2,'initialize',{protocolVersion:VERSION}),req(3,'tools/list'),req(4,'tools/call',{name:'ping',arguments:{}}),req(5,'events/list')]);
 assert.equal(r.code,0);
 for(const id of [1,2]){
  const result=byId(r,id).result;
  assert.equal('tools' in result.capabilities,false);
  assert.deepEqual(result.capabilities.events,{});
  assert.ok(result.supportedVersions.includes(VERSION));
 }
 assert.equal(byId(r,3).error.code,-32601);
 assert.equal(byId(r,4).error.code,-32601);
 assert.equal(byId(r,5).result.events.length,1);
 assert.equal(calls(r,'(start)')[0].no_tools,true);
});

test('(3) the log file is mode 0600, also when it already existed with a wider mode, and --log wins over M1_LOG',async t=>{
 const fresh=await run(t,[],[req(1,'ping')]);
 assert.equal(statSync(fresh.logPath).mode&0o777,0o600);
 const wide=await run(t,[],[req(1,'ping')],{preexistingMode:0o644});
 assert.equal(statSync(wide.logPath).mode&0o777,0o600);
 assert.ok(wide.records.length>=3);
 const dir=tmp(t),viaArg=join(dir,'arg.jsonl'),viaEnv=join(dir,'env.jsonl');
 const both=await exec(['--log',viaArg],[req(1,'ping')],{M1_LOG:viaEnv});
 assert.equal(both.code,0);
 assert.equal(statSync(viaArg).mode&0o777,0o600);
 assert.equal(existsSync(viaEnv),false);
 const equals=await exec([`--log=${viaEnv}`],[req(1,'ping')]);
 assert.equal(equals.code,0);
 assert.equal(statSync(viaEnv).mode&0o777,0o600);
});

test('(4) the log holds no raw subject, session, Authorization, secret, argument, user-agent or callback URL values',async t=>{
 const raw=['SUBJ_RAW_7f2k','SESS_RAW_q9z','RAWTOKEN_x1','HDR_RAW_w2','ARG_RAW_k3','UA_RAW_ChatGPT9','RAWSECRET_abc','PASS_RAW_u9','SECRETPATH_RAW','QRY_RAW','BODY_RAW_z','ID_RAW_77','RESP_RAW','CAPS_VALUE_RAW','CLIENT_RAW','SERVERINFO_RAW'];
 const r=await run(t,[],[
  req('ID_RAW_77','tools/call',{name:'ping',arguments:{note:'ARG_RAW_k3'},headers:{Authorization:'Bearer HDR_RAW_w2'},text:'BODY_RAW_z',_meta:meta({'openai/subject':'SUBJ_RAW_7f2k','openai/session':'SESS_RAW_q9z','Authorization':'Bearer RAWTOKEN_x1','openai/userAgent':'UA_RAW_ChatGPT9'})}),
  req(2,'events/subscribe',{name:'seamless.message.created',arguments:{note:'ARG_RAW_k3'},delivery:{mode:'webhook',url:'https://user:PASS_RAW_u9@callback.example.test:8443/hook/SECRETPATH_RAW?token=QRY_RAW',secret:'whsec_RAWSECRET_abc'},_meta:meta({'openai/subject':'SUBJ_RAW_7f2k','Authorization':'Bearer RAWTOKEN_x1'})}),
  {jsonrpc:'2.0',id:3,result:{leak:'RESP_RAW'}},
  req(4,'server/discover',{_meta:{'io.modelcontextprotocol/clientInfo':{name:'CLIENT_RAW_token',version:'1.0'},'io.modelcontextprotocol/clientCapabilities':{sampling:{note:'CAPS_VALUE_RAW'}}}}),
  req(5,'initialize',{clientInfo:{name:'SERVERINFO_RAW Bearer abc',version:'1'}})
 ],{via:'arg'});
 assert.equal(r.code,0);
 const everything=r.log+r.stderr;
 assert.equal(r.stderr,'','nothing on stderr during a normal run');
 assert.equal(/[0-9a-f]{64}/i.test(r.log),false,'no 64-hex string (a salt) in the log');
 const sub=calls(r,'events/subscribe')[0];
 assert.equal(sub.event,'(other)','a caller-chosen event name is not written');
 assert.equal(r.log.includes('seamless.message.created'),false);
 for(const value of raw){
  assert.equal(everything.includes(value),false,`log or stderr leaked ${value}`);
 }
 assert.equal(/authorization/i.test(everything),false,'the word Authorization appears in the log');
 assert.equal(/whsec_|https?:|8443|user:|token=/i.test(r.log),false);
 assert.equal(/authorization|whsec_|secret/i.test(r.stdout),false);
 const call=calls(r,'tools/call')[0];
 assert.match(call.subject,/^[0-9a-f]{8}$/);
 assert.match(call.session,/^[0-9a-f]{8}$/);
 assert.match(call.meta_fp['openai/userAgent'],/^[0-9a-f]{8}$/);
 assert.ok(call.meta_keys.includes('(redacted-key)'));
 assert.equal(call.has_id,true);
 const discover=calls(r,'server/discover')[0],initialize=calls(r,'initialize')[0];
 assert.deepEqual(discover.client,{name:null,version:'1.0'},'a credential-looking client name is dropped');
 assert.deepEqual(discover.client_caps,['sampling']);
 assert.deepEqual(initialize.client,{name:null,version:'1'});
});

test('(5) a subscribe record carries the callback hostname only',async t=>{
 const urls:Record<string,string|undefined>={
  a:'https://user:PASS@Callback.Example.TEST:8443/hook/PATHSEG?token=QRY#frag',
  b:'https://[2001:db8::1]:9/p',
  c:'not a url',
  d:undefined,
  e:'https://xn--r8jz45g.example/',
  f:'https://my_host.example.com/hook',
 };
 const send=(id:number,key:string):J=>req(id,'events/subscribe',{name:'m1.probe.created',arguments:{},delivery:{mode:'webhook',...(urls[key]!==undefined?{url:urls[key]}:{}),secret:'whsec_X'}});
 const r=await run(t,[],[send(1,'a'),send(2,'b'),send(3,'c'),send(4,'d'),send(5,'e'),send(6,'f')]);
 const hosts=calls(r,'events/subscribe').map(x=>x.callback_host);
 assert.deepEqual(hosts,['callback.example.test','[2001:db8::1]','(invalid)',null,'xn--r8jz45g.example','my_host.example.com']);
 for(const record of calls(r,'events/subscribe')){
  const text=JSON.stringify(record);
  for(const forbidden of ['https:','8443','PASS','PATHSEG','QRY','frag','/p"','whsec_','user:'])assert.equal(text.includes(forbidden),false,`subscribe record contains ${forbidden}`);
  assert.equal(record.event,'m1.probe.created');
  assert.equal(record.delivery_mode,'webhook');
  assert.equal(record.has_secret,true);
 }
});

test('(6) subscribe is an error by default and accepted with --accept-subscribe; neither one contacts the callback',async t=>{
 let hits=0;
 const server=createServer((_req,res)=>{hits++;res.statusCode=200;res.end('{}');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 const port=(server.address() as AddressInfo).port;
 const subscribe=req(1,'events/subscribe',{name:'m1.probe.created',arguments:{},delivery:{mode:'webhook',url:`http://127.0.0.1:${port}/hook`,secret:'whsec_X'}});

 const rejected=await run(t,[],[subscribe]);
 assert.equal(rejected.code,0);
 assert.equal('result' in byId(rejected,1),false);
 assert.equal(byId(rejected,1).error.code,-32602);
 const rejectedRecord=calls(rejected,'events/subscribe')[0];
 assert.equal(rejectedRecord.reply,'error');
 assert.equal(rejectedRecord.accepted,false);
 assert.equal(rejectedRecord.callback_host,'127.0.0.1');

 const accepted=await run(t,['--accept-subscribe'],[subscribe]);
 assert.equal(accepted.code,0);
 const result=byId(accepted,1).result;
 assert.equal(typeof result.id,'string');
 assert.ok(result.id.length>0);
 assert.ok(Date.parse(result.refreshBefore)>Date.now());
 assert.equal(result.cursor,null);
 assert.equal(result.truncated,false);
 const acceptedRecord=calls(accepted,'events/subscribe')[0];
 assert.equal(acceptedRecord.reply,'result');
 assert.equal(acceptedRecord.accepted,true);
 assert.equal(accepted.log.includes(result.id),false,'the issued subscription id is not logged');

 await sleep(300);
 assert.equal(hits,0,'the stub contacted the callback');
});

test('(6b) the stub source has no network, process-spawning or fetch capability',()=>{
 const source=readFileSync(stubPath,'utf8');
 assert.equal(/node:(net|http|https|http2|dns|tls|dgram|child_process|worker_threads|cluster)\b/.test(source),false);
 assert.equal(/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/.test(source),false);
 const imports=[...source.matchAll(/from '([^']+)'/g)].map(m=>m[1]).sort();
 assert.deepEqual(imports,['node:crypto','node:fs','node:path']);
});

test('(7) it refuses to start without an explicit, absolute, regular-file log path and creates nothing',async t=>{
 const dir=tmp(t);
 const refused=async(label:string,args:string[],env:Record<string,string>)=>{
  const result=await exec(args,[req(1,'ping')],env,dir);
  assert.equal(result.code,2,`${label}: exit code`);
  assert.equal(result.stdout,'',`${label}: stdout must stay empty`);
  assert.match(result.stderr,/m1-stub/,`${label}: reason on stderr`);
 };
 await refused('no M1_LOG and no --log',[],{});
 assert.deepEqual(readdirSync(dir),[],'a default log file was created');
 await refused('empty M1_LOG',[],{M1_LOG:''});
 await refused('--log without a value',['--log'],{});
 await refused('relative path',['--log','m1.jsonl'],{});
 assert.deepEqual(readdirSync(dir),[]);
 await refused('unknown argument',['--bogus'],{M1_LOG:join(dir,'x.jsonl')});
 assert.equal(existsSync(join(dir,'x.jsonl')),false);
 await refused('missing parent directory',[],{M1_LOG:join(dir,'no-such-dir','m1.jsonl')});
 assert.equal(existsSync(join(dir,'no-such-dir')),false,'the parent directory was created');
 mkdirSync(join(dir,'a-directory'));
 await refused('path is a directory',[],{M1_LOG:join(dir,'a-directory')});
 writeFileSync(join(dir,'target.jsonl'),'');
 symlinkSync(join(dir,'target.jsonl'),join(dir,'link.jsonl'));
 await refused('symlink',[],{M1_LOG:join(dir,'link.jsonl')});
 assert.equal(readFileSync(join(dir,'target.jsonl'),'utf8'),'','the symlink target was written');
 symlinkSync(join(dir,'dangling-target'),join(dir,'dangling.jsonl'));
 await refused('dangling symlink',[],{M1_LOG:join(dir,'dangling.jsonl')});
 assert.equal(existsSync(join(dir,'dangling-target')),false,'the dangling symlink target was created');
});

test('(8) subject and session are 8-hex HMAC prefixes: stable within a run, distinct per value, salted per run',async t=>{
 const call=(id:number,subject:string,session:string):J=>req(id,'tools/call',{name:'ping',_meta:meta({'openai/subject':subject,'openai/session':session})});
 const input=[call(1,'S-one','C-one'),call(2,'S-one','C-two'),call(3,'S-two','C-one')];
 const a=await run(t,[],input);
 const [x,y,z]=calls(a,'tools/call');
 for(const value of [x.subject,x.session,y.session,z.subject])assert.match(value,/^[0-9a-f]{8}$/);
 assert.equal(x.subject,y.subject);
 assert.notEqual(x.subject,z.subject);
 assert.equal(x.session,z.session);
 assert.notEqual(x.session,y.session);
 assert.notEqual(x.subject,sha256_8('S-one'),'looks like an unsalted hash');
 assert.notEqual(x.subject,createHash('sha1').update('S-one').digest('hex').slice(0,8));
 assert.notEqual(x.subject,createHash('md5').update('S-one').digest('hex').slice(0,8));
 const b=await run(t,[],input);
 assert.notEqual(calls(b,'tools/call')[0].subject,x.subject,'the salt must differ between runs');
 assert.notEqual(b.records[0].run,a.records[0].run);
 assert.equal(a.records.every(rec=>rec.run===a.records[0].run),true);
 assert.equal(a.log.includes('S-one'),false);
 assert.equal(a.log.includes('C-two'),false);
});

test('(9) _meta key names are logged sorted; credential-looking and odd names are replaced; other values only as fingerprints',async t=>{
 const call=(id:number,flag:string):J=>req(id,'tools/call',{name:'ping',_meta:{'x-test/dot-flag':flag,'openai/subject':'s','openai/session':'c','Authorization':'Bearer A','api_key':'K','x-secret':'S','bad key!':'B','openai/locale':'ja-JP'}});
 const r=await run(t,[],[call(1,'DOTFLAG_ONE'),call(2,'DOTFLAG_TWO'),req(3,'tools/call',{name:'ping'})]);
 const [first,second,none]=calls(r,'tools/call');
 assert.deepEqual(first.meta_keys,['(redacted-key)','(unsafe-key)','openai/locale','openai/session','openai/subject','x-test/dot-flag']);
 assert.notEqual(first.meta_fp['x-test/dot-flag'],second.meta_fp['x-test/dot-flag']);
 assert.equal(first.meta_fp['openai/locale'],second.meta_fp['openai/locale']);
 assert.equal('openai/subject' in first.meta_fp,false,'subject has its own field');
 // 伏せたキー（Authorization、api_key、x-secret、bad key!）は名前を出さず、個数と名前の指紋だけ残す。
 for(const rec of [first,second]){
  assert.equal(rec.redacted_key_count,4);
  assert.equal(rec.redacted_key_fp.length,4);
  assert.equal(new Set(rec.redacted_key_fp).size,4,'four different names, four different fingerprints');
  for(const x of rec.redacted_key_fp)assert.match(x,/^[0-9a-f]{8}$/);
 }
 assert.deepEqual(first.redacted_key_fp,second.redacted_key_fp,'the same names give the same fingerprints within a run');
 assert.equal(none.redacted_key_count,0);
 assert.deepEqual(none.redacted_key_fp,[]);
 assert.deepEqual(none.meta_keys,[]);
 assert.equal(none.subject,null);
 assert.equal(none.session,null);
 assert.equal(r.log.includes('DOTFLAG'),false);
 assert.equal(r.log.includes('ja-JP'),false);
 assert.equal(/api_key|x-secret|bad key/.test(r.log),false);
});

test('(10) every subscribe after an error is logged separately; unsubscribe is logged and accepted',async t=>{
 const subscribe=(id:number):J=>req(id,'events/subscribe',{name:'m1.probe.created',arguments:{},delivery:{mode:'webhook',url:'https://cb.example.test/x',secret:'whsec_X'}});
 const r=await run(t,[],[subscribe(1),subscribe(2),subscribe(3),req(4,'events/unsubscribe',{name:'m1.probe.created',arguments:{},delivery:{mode:'webhook',url:'https://cb.example.test/x'}})]);
 const subs=calls(r,'events/subscribe');
 assert.equal(subs.length,3);
 assert.deepEqual(subs.map(x=>x.reply),['error','error','error']);
 assert.ok(subs[0].seq<subs[1].seq&&subs[1].seq<subs[2].seq);
 assert.ok(subs.every(x=>typeof x.t==='string'&&!Number.isNaN(Date.parse(x.t))));
 for(const id of [1,2,3])assert.equal(byId(r,id).error.code,-32602);
 for(const sub of subs)assert.equal(sub.error_code,-32602,'the code that was returned is in the record');
 assert.deepEqual(byId(r,4).result,{resultType:'complete'});
 const unsub=calls(r,'events/unsubscribe')[0];
 assert.equal(unsub.callback_host,'cb.example.test');
 assert.equal(unsub.reply,'result');
});

test('(11) protocol hygiene: unknown methods, notifications, parse errors, client responses and oversized lines',async t=>{
 const huge='{"jsonrpc":"2.0","id":99,"method":"tools/call","params":{"x":"'+'a'.repeat(1_100_000)+'"}}';
 const r=await run(t,[],[
  {jsonrpc:'2.0',method:'notifications/initialized'},
  {jsonrpc:'2.0',method:'some/unknown_notification'},
  req(1,'Weird/Method_WithCaps123'),
  req(2,'resources/list'),
  req('str-id','ping'),
  'this is not json',
  '[1,2,3]',
  {jsonrpc:'2.0',id:5,result:{leak:'RESP_RAW'}},
  huge,
  req(6,'ping')
 ]);
 assert.equal(r.code,0);
 assert.equal(r.stderr,'','nothing on stderr, also for broken input');
 assert.equal(/[0-9a-f]{64}/i.test(r.log),false,'no 64-hex string (a salt) in the log');
 assert.equal(byId(r,1).error.code,-32601);
 assert.equal(byId(r,2).error.code,-32601);
 assert.deepEqual(byId(r,'str-id').result,{});
 assert.deepEqual(byId(r,6).result,{});
 const nullIds=r.replies.filter(m=>m.id===null).map(m=>m.error.code);
 assert.deepEqual(nullIds,[-32700,-32600,-32600]);
 assert.equal(r.replies.length,7,'notifications and client responses must get no reply');
 assert.equal(r.replies.every(m=>m.jsonrpc==='2.0'),true);
 const methods=r.records.map(x=>x.method);
 assert.ok(methods.includes('notifications/initialized'));
 assert.ok(methods.includes('some/unknown_notification'));
 assert.ok(methods.includes('(other)'));
 assert.ok(methods.includes('(parse_error)'));
 assert.ok(methods.includes('(response)'));
 assert.ok(methods.includes('(too_large)'));
 assert.equal(r.log.includes('RESP_RAW'),false);
 assert.equal(r.log.includes('Weird'),false);
 assert.equal(r.records.find(x=>x.method==='notifications/initialized')!.reply,'none');
});

test('(12) the ping tool returns one constant and the log keeps only the tool name',async t=>{
 const r=await run(t,[],[req(1,'tools/call',{name:'ping',arguments:{a:1}}),req(2,'tools/call',{name:'ping',arguments:{a:2}}),req(3,'tools/call',{name:'steal_secrets_RAW',arguments:{}}),req(4,'tools/call',{})]);
 assert.deepEqual(byId(r,1).result,byId(r,2).result);
 assert.equal(byId(r,1).result.content[0].text,'pong');
 assert.equal(byId(r,1).result.isError,false);
 assert.equal(byId(r,3).error.code,-32602);
 assert.deepEqual(calls(r,'tools/call').map(x=>x.tool),['ping','ping','(other)',null]);
 assert.equal(r.log.includes('steal_secrets_RAW'),false);
});

test('(13) it writes a start and an end record and exits when stdin closes',async t=>{
 const r=await run(t,['--no-tools','--accept-subscribe'],[]);
 assert.equal(r.code,0);
 assert.equal(r.stdout,'');
 assert.equal(r.records.length,2);
 assert.equal(r.records[0].method,'(start)');
 assert.equal(r.records[0].no_tools,true);
 assert.equal(r.records[0].accept_subscribe,true);
 assert.equal(r.records[1].method,'(stdin_end)');
 assert.deepEqual(r.records.map(x=>x.seq),[1,2]);
});

test('(14) a deeply nested _meta value does not take the shared process down; the next request is answered',async t=>{
 // run() は object を JSON.stringify するので、深い入れ子は文字列のまま 1 行にして流す（約 400KB、1MiB 未満）。
 const depth=200000;
 const deep=(id:number,key:string)=>`{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"ping","_meta":{"${key}":${'['.repeat(depth)}${']'.repeat(depth)}}}}`;
 assert.ok(deep(1,'openai/session').length<1024*1024);
 const r=await run(t,[],[deep(1,'openai/session'),deep(2,'x-test/deep'),req(3,'tools/call',{name:'ping',_meta:meta({'openai/session':'AFTER_DEEP'})}),req(4,'ping')]);
 assert.equal(r.code,0,'the process must not crash');
 assert.equal(r.stderr,'');
 for(const id of [1,2,3])assert.equal(byId(r,id).result.content[0].text,'pong');
 assert.deepEqual(byId(r,4).result,{});
 const [a,b,c]=calls(r,'tools/call');
 assert.match(a.session,/^[0-9a-f]{8}$/);
 assert.match(b.meta_fp['x-test/deep'],/^[0-9a-f]{8}$/);
 assert.match(c.session,/^[0-9a-f]{8}$/);
 assert.notEqual(c.session,a.session);
 assert.equal(calls(r,'(stdin_end)').length,1,'the end of the run is recorded');
 assert.equal(r.records.some(x=>x.kind==='internal_error'),false,'the fingerprint code handles it without an internal error');
});

// 想定外の例外を起こすための前読み（--import）。試験用の一時ディレクトリに書く。本体のコードには試験用の分岐を入れない。
// Object.entries が印のついた _meta を受けたら 1 回だけ投げる。第 2 の印があれば、続く Date.prototype.toISOString も 1 回だけ投げる（記録の書き込みも失敗させる）。
const HOOK=`
const entries=Object.entries;
const toISOString=Date.prototype.toISOString;
let armed=false;
Object.entries=function(o){
 if(o&&typeof o==='object'){
  if('__m1_boom__' in o)throw new RangeError('boom with a secret-looking message Bearer HOOK_RAW');
  if('__m1_boom_twice__' in o){armed=true;throw new TypeError('boom twice HOOK_RAW');}
 }
 return entries(o);
};
Date.prototype.toISOString=function(){
 if(armed){armed=false;throw new RangeError('second boom HOOK_RAW');}
 return toISOString.call(this);
};
`;
function hookEnv(t:Cleanup):Record<string,string>{
 const dir=tmp(t),file=join(dir,'hook.mjs');
 writeFileSync(file,HOOK);
 return {NODE_OPTIONS:`--import=file://${file}`};
}

test('(15) an unexpected exception while handling a line is logged by name only and answered with a constant error; the next line is still served',async t=>{
 const dir=tmp(t),logPath=join(dir,'m1.jsonl');
 const r=await exec(['--log',logPath],[
  req(1,'tools/call',{name:'ping',_meta:{'__m1_boom__':1}}),
  {jsonrpc:'2.0',method:'notifications/initialized',params:{_meta:{'__m1_boom__':1}}},
  req(3,'ping')
 ],hookEnv(t));
 const records=readFileSync(logPath,'utf8').split('\n').filter(l=>l.length>0).map(l=>JSON.parse(l) as J);
 records.forEach(validateRecord);
 assert.equal(r.code,0,'the process survives');
 assert.equal(r.stderr,'');
 const replies=r.stdout.split('\n').filter(l=>l.length>0).map(l=>JSON.parse(l) as J);
 assert.equal(replies.length,2,'the notification gets no reply');
 assert.deepEqual(replies[0],{jsonrpc:'2.0',id:1,error:{code:-32603,message:'Internal error'}});
 assert.deepEqual(replies[1],{jsonrpc:'2.0',id:3,result:{}});
 const internal=records.filter(x=>x.kind==='internal_error');
 assert.equal(internal.length,2);
 assert.deepEqual(internal.map(x=>x.reply),['error','none']);
 assert.deepEqual(internal.map(x=>x.has_id),[true,false]);
 assert.equal(internal[0].error_code,-32603);
 assert.equal(readFileSync(logPath,'utf8').includes('HOOK_RAW'),false,'the exception message is not logged');
 assert.equal(records.at(-1)!.method,'(stdin_end)');
});

test('(16) an exception that escapes the handler is logged by name only, then the process exits with 1',async t=>{
 const dir=tmp(t),logPath=join(dir,'m1.jsonl');
 const r=await exec(['--log',logPath],[req(1,'tools/call',{name:'ping',_meta:{'__m1_boom_twice__':1}}),req(2,'ping')],hookEnv(t));
 const records=readFileSync(logPath,'utf8').split('\n').filter(l=>l.length>0).map(l=>JSON.parse(l) as J);
 records.forEach(validateRecord);
 assert.equal(r.code,1);
 const uncaught=records.filter(x=>x.method==='(uncaught)');
 assert.equal(uncaught.length,1);
 assert.equal(uncaught[0].error_name,'RangeError');
 assert.equal(readFileSync(logPath,'utf8').includes('HOOK_RAW'),false,'the exception message is not logged');
 assert.equal(r.stdout.includes('HOOK_RAW'),false);
 assert.equal(r.stderr,'','Node does not print the stack of the swallowed exception');
});
