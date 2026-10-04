import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile,mkdir,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAutomatic,issueTicket,migrateRegistry,type Automatic} from '../src/automatic.ts';
import {createMcp} from '../src/mcp.ts';
import {createServe} from '../src/serve.ts';
import {runCli} from '../src/cli.ts';
import {readLimits,writeLimits,type Limits,unrestricted} from '../src/limits.ts';
import type {Caller} from '../src/caller.ts';
import type {SessionIdentity} from '../src/sessions-scan.ts';
import type {Envelope} from '../src/delivery.ts';
async function fixture(t:{after:(fn:()=>Promise<void>)=>void},providers:['claude'|'codex','claude'|'codex']=['codex','claude']){
 const home=await realpath(await mkdtemp(join(tmpdir(),'cldx-auto-api-')));t.after(()=>rm(home,{recursive:true,force:true}));
 const caller:Caller={provider:providers[0],nativeId:'a',generation:'g',cwd:home,socket:'unused',source:'codex-turn-metadata'};
 const target:SessionIdentity={provider:providers[1],nativeId:'b',generation:'g',cwd:home,socket:'unused'};
 let observed=true,reads=0,writes=0,scans=0;let beforeWrite:()=>Promise<void>=async()=>{};
 const envelopes:Envelope[]=[];const path=join(home,'limits.json');
 const automatic=createAutomatic({home,limitsPath:path,caller:async()=>observed?{status:'ok',caller}:{status:'caller_unobserved',reason:'fixture'},scan:async()=>{scans++;return {sessions:[caller,{...target}],codexWorkspace:'observed'};},inspect:async()=>({...target}),scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd})},adapter:{read:async()=>{reads++;return {status:'ok'};},inbound:async()=>envelopes,send:async(_r,e,authorize)=>{await beforeWrite();if(!await authorize!())return {status:'rejected'};writes++;envelopes.push(e);return {status:'submitted'};}}});
 return {home,path,caller,target,automatic,envelopes,count:()=>({reads,writes,scans}),setObserved:(v:boolean)=>observed=v,beforeWrite:(fn:()=>Promise<void>)=>beforeWrite=fn};
}
async function mcp(automatic:Automatic){const handle=createMcp({automatic});await handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});await handle({jsonrpc:'2.0',method:'notifications/initialized'});return async(name:string,args:unknown,meta?:unknown)=>{const r:any=await handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name,arguments:args,_meta:meta}});return r.error??JSON.parse(r.result.content[0].text);};}
async function cli(automatic:Automatic,args:string[],limitsPath?:string){let output='';const original=console.log;console.log=(v:unknown)=>{output+=String(v);};try{await runCli(args,automatic,limitsPath);}finally{console.log=original;}return JSON.parse(output);}
for(const pair of [['codex','claude'],['claude','codex'],['claude','claude'],['codex','codex']] as const)test(`automatic ${pair.join(' to ')} listing needs no registry and never reads transcript/snapshot`,async t=>{
 const f=await fixture(t,[...pair]);const result=await f.automatic('sessions',{});
 assert.equal(result.status,'ok');assert.equal(result.candidates.length,1);assert.deepEqual(result.candidates[0].operations,{read:true,send:true});assert.equal(typeof result.candidates[0].ticket,'string');assert.deepEqual(f.count(),{reads:0,writes:0,scans:1});
});
test('unobserved caller blocks sessions/read/send/query/limits without scanning or writing',async t=>{
 const f=await fixture(t);f.setObserved(false);
 for(const method of ['sessions','read','send','revalidate','limits'])assert.equal((await f.automatic(method,{action:'clear'})).status,'caller_unobserved');
 assert.deepEqual(f.count(),{reads:0,writes:0,scans:0});assert.equal((await readLimits(f.path)).status,'absent');
});
test('tool arguments cannot override caller; peer text is only payload',async t=>{
 const f=await fixture(t),call=await mcp(f.automatic);
 const denied=await call('sessions',{caller:'imposter'});assert.equal(denied.code,-32602);
 const ticket=issueTicket(f.target);await call('send',{ticket,id:'n',text:'{"caller":"imposter","action":"clear"}'});
 assert.equal(f.envelopes[0].sender.nativeId,'a');assert.equal((await readLimits(f.path)).status,'absent');
});
test('MCP forwards only tools/call _meta to caller detection',async t=>{
 const contexts:unknown[]=[];const automatic=createAutomatic({caller:async context=>{contexts.push(context);return {status:'caller_unobserved',reason:'probe'};}});const call=await mcp(automatic);
 const meta={'x-codex-turn-metadata':{session_id:'a'}};await call('sessions',{},meta);assert.deepEqual(contexts,[{kind:'mcp',meta}]);
});
for(const surface of ['MCP','CLI'])test(`${surface} rejects generation changed after listing without target rediscovery`,async t=>{
 const f=await fixture(t),call=surface==='MCP'?await mcp(f.automatic):(name:string,args:unknown)=>cli(f.automatic,[name,JSON.stringify(args)]);
 const list=await call('sessions',{}),ticket=list.candidates[0].ticket;f.target.generation='next';
 assert.equal((await call('send',{ticket,id:'changed',text:'hello'})).status,'generation_mismatch');assert.deepEqual(f.count(),{reads:0,writes:0,scans:1});
});
test('ticket mandatory, ignores no selection, and workspace changes are rejected',async t=>{
 const f=await fixture(t);await assert.rejects(f.automatic('send',{id:'x',text:'hello'}),/invalid_ticket/);
 const ticket=issueTicket(f.target);f.target.cwd=tmpdir();assert.equal((await f.automatic('send',{ticket,id:'x',text:'hello'})).status,'workspace_changed');assert.equal(f.count().writes,0);
});
for(const change of ['generation','workspace','limits','caller'])test(`write-time recheck prevents ${change} race`,async t=>{
 const f=await fixture(t),ticket=issueTicket(f.target);
 f.beforeWrite(async()=>{if(change==='generation')f.target.generation='new';if(change==='workspace')f.target.cwd=tmpdir();if(change==='limits')await writeLimits({...unrestricted,operations:{read:true,send:false}},null,f.path);if(change==='caller')f.setObserved(false);});
 const expected={generation:'generation_mismatch',workspace:'workspace_changed',limits:'operation_not_permitted',caller:'caller_unobserved'}[change];
 assert.equal((await f.automatic('send',{ticket,id:'race',text:'hello'})).status,expected);assert.equal(f.count().writes,0);
});
for(const restriction of ['exclude','scope','operations','unusable'])test(`${restriction} applies to all four entry points`,async t=>{
 const f=await fixture(t),ticket=issueTicket(f.target);let value:Limits={...unrestricted};
 if(restriction==='exclude')value={...value,exclude:[{provider:f.target.provider,nativeId:'b',workspace:f.target.cwd}]};
 if(restriction==='scope'){value={...value,scope:'current_work'};f.target.cwd=tmpdir();}
 if(restriction==='operations')value={...value,operations:{read:false,send:false}};
 if(restriction==='unusable')await writeFile(f.path,'bad json',{mode:0o600});else await writeLimits(value,null,f.path);
 const args:Record<string,unknown>={sessions:{scope:'any'},read:{target:`${f.target.provider}:b`,scope:'any'},send:{ticket:restriction==='scope'?issueTicket(f.target):ticket,id:'n',text:'hello',scope:'any'},revalidate:{ticket:restriction==='scope'?issueTicket(f.target):ticket,scope:'any'}};
 for(const method of Object.keys(args)){const result=await f.automatic(method,args[method]);if(restriction==='unusable')assert.equal(result.status,'limits_unusable');else if(method==='sessions'&&['exclude','scope'].includes(restriction))assert.deepEqual(result.candidates,[]);else if(method==='revalidate'||method==='send')assert.equal(result.status,({exclude:'target_excluded',scope:'scope_conflict',operations:'operation_not_permitted'} as Record<string,string>)[restriction]);else assert.equal(result.status,restriction==='operations'?'operation_not_permitted':'target_unavailable');}
 assert.equal(f.count().reads,0);assert.equal(f.count().writes,0);
});
test('provider and workspace exclusions apply without requiring nativeId',async t=>{
 const f=await fixture(t);
 for(const exclude of [[{provider:f.target.provider}],[{workspace:f.target.cwd}]]){
  const current=await readLimits(f.path);if(current.status==='unusable')throw Error();await writeLimits({...unrestricted,exclude},current.hash,f.path);assert.deepEqual((await f.automatic('sessions',{})).candidates,[]);
 }
});
test('MCP and CLI limits write identical configuration and clear restores unrestricted list',async t=>{
 const f=await fixture(t),call=await mcp(f.automatic),value:Limits={version:1,exclude:[{nativeId:'b'}],scope:'any',operations:{read:true,send:true}};
 assert.equal((await call('limits',{action:'set',value})).status,'ok');const mcpBytes=await readFile(f.path,'utf8');assert.deepEqual((await f.automatic('sessions',{})).candidates,[]);
 assert.equal((await cli(f.automatic,['limits','clear'])).status,'ok');assert.equal((await readLimits(f.path)).status,'absent');assert.equal((await f.automatic('sessions',{})).candidates.length,1);
 const input=join(f.home,'input.json');await writeFile(input,JSON.stringify(value));assert.equal((await cli(f.automatic,['limits','set',input])).status,'ok');assert.equal(await readFile(f.path,'utf8'),mcpBytes);
 assert.equal((await call('limits',{action:'clear'})).status,'ok');assert.equal((await call('sessions',{})).candidates.length,1);
});
test('limits reject unknown nested fields and invalid operation shape',async t=>{
 const f=await fixture(t);
 for(const value of [{...unrestricted,exclude:[{}]},{...unrestricted,extra:1},{...unrestricted,exclude:[{other:'x'}]},{...unrestricted,operations:{read:true}},{...unrestricted,operations:{read:true,send:false,other:1}}])assert.equal((await f.automatic('limits',{action:'set',value})).status,'limits_unusable');
 assert.equal((await readLimits(f.path)).status,'absent');
});
test('serve uses automatic gates for existing selection and revalidation queries',async t=>{
 const f=await fixture(t),serve=createServe({automatic:f.automatic});const selected:any=await serve({id:1,method:'select',params:{operation:'read'}});assert.equal(selected.result.status,'selected');
 await writeFile(f.path,'broken',{mode:0o600});const result:any=await serve({id:2,method:'revalidate',params:{ticket:selected.result.ticket}});assert.equal(result.result.status,'limits_unusable');
});
for(const pair of [['claude','claude'],['codex','codex']] as const)test(`same-provider ${pair[0]} send, inbound, replyTo correlation`,async t=>{
 const f=await fixture(t,[...pair]);const ticket=issueTicket(f.target);
 assert.equal((await f.automatic('send',{ticket,id:'outgoing',text:'request'})).status,'submitted');
 f.envelopes.push({id:'incoming',text:'request',sender:{id:`${pair[1]}:b`,nativeId:'b',generation:'g'},recipient:{id:`${pair[0]}:a`,nativeId:'a',generation:'g'}});
 assert.equal((await f.automatic('send',{ticket,id:'response',text:'reply',replyTo:'incoming'})).status,'submitted');
 assert.equal(f.envelopes.at(-1)?.replyTo,'incoming');assert.equal((await f.automatic('send',{ticket,id:'bad',text:'reply',replyTo:'forged'})).status,'reply_target_not_yet_visible');assert.equal(f.count().writes,2);
});
for(const restriction of ['none','direction','operation'])test(`migration is a preview with redacted notes, restriction=${restriction}`,async t=>{
 const f=await fixture(t);const sessions=['a','b'].map((id,i)=>({id,provider:i?'claude':'codex',nativeId:`private-${id}`,generation:`private-generation-${id}`,host:'local',displayName:id,workspace:f.home,operations:restriction==='operation'?['send']:['read','send'],grants:restriction==='direction'?[{peer:i?'a':'b',operation:'send',direction:i?'inbound':'outbound'}]:['read','send'].flatMap(operation=>['inbound','outbound'].map(direction=>({peer:i?'a':'b',operation,direction})))}));
 const path=join(f.home,'registry.json');await writeFile(path,JSON.stringify({sessions}),{mode:0o600});
 const result=await cli(f.automatic,['migrate','--registry',path],f.path);assert.deepEqual(result.proposal,{version:1,exclude:[],scope:'current_work',operations:null});assert.match(result.notes.notice,/名簿になかった相手/);if(restriction!=='none')assert.match(result.notes.notice,/名簿では止めていた操作も許可され/);assert.equal(result.notes.pairs.length,2);assert.equal(JSON.stringify(result).includes('private-'),false);assert.deepEqual(result.notes.pairs[0].grants,sessions[0].grants);assert.equal((await readLimits(f.path)).status,'absent');
 assert.equal((await migrateRegistry(path,true,f.path)).status,'ok');const loaded=await readLimits(f.path);assert.equal(loaded.status,'ok');if(loaded.status==='ok')assert.deepEqual(loaded.value,result.proposal);
});

