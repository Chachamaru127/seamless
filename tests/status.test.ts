import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createAutomatic,issueTicket} from '../src/automatic.ts';
import {createMcp} from '../src/mcp.ts';
import {createServe} from '../src/serve.ts';
import {runCli} from '../src/cli.ts';
import {stages,createStatus,type StructureItem} from '../src/status.ts';
import {projectCodexStructure} from '../src/adapters/codex.ts';
import {projectClaudeStructure} from '../src/adapters/claude.ts';
import {requests,type RequestRecord} from '../src/request-store.ts';
import {writeLimits,unrestricted} from '../src/limits.ts';
import type {Caller} from '../src/caller.ts';
import type {SessionIdentity} from '../src/sessions-scan.ts';
import type {Envelope} from '../src/delivery.ts';
const party=(id:string,provider:'claude'|'codex')=>({id:provider+':'+id,provider,nativeId:id,generation:'g',cwd:'/fixture'});
const record:RequestRecord={id:'request',sender:party('a','claude'),recipient:party('b','codex'),hash:'hash',at:1000,status:'submitted'};
const payload=JSON.stringify({schemaVersion:1,humanApproval:false,id:'request',sender:record.sender,recipient:record.recipient,text:'PRIVATE BODY'});
const observed=(s:ReturnType<typeof stages>)=>s.filter(n=>n.status==='observed').map(n=>n.stage);
test('Codex fixed turn establishes reached and processing; unrelated turn does not',()=>{
 const peer={id:'peer',type:'functionCallOutput',namespace:'claudex',name:'external_message',output:payload};
 const data=projectCodexStructure({turns:[{id:'turn',items:[peer,{id:'reason',type:'reasoning'}]}]});
 assert.deepEqual(observed(stages(record,data,[],2000)),['accepted','reached','processing']);assert.ok(!JSON.stringify(data).includes('PRIVATE BODY'));
 const unrelated=projectCodexStructure({turns:[{id:'turn',items:[peer]},{id:'other',items:[{id:'reason',type:'reasoning'}]}]});
 assert.deepEqual(observed(stages(record,unrelated,[],2000)),['accepted','reached']);
});
test('Claude fixed parent chain includes queued peer and tool-only assistant; unrelated assistant is not processing',()=>{
 const lines=[{sessionId:'b',uuid:'peer',type:'attachment',attachment:{type:'queued_command',origin:{kind:'peer',from:'claudex'},prompt:payload}},{sessionId:'b',uuid:'middle',parentUuid:'peer',type:'system'},{sessionId:'b',uuid:'answer',parentUuid:'middle',type:'assistant',message:{content:[{type:'tool_use'}]}}].map(n=>JSON.stringify(n));
 const data=projectClaudeStructure(lines,'b');
 assert.deepEqual(observed(stages({...record,recipient:party('b','claude')},data,[],2000)),['accepted','reached','processing']);
 assert.ok(!JSON.stringify(data).includes('PRIVATE BODY'));
 assert.deepEqual(observed(stages({...record,recipient:party('b','claude')},[data[0],{id:'other',type:'assistant',parentUuid:'wrong',at:null}],[],2000)),['accepted','reached']);
});
test('reply requires correlated peer, unknown remains distinct, and 200 item limit drops old evidence',()=>{
 const dest:StructureItem[]=[{id:'peer',type:'peer',peer:{id:'request',sender:record.sender},at:null}];
 const src:StructureItem[]=[{id:'reply',type:'peer',peer:{id:'response',replyTo:'request',sender:record.recipient},at:null}];
 assert.deepEqual(observed(stages({...record,status:'unknown'},dest,src,2000)),['reached','replied','unknown']);
 assert.deepEqual(observed(stages(record,[...dest,...Array.from({length:200},(_,i)=>({id:String(i),type:'assistant',at:null}))],[],2000)),['accepted']);
});
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
 const home=await mkdtemp(join(tmpdir(),'cldx-status-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const caller:Caller={provider:'claude',nativeId:'a',generation:'g',cwd:home,socket:'unused',source:'claude-ancestor'};
 const target:SessionIdentity={provider:'codex',nativeId:'b',generation:'g',cwd:home,socket:'unused'};
 let current=caller,writes=0,reads:string[]=[],receipt:'submitted'|'unknown'='submitted',now=10000;
 let destination:StructureItem[]=[{id:'peer',type:'peer',turnId:'turn',position:0,peer:{id:'request',sender:record.sender},at:null},{id:'next',type:'reasoning',turnId:'turn',position:1,at:null}],source:StructureItem[]=[];
 const inbound:Envelope[]=[];const sleeps:number[]=[];
 const options={home,caller:async()=>({status:'ok' as const,caller:current}),scan:async()=>({sessions:[caller,target],codexWorkspace:'observed' as const}),inspect:async()=>target,scanOptions:{git:async(cwd:string)=>({state:'no_git' as const,workspace:cwd})},clock:{now:()=>now,sleep:async(ms:number)=>{sleeps.push(ms);now+=ms;}},adapter:{read:async()=>({status:'ok'}),inbound:async()=>inbound,structure:async(r:{nativeId:string})=>{reads.push(r.nativeId);return r.nativeId==='b'?destination:source;},send:async()=>{writes++;return {status:receipt};}}};
 const auto=createAutomatic(options);return {home,caller,target,options,auto,inbound,sleeps,reads,writes:()=>writes,setCaller:(c:Caller)=>current=c,setReceipt:(v:typeof receipt)=>receipt=v,setSource:(v:StructureItem[])=>source=v,setDestination:(v:StructureItem[])=>destination=v,advance:(ms:number)=>now+=ms};
}
test('restart reconstructs stages from private reservation; owner-only track and read restriction',async t=>{
 const f=await fixture(t);assert.equal((await f.auto('send',{ticket:issueTicket(f.target),id:'request',text:'PRIVATE BODY'})).status,'submitted');
 const restart=createAutomatic(f.options),r=await restart('send',{track:'request'});assert.deepEqual(observed(r.stages),['accepted','reached','processing']);assert.ok(!JSON.stringify(r).includes('PRIVATE BODY'));
 const stored=await requests(join(f.home,'.seamless','reservations'));assert.equal(stored[0].recipient.nativeId,'b');assert.equal(stored[0].at,10000);assert.ok(!JSON.stringify(stored).includes('PRIVATE BODY'));assert.equal((await stat(join(f.home,'.seamless','key'))).mode&0o777,0o600);
 await writeLimits({...unrestricted,operations:{read:false,send:true}},null,join(f.home,'.seamless','limits.json'));f.reads.length=0;
 assert.deepEqual(observed((await restart('send',{track:'request'})).stages),['accepted']);assert.equal(f.reads.length,0);
 f.setCaller({...f.caller,nativeId:'stranger'});assert.deepEqual(await restart('send',{track:'request'}),await restart('send',{track:'missing'}));
});
test('wait polls every 30 seconds until 600 seconds without cancellation and stops on reply',async t=>{
 const f=await fixture(t);await f.auto('send',{ticket:issueTicket(f.target),id:'request',text:'body'});
 const result=await f.auto('send',{track:'request',waitSeconds:600});assert.equal(result.status,'wait_limit');assert.equal(result.processingCancelled,false);assert.deepEqual(f.sleeps,Array(20).fill(30000));assert.equal(f.writes(),1);
 f.setSource([{id:'reply',type:'peer',peer:{id:'response',replyTo:'request',sender:record.recipient},at:null}]);assert.equal((await f.auto('send',{track:'request',waitSeconds:600})).status,'ok');assert.equal(f.sleeps.length,20);
 for(const n of [-1,601,NaN,'30'])await assert.rejects(f.auto('send',{track:'request',waitSeconds:n}));
});
test('unknown blocks different ID, replyTo differentiates identical text, and expiry permits new request',async t=>{
 const f=await fixture(t);f.setReceipt('unknown');const ticket=issueTicket(f.target);
 assert.equal((await f.auto('send',{ticket,id:'request',text:'same'})).status,'unknown');
 assert.deepEqual(await f.auto('send',{ticket,id:'new',text:'same'}),{status:'duplicate_of_unknown',requestId:'request'});assert.equal(f.writes(),1);
 for(const id of ['in1','in2'])f.inbound.push({id,text:'incoming',sender:{id:'codex:b',nativeId:'b',generation:'g'},recipient:{id:'claude:a',nativeId:'a',generation:'g'}});
 for(const id of ['in1','in2'])assert.equal((await f.auto('send',{ticket,id:'reply-'+id,replyTo:id,text:'same'})).status,'unknown');assert.equal(f.writes(),3);
 f.advance(86400001);assert.equal((await f.auto('send',{ticket,id:'after',text:'same'})).status,'unknown');assert.equal(f.writes(),4);
});
test('MCP and serve track owner only; sessions return at most ten recent requests; CLI maps status',async t=>{
 const f=await fixture(t);for(let i=0;i<12;i++){f.advance(1);await f.auto('send',{ticket:issueTicket(f.target),id:'r'+i,text:'body'+i});}
 const list=await f.auto('sessions',{});assert.equal(list.candidates[0].requests.length,10);assert.equal(list.candidates[0].requests[0].id,'r11');
 const handle=createMcp({automatic:f.auto});await handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});await handle({jsonrpc:'2.0',method:'notifications/initialized'});
 const call=async(id:string)=>{const r:any=await handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'send',arguments:{track:id}}});return JSON.parse(r.result.content[0].text);};assert.equal((await call('r11')).status,'ok');
 assert.equal(((await createServe({automatic:f.auto})({id:1,method:'send',params:{track:'r11'}})).result as any).status,'ok');
 let mapped:any;await runCli(['status','r11','--wait','30'],async(method,input)=>{mapped={method,input};return {};});assert.deepEqual(mapped,{method:'send',input:{track:'r11',waitSeconds:30}});
 f.setCaller({...f.caller,nativeId:'other'});assert.deepEqual(await call('r11'),await call('absent'));assert.equal((await f.auto('sessions',{})).candidates.every((n:any)=>n.requests.length===0),true);
});
test('different IDs from separate processes share one native write and store no plaintext',async t=>{
 const home=await mkdtemp(join(tmpdir(),'cldx-parallel-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const script=`import {createAutomatic,issueTicket} from './src/automatic.ts';import {appendFile} from 'node:fs/promises';const home=process.argv[1],id=process.argv[2];const caller={provider:'claude',nativeId:'a',generation:'g',cwd:home,socket:'unused',source:'claude-ancestor'},target={provider:'codex',nativeId:'b',generation:'g',cwd:home,socket:'unused'};const a=createAutomatic({home,caller:async()=>({status:'ok',caller}),inspect:async()=>target,scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd})},adapter:{read:async()=>null,send:async()=>{await appendFile(home+'/writes','write\\n');return {status:'unknown'};}}});console.log(JSON.stringify(await a('send',{ticket:issueTicket(target),id,text:'PRIVATE BODY'})));`;
 const run=(id:string)=>new Promise<any>((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',script,home,id]);let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(out)):reject(Error(err)));});
 const results=await Promise.all([run('one'),run('two')]);assert.deepEqual(results.map(r=>r.status).sort(),['duplicate_of_unknown','unknown']);assert.equal(await readFile(join(home,'writes'),'utf8'),'write\n');
 const dir=join(home,'.seamless','reservations');for(const name of await readdir(dir))assert.ok(!(await readFile(join(dir,name),'utf8')).includes('PRIVATE BODY'));
});

test('status disconnect keeps observed acceptance and returns unobserved native stages',async t=>{
 const f=await fixture(t);await f.auto('send',{ticket:issueTicket(f.target),id:'request',text:'body'});
 const a=createAutomatic({...f.options,adapter:{...f.options.adapter,structure:async()=>{throw Error('disconnected');}}});
 assert.deepEqual(observed((await a('send',{track:'request'})).stages),['accepted']);
});
test('status honors target exclusion without reading its records',async t=>{
 const f=await fixture(t);await f.auto('send',{ticket:issueTicket(f.target),id:'request',text:'body'});
 await writeLimits({...unrestricted,exclude:[{provider:'codex',nativeId:'b'}]},null,join(f.home,'.seamless','limits.json'));
 const result=await f.auto('send',{track:'request'});assert.deepEqual(observed(result.stages),['accepted']);assert.ok(!f.reads.includes('b'));
});
test('send distinguishes missing reply record, invalid reply and offline target; absent Claude is not_found',async t=>{
 const f=await fixture(t),ticket=issueTicket(f.target);
 assert.equal((await f.auto('send',{ticket,id:'x',text:'body',replyTo:'none'})).status,'reply_target_not_yet_visible');
 f.inbound.push({id:'bad',replyTo:'earlier',text:'body',sender:{id:'codex:b',nativeId:'b',generation:'g'},recipient:{id:'claude:a',nativeId:'a',generation:'g'}});
 assert.equal((await f.auto('send',{ticket,id:'x',text:'body',replyTo:'bad'})).status,'invalid_reply');
 assert.equal((await createAutomatic({...f.options,inspect:async()=>null})('send',{ticket,id:'x',text:'body'})).status,'target_offline');
 const native=createAutomatic({...f.options,adapter:undefined});assert.equal((await native('read',{target:'claude:missing'})).status,'not_found');
});
test('Claude structure reader bounds raw records and does not include bodies',async t=>{
 const f=await fixture(t);const {readClaudeStructure,claudeTranscriptPath}=await import('../src/adapters/claude.ts');
 await mkdir(join(f.home,'.claude','sessions'),{recursive:true});await writeFile(join(f.home,'.claude','sessions','9.json'),JSON.stringify({pid:9,sessionId:'b',cwd:f.home,startedAt:1,version:'2.1.286'}));
 const path=claudeTranscriptPath(f.home,'b',{home:f.home});await mkdir(join(path,'..'),{recursive:true});
 const peer={sessionId:'b',uuid:'peer',type:'user',origin:{kind:'peer',from:'claudex'},message:{content:payload}};
 const rest=Array.from({length:200},(_,i)=>({sessionId:'b',uuid:'a'+i,parentUuid:'peer',type:'assistant',message:{content:'PRIVATE BODY'}}));
 const target={id:'claude:b',provider:'claude' as const,nativeId:'b',generation:'9@1',host:'local',displayName:'b',workspace:f.home,operations:[],grants:[]};
 await writeFile(path,[peer,...rest].map(n=>JSON.stringify(n)).join('\n'));const result=await readClaudeStructure(target,{home:f.home});assert.equal(result.length,200);assert.ok(!result.some(n=>n.peer));assert.ok(!JSON.stringify(result).includes('PRIVATE BODY'));
});

test('Codex structure projects only last 200 native items including non-visible items',()=>{
 const peer={id:'peer',type:'functionCallOutput',namespace:'claudex',name:'external_message',output:payload};
 const later=Array.from({length:200},(_,i)=>({id:'r'+i,type:'reasoning'}));
 const within=projectCodexStructure({turns:[{id:'turn',items:[peer,...later.slice(1)]}]});assert.equal(within.length,200);assert.deepEqual(observed(stages(record,within,[],2000)),['accepted','reached','processing']);
 const beyond=projectCodexStructure({turns:[{id:'turn',items:[peer,...later]}]});assert.equal(beyond.length,200);assert.deepEqual(observed(stages(record,beyond,[],2000)),['accepted']);
});
test('Codex structure reads the real turnId field so processing is observed on Desktop snapshots',async()=>{
 const {projectCodexStructure}=await import('../src/adapters/codex.ts');
 const envelope=JSON.stringify({schemaVersion:1,humanApproval:false,id:'req-1',sender:{id:'claude:a',nativeId:'a',generation:'g'},recipient:{id:'codex:b',nativeId:'b',generation:'h'},text:'x'});
 const state={turns:[{turnId:'T-real',turnStartedAtMs:1,items:[{id:'fco-1',type:'functionCallOutput',namespace:'claudex',name:'external_message',output:envelope},{id:'msg-1',type:'agentMessage',text:'ok'}]}]};
 const items=projectCodexStructure(state);
 assert.equal(items[0].turnId,'T-real');assert.equal(items[1].turnId,'T-real');
 const {stages}=await import('../src/status.ts');
 const record={id:'req-1',status:'submitted',at:1,sender:{provider:'claude',nativeId:'a',generation:'g'},recipient:{provider:'codex',nativeId:'b',generation:'h'}} as any;
 const result=stages(record,items,[],2);
 assert.equal(result.find(s=>s.stage==='processing')!.status,'observed');
});

for(const provider of ['claude','codex'] as const)test(`${provider} stages reject another sender with same request and reply IDs`,()=>{
 const project=(sender:typeof record.sender,replyTo?:string)=>{
  const text=JSON.stringify({schemaVersion:1,humanApproval:false,id:'request',sender,recipient:record.recipient,text:'BODY MUST NOT SURVIVE',...(replyTo?{replyTo}:{})});
  return provider==='codex'?projectCodexStructure({turns:[{id:'t',items:[{id:'peer',type:'functionCallOutput',namespace:'claudex',name:'external_message',output:text},{id:'answer',type:'agentMessage',text:'reply'}]}]}):projectClaudeStructure([{sessionId:'b',uuid:'peer',type:'user',origin:{kind:'peer',from:'claudex'},message:{content:text}},{sessionId:'b',uuid:'answer',type:'assistant',parentUuid:'peer',message:{content:'reply'}}].map(n=>JSON.stringify(n)),'b');
 };
 const r={...record,recipient:party('b',provider)};
 for(const sender of [party('other','claude'),party('a','codex')]){
  const data=project(sender);assert.deepEqual(observed(stages(r,data,[],2000)),['accepted']);assert.ok(!JSON.stringify(data).includes('BODY MUST NOT SURVIVE'));
 }
 for(const sender of [party('other',provider),party('b',provider==='codex'?'claude':'codex')])assert.deepEqual(observed(stages(r,[],project(sender,'request'),2000)),['accepted']);
 assert.deepEqual(observed(stages(r,project(record.sender),project(r.recipient,'request'),2000)),['accepted','reached','processing','replied']);
});
test('automatic send schema is a plain object with optional send and track fields',async()=>{
 const handle=createMcp({automatic:async()=>({status:'ok'})});
 await handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});await handle({jsonrpc:'2.0',method:'notifications/initialized'});
 const response:any=await handle({jsonrpc:'2.0',id:2,method:'tools/list'});
 const schema=response.result.tools.find((t:any)=>t.name==='send').inputSchema;
 for(const key of ['oneOf','allOf','anyOf'])assert.equal(key in schema,false);
 for(const key of ['track','ticket','id','text'])assert.ok(key in schema.properties);
 assert.deepEqual(schema.required,[]);
});

test('excluded Claude read is not_found without opening activity records',async t=>{
 const f=await fixture(t);
 const fs=await import('node:fs/promises');const {syncBuiltinESMExports}=await import('node:module');
 await mkdir(join(f.home,'.claude','sessions'),{recursive:true});
 await writeFile(join(f.home,'.claude','sessions','41.json'),JSON.stringify({pid:41,sessionId:'excluded',cwd:f.home,startedAt:1,version:'future'}));
 await writeLimits({...unrestricted,exclude:[{provider:'claude',nativeId:'excluded'}]},null,join(f.home,'.seamless','limits.json'));
 let activityReads=0;const original=fs.default.readdir;
 t.mock.method(fs.default,'readdir',(...args:Parameters<typeof original>)=>{if(String(args[0])===join(f.home,'.claude','sessions'))activityReads++;return original(...args);});
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const auto=createAutomatic({...f.options,adapter:undefined});
 const excluded=await auto('read',{target:'claude:excluded'});assert.deepEqual(excluded,{status:'not_found'});assert.equal(activityReads,0);
 assert.deepEqual(await auto('read',{target:'claude:missing'}),excluded);assert.ok(activityReads>0);
});

test('Claude structure recognizes seamless declared sender',()=>{
 const line=JSON.stringify({sessionId:'b',uuid:'peer',type:'user',origin:{kind:'peer',from:'seamless'},message:{content:payload}});
 const data=projectClaudeStructure([line],'b');
 assert.equal(data[0].peer?.id,'request');assert.equal(data[0].peer?.sender?.nativeId,'a');
 assert.ok(!JSON.stringify(data).includes('PRIVATE BODY'));
});

test('track accepts valid scopes but rejects invalid scope and mixed send fields',async t=>{
 const f=await fixture(t);await f.auto('send',{ticket:issueTicket(f.target),id:'request',text:'body'});
 for(const scope of ['current_work','same_repository','any'])assert.equal((await f.auto('send',{track:'request',scope})).status,'ok');
 for(const input of [{scope:'wrong'},{scope:null},{ticket:issueTicket(f.target)},{id:'other'},{text:'body'}])await assert.rejects(f.auto('send',{track:'request',...input}),{message:'invalid_params'});
});

test('MCP track treats wait_limit as normal and not_found as error',async t=>{
 const f=await fixture(t);await f.auto('send',{ticket:issueTicket(f.target),id:'request',text:'body'});
 const handle=createMcp({automatic:f.auto});
 await handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});await handle({jsonrpc:'2.0',method:'notifications/initialized'});
 for(const [track,status,isError] of [['request','wait_limit',false],['missing','not_found',true]] as const){
  const r:any=await handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'send',arguments:{track,waitSeconds:1}}});
  assert.equal(JSON.parse(r.result.content[0].text).status,status);assert.equal(r.result.isError,isError);
 }
});

