import test from 'node:test';
import assert from 'node:assert/strict';
import {projectClaudeSentIds} from '../src/adapters/claude.ts';
import {projectCodexSentIds} from '../src/adapters/codex.ts';
import {issueTicket} from '../src/automatic.ts';
import {verifyInbound} from '../src/inbound.ts';
import type {Registration} from '../src/protocol.ts';
const recipient={provider:'codex' as const,nativeId:'b'};
const ticket=issueTicket({...recipient,generation:'g',cwd:'/tmp'});
const target:Registration={id:'claude:a',provider:'claude',nativeId:'a',generation:'g',workspace:'/tmp',host:'local',displayName:'a',operations:['read'],grants:[]};
test('Claude sends project only matching IDs from assistant tool use',()=>{
 const line=(type:string,name:string,input:unknown)=>JSON.stringify({sessionId:'a',type,uuid:'u',message:{content:[{type:'tool_use',name,input}]}});
 assert.deepEqual(projectClaudeSentIds([line('assistant','mcp__claudex__send',{id:'one',ticket,text:'hidden'}),line('assistant','Bash',{command:`node cli.ts send '${JSON.stringify({id:'two',ticket,text:'hidden'})}'`}),line('user','Bash',{command:'send fake'})],'a',['one','two','fake'],recipient),['one','two']);
});
test('Codex sends require claudex server and exact argument ID',()=>{
 const item=(server:string,id:string)=>({type:'mcpToolCall',server,tool:'send',arguments:{id,ticket,text:'hidden'}});
 assert.deepEqual(projectCodexSentIds({turns:[{items:[item('claudex','one'),item('other','fake'),{type:'agentMessage',text:'send fake'}]}]},['one','fake'],recipient),['one']);
});
test('inbound verifies recorded send, keeps forgery declared, returns no body',async()=>{
 const received=['one','fake'].map(id=>({id,sender:{id:'claude:a',nativeId:'a',generation:'g'},recipient:{id:'codex:b',nativeId:'b',generation:'g'},at:new Date(1000).toISOString()}));
 const result=await verifyInbound({caller:{...target,id:'codex:b',provider:'codex',nativeId:'b'},received,targets:[target],now:1000,canRead:async()=>true,sentIds:async()=>['one']});
 assert.deepEqual(result.map(r=>r.sender),['verified','declared']);assert.deepEqual(Object.keys(result[0]).sort(),['at','from','id','sender']);
});
test('inbound filters recipient and time, caps at ten, and honors read denial',async()=>{
 const received=Array.from({length:15},(_,i)=>({id:String(i),sender:{id:'claude:a',nativeId:'a',generation:'g'},recipient:{id:'codex:b',nativeId:'b',generation:'g'},at:new Date(1000+i).toISOString()}));
 received.push({...received[0],id:'old',at:new Date(0).toISOString()},{...received[0],id:'future',at:new Date(999999999).toISOString()},{...received[0],id:'wrong',recipient:{...received[0].recipient,nativeId:'other'}});
 let reads=0;
 const result=await verifyInbound({caller:{...target,id:'codex:b',provider:'codex',nativeId:'b'},received,targets:[target],now:86400500,canRead:async()=>false,sentIds:async()=>{reads++;return ['14'];}});
 assert.equal(result.length,10);assert.equal(result[0].id,'14');assert.equal(result.every(r=>r.sender==='declared'),true);assert.equal(reads,0);
});
test('sender generation mismatch and read failure stay declared',async()=>{
 const received=[{id:'one',sender:{id:'claude:a',nativeId:'a',generation:'old'},recipient:{id:'codex:b',nativeId:'b',generation:'g'},at:new Date(1000).toISOString()}];
 const options={caller:{...target,id:'codex:b',provider:'codex' as const,nativeId:'b'},received,targets:[target],now:1000,canRead:async()=>true,sentIds:async():Promise<string[]>=>{throw Error('hidden');}};
 assert.equal((await verifyInbound(options))[0].sender,'declared');received[0].sender.generation='g';assert.equal((await verifyInbound(options))[0].sender,'declared');
});

for(const provider of ['claude','codex'] as const)test(`${provider} inbound rejects short IDs, unrelated calls and other destinations`,async()=>{
 const caller={...target,...recipient,id:'codex:b'};
 const wrongTicket=issueTicket({...recipient,nativeId:'other',generation:'g',cwd:'/tmp'});
 const wrongProvider=issueTicket({...recipient,provider:'claude',generation:'g',cwd:'/tmp'});
 const calls=[{id:'actual-send',ticket},{id:'same',ticket:wrongTicket},{id:'provider',ticket:wrongProvider},{id:'no-target'}, {id:'ok',ticket}];
 const line=(name:string,input:unknown)=>JSON.stringify({sessionId:'a',type:'assistant',message:{content:[{type:'tool_use',name,input}]}});
 const lines=[...calls.map(input=>line('mcp__claudex__send',input)),line('Read',{file_path:'send'}),line('Bash',{command:'echo send a'}),line('Bash',{command:`node cli.ts send 'not json send a'`})];
 const state={turns:[{items:[...calls.map(arguments_=>({type:'mcpToolCall',server:'claudex',tool:'send',arguments:arguments_})),{type:'mcpToolCall',server:'other',tool:'send',arguments:{id:'send',ticket}},{type:'mcpToolCall',server:'claudex',tool:'send',arguments:'send a'}]}]};
 const received=['send','a','same','provider','no-target','ok'].map(id=>({id,sender:{id:'claude:a',nativeId:'a',generation:'g'},recipient:{id:'codex:b',nativeId:'b',generation:'g'},at:new Date(1000).toISOString()}));
 const result=await verifyInbound({caller,received,targets:[target],now:1000,canRead:async()=>true,sentIds:async(_target,ids,to)=>provider==='claude'?projectClaudeSentIds(lines,'a',ids,to):projectCodexSentIds(state,ids,to)});
 assert.deepEqual(result.map(r=>r.sender),['declared','declared','declared','declared','declared','verified']);
});
test('Bash evidence accepts literal cli.ts send JSON only with exact ID and recipient',()=>{
 const line=(command:string)=>JSON.stringify({sessionId:'a',type:'assistant',message:{content:[{type:'tool_use',name:'Bash',input:{command}}]}});
 const args=JSON.stringify({id:'send',ticket,text:'with spaces'});
 const valid=`node /tmp/cli.ts send '${args}'`;
 assert.deepEqual(projectClaudeSentIds([line(valid)],'a',['send','s'],recipient),['send']);
 for(const command of [`echo ${valid}`,`${valid} && echo done`,`node cli.ts send '{broken}'`,`node cli.ts send '${JSON.stringify({id:'sender',ticket})}'`,`node cli.ts send '$ARGS'`])assert.deepEqual(projectClaudeSentIds([line(command)],'a',['send'],recipient),[]);
});
test('Codex JSON arguments and explicit target require exact recipient',()=>{
 const call=(args:unknown)=>({turns:[{items:[{type:'mcpToolCall',server:'claudex',tool:'send',arguments:args}]}]});
 assert.deepEqual(projectCodexSentIds(call(JSON.stringify({id:'x',target:'codex:b'})),['x'],recipient),['x']);
 assert.deepEqual(projectCodexSentIds(call({id:'x',target:'claude:b'}),['x'],recipient),[]);
});