import {spawnSync} from 'node:child_process';
import {observeSessionPair} from '../src/native-runtime.ts';
test('separate CLI processes retain ticket identity across restart',async t=>{
 const f=await fixture(t),path=join(f.home,'state.json');await writeFile(path,JSON.stringify({generation:'g'}));
 const run=(args:string[])=>{const child=spawnSync(process.execPath,['tests/support/automatic-cli.ts',f.home,...args],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);return JSON.parse(child.stdout);};
 const list=run(['sessions']);await writeFile(path,JSON.stringify({generation:'new'}));
 assert.equal(run(['send',JSON.stringify({ticket:list.candidates[0].ticket,id:'n',text:'hello'})]).status,'generation_mismatch');
});
for(const provider of ['codex','claude'] as const)test(`native pair registration supports two ${provider} sessions`,async t=>{
 const f=await fixture(t);const records=await observeSessionPair([{provider,nativeId:'a'},{provider,nativeId:'b'}],await (await import('node:fs/promises')).realpath(f.home),async(_provider,nativeId)=>({nativeId,generation:'g',cwd:await (await import('node:fs/promises')).realpath(f.home),socket:'unused'}));
 assert.equal(records.length,2);assert.notEqual(records[0].id,records[1].id);assert.equal(records[0].provider,records[1].provider);assert.equal(records[0].grants[0].peer,records[1].id);
});
test('automatic read succeeds and honors read-only limits without enabling send',async t=>{
 const f=await fixture(t);await writeLimits({...unrestricted,operations:{read:true,send:false}},null,f.path);
 assert.equal((await f.automatic('sessions',{operation:'read'})).candidates.length,1);
 assert.equal((await f.automatic('read',{target:'claude:b',limit:10})).status,'ok');
 assert.equal((await f.automatic('send',{ticket:issueTicket(f.target),id:'no',text:'no'})).status,'operation_not_permitted');assert.equal(f.count().reads,1);assert.equal(f.count().writes,0);
});
test('automatic MCP advertises four tools and no caller override',async t=>{
 const f=await fixture(t),handle=createMcp({automatic:f.automatic});await handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});await handle({jsonrpc:'2.0',method:'notifications/initialized'});
 const result:any=await handle({jsonrpc:'2.0',id:2,method:'tools/list'});assert.deepEqual(result.result.tools.map((t:any)=>t.name),['sessions','read','send','limits']);
 assert.equal(JSON.stringify(result.result.tools).includes('caller'),false);assert.ok('ticket' in result.result.tools[2].inputSchema.properties);assert.ok('track' in result.result.tools[2].inputSchema.properties);assert.equal('oneOf' in result.result.tools[2].inputSchema,false);
});