test('Claude enqueue hash observes exact arrival only and never supplies inbound evidence',async()=>{
 const {createHash}=await import('node:crypto');
 const {projectClaude}=await import('../src/adapters/claude.ts');
 const {receivedMetadata}=await import('../src/inbound.ts');
 const at='2026-10-04T06:26:03.542Z';
 const r={...record,recipient:party('b','claude'),payloadSha256:createHash('sha256').update(payload).digest('hex')};
 const enqueue=(content:unknown,extra:object={})=>JSON.stringify({type:'queue-operation',operation:'enqueue',sessionId:'b',timestamp:at,content,...extra});
 const exact=enqueue(payload),data=projectClaudeStructure([exact],'b');
 assert.deepEqual(data,[{id:'queue:'+at,type:'enqueue',at,payloadSha256:r.payloadSha256}]);
 const result=stages(r,data,[],2000);
 assert.deepEqual(observed(result),['accepted','reached']);
 assert.deepEqual(result.find(s=>s.stage==='reached'),{stage:'reached',status:'observed',evidence:['queued:queue:'+at],at});
 for(const line of [enqueue(payload+' '),enqueue('ordinary user text'),enqueue(payload.replace('request','another')),enqueue(payload,{sessionId:'other'}),enqueue(payload,{operation:'remove'}),enqueue({text:payload})]){
  assert.deepEqual(observed(stages(r,projectClaudeStructure([line],'b'),[],2000)),['accepted']);
  assert.deepEqual(receivedMetadata(projectClaude([line],'b')),[]);
 }
 assert.deepEqual(receivedMetadata(projectClaude([exact],'b')),[]);
 assert.deepEqual(observed(stages({...r,payloadSha256:undefined},data,[],2000)),['accepted']);
 assert.deepEqual(observed(stages({...r,recipient:party('b','codex')},data,[],2000)),['accepted']);
 const attachment=JSON.stringify({type:'attachment',sessionId:'b',uuid:'peer',timestamp:at,attachment:{type:'queued_command',prompt:payload,source_uuid:'request',origin:{kind:'peer',from:'seamless'},timestamp:at}});
 const both=projectClaudeStructure([exact,attachment],'b');
 assert.deepEqual(stages(r,both,[],2000).find(s=>s.stage==='reached')?.evidence,['peer']);
 assert.deepEqual(observed(stages({...r,payloadSha256:undefined},both,[],2000)),['accepted','reached']);
 assert.deepEqual(projectClaudeStructure([exact,...Array(200).fill('{}')],'b'),[]);
});

test('delivery persists payload hash and restarted track reads it without plaintext',async t=>{
 const {createHash}=await import('node:crypto');
 const f=await fixture(t),target={...f.target,provider:'claude' as const};
 const payloadSha256=createHash('sha256').update(payload).digest('hex');
 const options={...f.options,inspect:async()=>target,adapter:{...f.options.adapter,send:async()=>({status:'submitted' as const,payloadSha256})}};
 const auto=createAutomatic(options);
 await auto('send',{ticket:issueTicket(target),id:'request',text:'PRIVATE BODY'});
 const stored=await requests(join(f.home,'.seamless','reservations'));
 assert.equal(stored[0].payloadSha256,payloadSha256);assert.ok(!JSON.stringify(stored).includes('PRIVATE BODY'));
 f.setDestination(projectClaudeStructure([JSON.stringify({type:'queue-operation',operation:'enqueue',sessionId:'b',timestamp:'2026-10-04T06:26:03.542Z',content:payload})],'b'));
 assert.deepEqual(observed((await createAutomatic(options)('send',{track:'request'})).stages),['accepted','reached']);
});
