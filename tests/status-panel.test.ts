import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createMcp} from '../src/mcp.ts';
import {createAutomatic,type Automatic} from '../src/automatic.ts';
import {statusHtml,summarizeStatus,statusPanelTool,statusResource} from '../src/status-panel.ts';
import {peersOf,companiesOf} from '../src/status-exchanges.ts';

async function connection(automatic:Automatic){
 const handle=createMcp({automatic});let id=0;
 const call=async(method:string,params?:unknown)=>await handle({jsonrpc:'2.0',id:++id,method,...(params===undefined?{}:{params})}) as any;
 const init=await call('initialize',{protocolVersion:'2025-06-18'});
 await handle({jsonrpc:'2.0',method:'notifications/initialized'});
 return {call,init};
}
const data={status:'ok',caller:{provider:'codex',nativeId:'12345678-private',source:'codex-turn-metadata',version:'1',versionStatus:'tested'},candidates:[{id:'claude:abcdefgh-private',provider:'claude',nativeId:'abcdefgh-private',generation:'hash-secret',cwd:'/private/work/project',status:'online',ticket:'ticket-secret',requests:[{id:'request-private',at:'2026-10-05T00:00:00Z',delivery:'rejected',text:'body-secret',stages:[]}]}],inbound:[]};
test('status resource and tool contract preserve existing tools',async()=>{
 const {call,init}=await connection(async()=>data);
 assert.deepEqual(init.result.capabilities,{tools:{},resources:{}});
 assert.deepEqual((await call('resources/list')).result,{resources:[statusResource]});
 assert.deepEqual((await call('resources/read',{uri:statusResource.uri})).result,{contents:[{uri:statusResource.uri,mimeType:statusResource.mimeType,text:statusHtml}]});
 assert.equal((await call('resources/read',{uri:'ui://other'})).error.code,-32002);
 assert.equal((await call('resources/read',{uri:1})).error.code,-32602);
 const tools=(await call('tools/list')).result.tools;
 assert.deepEqual(tools.map((t:any)=>t.name),['sessions','read','send','limits','status_panel']);
 assert.deepEqual(tools[4],statusPanelTool);
 assert.deepEqual(tools[4]._meta,{ui:{resourceUri:'ui://seamless/status',visibility:['app']},'ui/resourceUri':'ui://seamless/status','openai/ui':{entrypoints:[{type:'thread'}]}});
 assert.deepEqual(tools[4].annotations,{readOnlyHint:true,openWorldHint:false});
 for(const t of tools.slice(0,4)){assert.equal(t._meta,undefined);assert.equal(t.inputSchema.additionalProperties,false);}
});
test('panel calls only sessions with the original context and peek, and projects private fields away',async()=>{
 const calls:unknown[]=[];const {call}=await connection(async(...args)=>{calls.push(args);return data;});
 const meta={'x-codex-turn-metadata':{session_id:'12345678-private'}};
 const response=await call('tools/call',{name:'status_panel',arguments:{},_meta:meta});
 assert.deepEqual(calls,[['sessions',{scope:'any',peek:true},{kind:'mcp',meta}]]);
 assert.deepEqual(response.result.content,[]);
 const result=response.result.structuredContent;
 assert.deepEqual(result.caller,{provider:'codex',nativeIdShort:'12345678',source:'codex-turn-metadata',version:'1',versionStatus:'tested'});
 assert.deepEqual(result.companies,[{name:'Claude',count:1,color:'#fe3a52'}]);
 assert.deepEqual(result.peers,[{provider:'claude',nativeIdShort:'abcdefgh',folder:'project',status:'online',latest:{label:'届かなかった',color:'#fe3a52'}}]);
 assert.ok(Number.isFinite(Date.parse(result.observedAt)));
 for(const privateValue of ['ticket','body-secret','hash-secret','/private/work','12345678-private','abcdefgh-private','request-private'])assert.ok(!JSON.stringify(result).includes(privateValue));
 assert.equal((await call('tools/call',{name:'status_panel',arguments:{caller:'fake'}})).error.code,-32602);
 assert.equal(calls.length,1);
});
test('panel preserves non-ok status and reason with empty fields',async()=>{
 for(const status of ['caller_unobserved','limits_unusable']){
  const {call}=await connection(async()=>({status,reason:'probe'}));
  const r=(await call('tools/call',{name:'status_panel',arguments:{}})).result.structuredContent;
  assert.equal(r.status,status);assert.equal(r.reason,'probe');assert.equal(r.caller,null);assert.deepEqual(r.companies,[]);assert.deepEqual(r.peers,[]);
 }
});
test('actual automatic observer receives metadata and panel leaves seen unchanged',async()=>{
 const home=new URL('../.local/build/batch16-fixture/',import.meta.url).pathname;
 await mkdir(home+'.seamless',{recursive:true});
 const seen=home+'.seamless/seen.json';await writeFile(seen,'sentinel');
 const meta={'x-codex-turn-metadata':{session_id:'caller123456'}};let count=0;
 const caller={provider:'codex' as const,nativeId:'caller123456',generation:'g',cwd:home,socket:'unused',source:'codex-turn-metadata' as const};
 const peer={provider:'claude' as const,nativeId:'peer12345678',generation:'g',cwd:home,socket:'unused'};
 const automatic=createAutomatic({home,adapter:{read:async()=>{throw Error('body read forbidden');},send:async()=>{throw Error('send forbidden');},received:async()=>[{id:'received-private',sender:{id:'claude:'+peer.nativeId,nativeId:peer.nativeId,generation:'g'},recipient:{id:'codex:'+caller.nativeId,nativeId:caller.nativeId,generation:'g'},at:new Date().toISOString()}],sentIds:async()=>['received-private']},caller:async context=>{assert.deepEqual(context,{kind:'mcp',meta});count++;return {status:'ok',caller};},scan:async()=>({sessions:[caller,peer],codexWorkspace:'observed'}),scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd})}});
 const {call}=await connection(automatic);
 const r=(await call('tools/call',{name:'status_panel',arguments:{},_meta:meta})).result.structuredContent;
 assert.equal(r.status,'ok');assert.equal(r.caller.source,'codex-turn-metadata');assert.ok(count>0);
 assert.deepEqual(r.companies,[{name:'Claude',count:1,color:'#38c68e'}]);
 assert.equal(r.peers[0].nativeIdShort,'peer1234');assert.equal(r.peers[0].latest.label,'受け取った');
 assert.equal(await readFile(seen,'utf8'),'sentinel');
});
test('band aggregation implementation is identical except explicit Node imports',async()=>{
 const band=await readFile(new URL('../mods/seamless-band/hooks/exchanges.ts',import.meta.url),'utf8');
 const node=await readFile(new URL('../src/status-exchanges.ts',import.meta.url),'utf8');
 assert.equal(node.replace(': { color: string; label: string }', '').replaceAll('../mods/seamless-band/hooks/appearance.ts','./appearance').replaceAll('../mods/seamless-band/hooks/text.ts','./text'),band);
 for(const [stages,delivery,color] of [[[],'pending','#8d8b85'],[[],'rejected','#fe3a52'],[[{stage:'reached',status:'observed'}],'submitted','#f9a437'],[[{stage:'processing',status:'observed'}],'submitted','#38c68e'],[[{stage:'replied',status:'observed'}],'submitted','#38c68e']] as const){
  const sample=structuredClone(data);Object.assign(sample.candidates[0].requests[0],{stages,delivery});
  assert.equal(summarizeStatus(sample).companies[0].color,color);
  assert.equal(companiesOf(peersOf(JSON.stringify(sample)))[0].color,color);
 }
 const sample=structuredClone(data);sample.candidates[0].requests=[];
 assert.deepEqual(summarizeStatus(sample).companies,[]);
});
test('HTML is self contained, safe to render, and only calls the status tool',()=>{
 assert.doesNotMatch(statusHtml,/https?:|\/\/|innerHTML|fetch\s*\(|XMLHttpRequest|setInterval/);
 assert.match(statusHtml,/textContent/);
 assert.deepEqual([...statusHtml.matchAll(/request\('tools\/call',\{name:'([^']+)'/g)].map(m=>m[1]),['status_panel']);
 assert.match(statusHtml,/protocolVersion:'2026-01-26'/);
 assert.match(statusHtml,/ui\/notifications\/initialized/);
 assert.match(statusHtml,/ui\/notifications\/tool-result/);
 assert.match(statusHtml,/event.source!==window.parent/);
});

test('HTML handshake, host result and manual refresh use JSON-RPC without automatic polling',async()=>{
 const {runInNewContext}=await import('node:vm');
 class Element {
  textContent='';style:Record<string,string>={};className='';disabled=false;children:unknown[]=[];
  listeners:Record<string,()=>Promise<void>>={};content={cloneNode:()=>new Element()};
  append(...nodes:unknown[]){this.children.push(...nodes);}
  replaceChildren(){this.children=[];}
  addEventListener(name:string,fn:()=>Promise<void>){this.listeners[name]=fn;}
 }
 const elements=new Map<string,Element>();const get=(id:string)=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)!;};
 const messages:any[]=[];let receive:(e:any)=>void=()=>{};
 const parent={postMessage:(m:unknown)=>messages.push(m)};
 runInNewContext(statusHtml.match(/<script>([\s\S]*?)<\/script>/)![1],{
  document:{getElementById:get,createElement:()=>new Element()},
  window:{parent,addEventListener:(_name:string,fn:typeof receive)=>{receive=fn;}},
  setTimeout:()=>1,clearTimeout:()=>{}
 });
 assert.equal(messages.length,1);assert.equal(messages[0].method,'ui/initialize');
 assert.equal(messages[0].params.protocolVersion,'2026-01-26');
 receive({source:{},data:{jsonrpc:'2.0',id:messages[0].id,result:{}}});await Promise.resolve();assert.equal(messages.length,1);
 receive({source:parent,data:{jsonrpc:'2.0',id:messages[0].id,result:{}}});await Promise.resolve();
 assert.equal(messages[1].method,'ui/notifications/initialized');assert.equal(messages.length,2);
 const payload=summarizeStatus(data);
 receive({source:parent,data:{jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:payload}}});
 assert.match(get('caller').textContent,/Codex 12345678（codex-turn-metadata）/);assert.equal(get('companies').children.length,1);
 const refresh=get('refresh').listeners.click();
 assert.deepEqual(JSON.parse(JSON.stringify(messages[2].params)),{name:'status_panel',arguments:{}});
 receive({source:parent,data:{jsonrpc:'2.0',id:messages[2].id,result:{structuredContent:summarizeStatus({status:'caller_unobserved',reason:'probe'})}}});
 await refresh;
 assert.equal(get('reason').textContent,'この会話を特定できませんでした');assert.equal(get('companies').children.length,0);assert.equal(messages.length,3);
});
test('panel-only MCP lists just status_panel, refuses the four tools, and keeps the resource',async()=>{
 const seen:string[]=[];
 const handle=createMcp({automatic:async(method:string)=>{seen.push(method);return data;},panelOnly:true});let id=0;
 const call=async(method:string,params?:unknown)=>await handle({jsonrpc:'2.0',id:++id,method,...(params===undefined?{}:{params})}) as any;
 assert.deepEqual((await call('initialize',{protocolVersion:'2025-06-18'})).result.capabilities,{tools:{},resources:{}});
 await handle({jsonrpc:'2.0',method:'notifications/initialized'});
 assert.deepEqual((await call('tools/list')).result.tools,[statusPanelTool]);
 assert.deepEqual((await call('resources/list')).result,{resources:[statusResource]});
 for(const name of ['sessions','read','send','limits'])assert.equal((await call('tools/call',{name,arguments:{}})).error.code,-32602);
 assert.deepEqual(seen,[]);
 assert.equal((await call('tools/call',{name:'status_panel',arguments:{}})).result.structuredContent.status,'ok');
 assert.deepEqual(seen,['sessions']);
});