for(const surface of ['MCP','CLI'])test(`${surface} clears corrupt limits with null hash while other operations remain blocked`,async t=>{
 const f=await fixture(t),call=await mcp(f.automatic);await writeFile(f.path,'broken',{mode:0o600});
 assert.equal((await f.automatic('sessions',{})).status,'limits_unusable');
 assert.equal((await f.automatic('limits',{action:'set',value:unrestricted})).status,'limits_unusable');
 const result=surface==='MCP'?await call('limits',{action:'clear'}):await cli(f.automatic,['limits','clear']);
 assert.deepEqual(result,{status:'ok',hash:null});assert.deepEqual(await readLimits(f.path),{status:'absent',hash:null});
 assert.equal((await f.automatic('sessions',{})).candidates.length,1);
});
for(const surface of ['MCP','CLI'])test(`${surface} sessions defaults to read under read-only limits`,async t=>{
 const f=await fixture(t);await writeLimits({...unrestricted,operations:{read:true,send:false}},null,f.path);
 const result=surface==='MCP'?await (await mcp(f.automatic))('sessions',{}):await cli(f.automatic,['sessions']);
 assert.equal(result.status,'ok');assert.equal(result.candidates.length,1);
 assert.equal((await f.automatic('sessions',{operation:'send'})).status,'operation_not_permitted');
});
for(const linked of [false,true])test(`workspace exclusion includes descendants and normalizes symlink=${linked}`,async t=>{
 const f=await fixture(t),root=await realpath(f.home),child=join(root,'child');await mkdir(child);
 const alias=join(root,'alias');if(linked)await symlink(root,alias);
 f.caller.cwd=root;f.target.cwd=child;
 await writeLimits({...unrestricted,exclude:[{workspace:linked?alias:root}]},null,f.path);
 assert.deepEqual((await f.automatic('sessions',{})).candidates,[]);
 assert.equal((await f.automatic('revalidate',{ticket:issueTicket(f.target)})).status,'target_excluded');
 f.target.cwd=root+'-sibling';assert.equal((await f.automatic('revalidate',{ticket:issueTicket(f.target),scope:'any'})).status,'validated');
});
test('nonexistent exclusion path is compared as written',async t=>{
 const f=await fixture(t);f.target.cwd=join(f.home,'missing','child');
 await writeLimits({...unrestricted,exclude:[{workspace:join(f.home,'missing')}]},null,f.path);
 assert.equal((await f.automatic('revalidate',{ticket:issueTicket(f.target),scope:'any'})).status,'target_excluded');
});
test('sessions reports the number of Codex candidates omitted by any scope scan',async t=>{
 const f=await fixture(t),cwd=await realpath(f.home);f.caller.cwd=cwd;
 const automatic=createAutomatic({home:f.home,caller:async()=>({status:'ok',caller:f.caller}),scanOptions:{version:async()=>'26.928.40906+12694',rows:async()=>Array.from({length:53},(_,i)=>({id:String(i),cwd,archived:0,updated_at_ms:i})),owner:async()=> 'g'}});
 const result=await automatic('sessions',{scope:'any'});assert.equal(result.status,'ok');assert.equal(result.codexTruncated,3);assert.equal(result.candidates.length,50);
});

