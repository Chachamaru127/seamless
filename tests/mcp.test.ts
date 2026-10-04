import test from 'node:test';
import assert from 'node:assert/strict';
import { Registry } from '../src/registry.ts';
import { createMcp } from '../src/mcp.ts';
const record={id:'a',provider:'codex',nativeId:'a',generation:'1',host:'local',displayName:'a',workspace:'/w',operations:['send'],grants:[]} as any;
test('ID-bearing initialized request does not advance ready state',async()=>{
 const handle=createMcp({registry:new Registry([record]),caller:'a'});
 await handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}});
 const bad:any=await handle({jsonrpc:'2.0',id:2,method:'notifications/initialized'});assert.equal(bad.error.code,-32600);
 const early:any=await handle({jsonrpc:'2.0',id:3,method:'tools/list'});assert.equal(early.error.message,'not_initialized');
 assert.equal(await handle({jsonrpc:'2.0',method:'notifications/initialized'}),undefined);
 const valid:any=await handle({jsonrpc:'2.0',id:4,method:'tools/list'});assert.equal(valid.result.tools[0].name,'sessions');
});
test('native tools distinguish read-only operations from send',async()=>{
 const handle=createMcp({registry:new Registry([record]),caller:'a',adapter:{read:async()=>({status:'empty'}),send:async()=>({status:'submitted'})}});
 await handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}});
 await handle({jsonrpc:'2.0',method:'notifications/initialized'});
 const response:any=await handle({jsonrpc:'2.0',id:2,method:'tools/list'});
 assert.deepEqual(response.result.tools.map((tool:any)=>[tool.name,tool.annotations]),[
  ['sessions',{readOnlyHint:true,destructiveHint:false}],['read',{readOnlyHint:true,destructiveHint:false}],['send',{readOnlyHint:false,destructiveHint:false}]
 ]);
});
