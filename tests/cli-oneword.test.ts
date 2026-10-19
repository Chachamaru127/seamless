import test from 'node:test';
import assert from 'node:assert/strict';
import {runCli} from '../src/cli.ts';
import type {Automatic} from '../src/automatic.ts';
async function cli(automatic:Automatic,args:string[]){
 let output='';const log=console.log;console.log=(v:unknown)=>{output+=String(v);};
 try{await runCli(args,automatic);}finally{console.log=log;}
 return output?JSON.parse(output):null;
}
const candidate=(id:string,ticket:string|null=`ticket-${id}`,send=true)=>({id,provider:id.split(':')[0],host:'local',nativeId:id.split(':')[1],generation:'g',cwd:'/work',version:null,status:'online',reason:null,requests:[],operations:{read:true,send},ticket});
const calls:{method:string;input:any}[]=[];
const fake=(listing:unknown):Automatic=>async(method,input)=>{calls.push({method,input});return method==='sessions'?listing:{status:'submitted',id:'r1'};};
test('one candidate in the workspace receives the text',async()=>{
 calls.length=0;
 const out=await cli(fake({status:'ok',candidates:[candidate('codex:b')]}),['このテスト、落ちてる']);
 assert.deepEqual(calls.map(c=>c.method),['sessions','send']);
 assert.deepEqual(calls[0].input,{operation:'send',scope:'current_work'});
 assert.deepEqual(calls[1].input,{ticket:'ticket-codex:b',text:'このテスト、落ちてる'});
 assert.equal(out.status,'submitted');assert.equal(out.target,'codex:b');
});
test('two or more candidates stop before the write and list them',async()=>{
 calls.length=0;
 const out=await cli(fake({status:'ok',candidates:[candidate('claude:a'),candidate('codex:b')]}),['このテスト、落ちてる']);
 assert.deepEqual(calls.map(c=>c.method),['sessions']);
 assert.equal(out.status,'ambiguous');
 assert.deepEqual(out.candidates.map((c:any)=>c.id),['claude:a','codex:b']);
});
test('nothing sendable, or an unobserved caller, never writes',async()=>{
 calls.length=0;
 assert.deepEqual(await cli(fake({status:'ok',candidates:[candidate('codex:b',null),candidate('claude:a','ticket-claude:a',false)]}),['だれか']),{status:'target_unavailable'});
 assert.deepEqual(calls.map(c=>c.method),['sessions']);
 calls.length=0;
 assert.deepEqual(await cli(fake({status:'caller_unavailable'}),['だれか']),{status:'caller_unavailable'});
 assert.deepEqual(calls.map(c=>c.method),['sessions']);
});
test('a command name is still a command, not text',async()=>{
 calls.length=0;
 await cli(fake({status:'ok',candidates:[candidate('codex:b')]}),['sessions']);
 assert.deepEqual(calls,[{method:'sessions',input:{}}]);
});
test('a bot- word is refused rather than sent as text',async()=>{
 calls.length=0;
 await assert.rejects(()=>cli(fake({status:'ok',candidates:[candidate('codex:b')]}),['bot-read']),/invalid_arguments/);
 assert.deepEqual(calls,[]);
});