test('automatic select defaults to read under read-only limits',async t=>{
 const f=await fixture(t);await writeLimits({...unrestricted,operations:{read:true,send:false}},null,f.path);
 const serve=createServe({automatic:f.automatic});const result:any=await serve({id:1,method:'select',params:{}});
 assert.equal(result.result.status,'selected');assert.equal(result.result.target,'claude:b');
 assert.equal((await f.automatic('select',{operation:'send'})).status,'operation_not_permitted');
});
test('automatic write-time rejection releases ID for retry and submitted stays reserved',async t=>{
 const f=await fixture(t),request={ticket:issueTicket(f.target),id:'retry',text:'hello'};
 f.beforeWrite(async()=>{f.setObserved(false);});
 assert.equal((await f.automatic('send',request)).status,'caller_unobserved');assert.equal(f.count().writes,0);
 f.setObserved(true);f.beforeWrite(async()=>{});
 assert.equal((await f.automatic('send',request)).status,'submitted');
 assert.equal((await f.automatic('send',request)).status,'submitted');assert.equal(f.count().writes,1);
});

test('automatic lists restart hint, expires ID exclusion, and reads and sends to new identity',async t=>{
 const f=await fixture(t);await writeLimits({...unrestricted,exclude:[{provider:'claude',nativeId:'b'}]},null,f.path);
 assert.equal((await f.automatic('sessions',{})).candidates.length,0);
 f.target.nativeId='new-b';f.target.generation='new-generation';
 const list=await f.automatic('sessions',{});assert.deepEqual(list.excludeExpired,['b']);
 assert.equal(list.candidates[0].change,'new');assert.equal(list.candidates[0].possible_restart_of,'b');
 assert.equal((await f.automatic('read',{target:'claude:new-b'})).status,'ok');
 assert.equal((await f.automatic('send',{ticket:list.candidates[0].ticket,id:'new-target',text:'hello'})).status,'submitted');
 assert.equal(f.count().writes,1);
});
for(const exclude of [{workspace:true},{provider:true,workspace:true}])test(`workspace exclusion survives ID and generation change ${JSON.stringify(exclude)}`,async t=>{
 const f=await fixture(t);await writeLimits({...unrestricted,exclude:[{workspace:f.home,...(exclude.provider?{provider:'claude' as const}:{})}]},null,f.path);
 await f.automatic('sessions',{});f.target.nativeId='new';f.target.generation='next';
 const list=await f.automatic('sessions',{});assert.deepEqual(list.candidates,[]);assert.deepEqual(list.excludeExpired,[]);
 assert.equal((await f.automatic('send',{ticket:issueTicket(f.target),id:'new',text:'hi'})).status,'target_excluded');assert.equal(f.count().writes,0);
});
test('automatic generation display follows fresh generation without manual registry edits',async t=>{
 const f=await fixture(t);assert.equal((await f.automatic('sessions',{})).candidates[0].change,'unknown');
 assert.equal((await f.automatic('sessions',{})).candidates[0].change,'none');f.target.generation='next';
 const list=await f.automatic('sessions',{});assert.equal(list.candidates[0].change,'generation_changed');assert.equal(list.offlineHidden,0);
 assert.equal((await f.automatic('send',{ticket:list.candidates[0].ticket,id:'next-gen',text:'hi'})).status,'submitted');
});

test('ID exclusion with a different workspace never reports an expired exclusion',async t=>{
 const f=await fixture(t);await writeLimits({...unrestricted,exclude:[{nativeId:'b',workspace:join(f.home,'elsewhere')}]},null,f.path);
 await f.automatic('sessions',{});f.target.nativeId='next-b';
 assert.deepEqual((await f.automatic('sessions',{})).excludeExpired,[]);
});

test('sessions default hides offline and unknown, counts hidden and observes every candidate',async t=>{
 const f=await fixture(t);
 const sessions=[f.caller,...(['online','offline','unknown',undefined] as const).map((status,i)=>({...f.target,nativeId:String(i),status}))];
 const automatic=createAutomatic({home:f.home,caller:async()=>({status:'ok',caller:f.caller}),scan:async()=>({sessions,codexWorkspace:'observed'}),scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd})},adapter:{read:async()=>null,send:async()=>({status:'rejected'})}});
 const result=await automatic('sessions',{});
 assert.deepEqual(result.candidates.map((n:any)=>n.nativeId),['0','3']);assert.equal(result.offlineHidden,2);
 const seen=JSON.parse(await readFile(join(f.home,'.seamless','seen.json'),'utf8'));assert.deepEqual(seen.map((n:any)=>n.nativeId),sessions.map(n=>n.nativeId));
 const all=await automatic('sessions',{includeOffline:true});assert.equal(all.candidates.length,4);assert.equal(all.offlineHidden,0);
 const filtered=await automatic('sessions',{includeOffline:false});assert.equal(filtered.candidates.length,2);assert.equal(filtered.offlineHidden,2);
});
test('sessions includeOffline rejects non-booleans through automatic and MCP',async t=>{
 const f=await fixture(t),call=await mcp(f.automatic);
 for(const includeOffline of [null,0,1,'true',[],{}]){
  await assert.rejects(f.automatic('sessions',{includeOffline}),/invalid_params/);
  assert.equal((await call('sessions',{includeOffline})).code,-32602);
 }
 assert.equal((await f.automatic('sessions',{})).offlineHidden,0);
});
test('CLI sessions --include-offline exposes unknown candidates and preserves JSON arguments',async t=>{
 const f=await fixture(t);f.target.status='unknown';
 assert.equal((await cli(f.automatic,['sessions'])).offlineHidden,1);
 const all=await cli(f.automatic,['sessions','--include-offline',JSON.stringify({scope:'any'})]);assert.equal(all.candidates.length,1);assert.equal(all.offlineHidden,0);
 await assert.rejects(cli(f.automatic,['sessions','--include-offline','--include-offline']),/invalid_arguments/);
 await assert.rejects(cli(f.automatic,['read','--include-offline']));
});
test('MCP advertises seamless server and boolean sessions includeOffline',async t=>{
 const f=await fixture(t),handle=createMcp({automatic:f.automatic});
 const init:any=await handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});assert.equal(init.result.serverInfo.name,'seamless');
 await handle({jsonrpc:'2.0',method:'notifications/initialized'});
 const list:any=await handle({jsonrpc:'2.0',id:2,method:'tools/list'});
 assert.deepEqual(list.result.tools.find((n:any)=>n.name==='sessions').inputSchema.properties.includeOffline,{type:'boolean'});
});
test('automatic MCP tools/list accepts typed cursor and _meta params and rejects others',async t=>{
 const f=await fixture(t),handle=createMcp({automatic:f.automatic});await handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}});await handle({jsonrpc:'2.0',method:'notifications/initialized'});
 // {_meta:{progressToken:0}} is what Codex 0.160 sends on startup (observed 2026-10-04).
 for(const params of [{},{cursor:'next'},{_meta:{progressToken:0}},{_meta:{progressToken:'t',extra:true}}]){const r:any=await handle({jsonrpc:'2.0',id:2,method:'tools/list',params});assert.equal(r.result.tools.length,4);}
 for(const params of [{caller:'x'},{cursor:null},{cursor:123},{_meta:false},{_meta:null},{_meta:[]},{_meta:{progressToken:true}},null,[]]){const bad:any=await handle({jsonrpc:'2.0',id:3,method:'tools/list',params});assert.equal(bad.error.code,-32602,JSON.stringify(params));}
});

for(const provider of ['claude','codex'] as const)for(const version of ['future','',null])test(`automatic strict caller gate ${provider} ${version} and default version display`,async t=>{
 const f=await fixture(t,[provider,provider]);f.caller.version=version;
 const listed=await f.automatic('sessions',{});assert.equal(listed.status,'ok');assert.equal(listed.caller.version,version||null);assert.equal(listed.caller.versionStatus,'unverified');
 assert.equal((await f.automatic('read',{target:`${provider}:b`})).status,'ok');
 await writeLimits({...unrestricted,strictVersions:true},null,f.path);const before=f.count();
 for(const [method,args] of [['sessions',{}],['read',{target:`${provider}:b`}],['send',{ticket:issueTicket(f.target),id:'blocked',text:'blocked'}]] as const){
  const denied=await f.automatic(method,args);assert.equal(denied.status,'unsupported_version');assert.equal(denied.version,version??'unknown');assert.equal(denied.reason,version??'unknown');
 }
 assert.deepEqual(f.count(),before);
 // limits touches only seamless's own file, so an updated (unverified) caller can still turn strict off.
 const got=await f.automatic('limits',{action:'get'});assert.equal(got.status,'ok');assert.equal(got.value.strictVersions,true);
 assert.equal((await f.automatic('limits',{action:'set',value:{...unrestricted,strictVersions:false}})).status,'ok');
 assert.equal((await f.automatic('sessions',{})).status,'ok');
});
for(const provider of ['claude','codex'] as const)test(`automatic strict target gate ${provider}, default read/send and verified/unverified display`,async t=>{
 const f=await fixture(t,[provider,provider]);f.caller.version=provider==='claude'?'2.1.286':'26.930.31730+12947';f.target.version='future';
 const normal=await f.automatic('sessions',{});assert.equal(normal.caller.versionStatus,'verified');assert.equal(normal.candidates[0].version,'future');assert.equal(normal.candidates[0].versionStatus,'unverified');
 const ticket=normal.candidates[0].ticket;
 assert.equal((await f.automatic('read',{target:`${provider}:b`})).status,'ok');assert.equal((await f.automatic('send',{ticket,id:'allowed',text:'hello'})).status,'submitted');
 await writeLimits({...unrestricted,strictVersions:true},null,f.path);
 const listed=await f.automatic('sessions',{includeOffline:true});assert.equal(listed.candidates[0].status,'unknown');assert.equal(listed.candidates[0].reason,'unsupported_version');assert.equal(listed.candidates[0].ticket,null);
 assert.equal((await f.automatic('sessions',{})).offlineHidden,1);
 const before=f.count();
 assert.equal((await f.automatic('read',{target:`${provider}:b`})).status,'unsupported_version');assert.equal((await f.automatic('send',{ticket,id:'blocked',text:'no'})).status,'unsupported_version');assert.equal(f.count().reads,before.reads);assert.equal(f.count().writes,before.writes);
 const current=await readLimits(f.path);assert.equal(current.status,'ok');if(current.status!=='ok')return;
 await writeLimits({...unrestricted,strictVersions:false},current.hash,f.path);
 assert.equal((await f.automatic('read',{target:`${provider}:b`})).status,'ok');
});

test('automatic sessions report verified and checking candidates and strict rejects checking',async t=>{
 const f=await fixture(t,['claude','claude']);f.caller.version='2.1.286';f.target.version='2.1.284';
 let list=await f.automatic('sessions',{});assert.equal(list.candidates[0].version,'2.1.284');assert.equal(list.candidates[0].versionStatus,'verified');
 f.target.version='2.1.287';list=await f.automatic('sessions',{});assert.equal(list.candidates[0].versionStatus,'checking');assert.equal(list.candidates[0].status,'online');
 assert.equal((await f.automatic('read',{target:'claude:b'})).status,'ok');
 await writeLimits({...unrestricted,strictVersions:true},null,f.path);
 list=await f.automatic('sessions',{includeOffline:true});assert.equal(list.candidates[0].versionStatus,'checking');assert.equal(list.candidates[0].reason,'unsupported_version');
 const before=f.count();assert.equal((await f.automatic('read',{target:'claude:b'})).status,'unsupported_version');assert.equal((await f.automatic('send',{ticket:issueTicket(f.target),id:'checking',text:'no'})).status,'unsupported_version');assert.equal(f.count().reads,before.reads);assert.equal(f.count().writes,before.writes);
});
test('strictVersions enabled at write-time blocks an unverified target',async t=>{
 const f=await fixture(t,['claude','claude']);f.caller.version='2.1.286';f.target.version='future';
 f.beforeWrite(async()=>{await writeLimits({...unrestricted,strictVersions:true},null,f.path);});
 const result=await f.automatic('send',{ticket:issueTicket(f.target),id:'strict-race',text:'no'});
 assert.equal(result.status,'unsupported_version');assert.equal(result.version,'future');assert.equal(f.count().writes,0);
});
