import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
function records(){return ['a','b'].map((id,i)=>({id,provider:i?'claude':'codex',nativeId:`native-${id}`,generation:'g1',host:'local',displayName:id,workspace:'/w',operations:['read','send'],grants:['read','send'].flatMap(operation=>['inbound','outbound'].map(direction=>({peer:i?'a':'b',operation,direction})))}));}
async function fixture(fn:(path:string)=>Promise<void>){const dir=await mkdtemp(join(tmpdir(),'claudex-process-'));const path=join(dir,'registry.json');try{await writeFile(path,JSON.stringify({sessions:records()}),{mode:0o600});await fn(path);}finally{await rm(dir,{recursive:true,force:true});}}
function start(path:string,entry='tests/support/serve-fixture.ts',extraEnv={}){
 const child=spawn(process.execPath,[entry,...(entry==='src/cli.ts'?['mcp']:[]),'--registry',path,'--caller','a'],{cwd:process.cwd(),env:{...process.env,...extraEnv},stdio:['pipe','pipe','pipe']});
 const closed=once(child,'close');
 let stderr='';child.stderr.on('data',x=>stderr+=x);const queue:any[]=[],waiters:((x:any)=>void)[]=[];
 const rl=createInterface({input:child.stdout});rl.on('line',line=>{const value=JSON.parse(line);const waiter=waiters.shift();if(waiter)waiter(value);else queue.push(value);});
 const next=()=>queue.length?Promise.resolve(queue.shift()):new Promise<any>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(`child timeout: ${stderr}`)),5000);waiters.push(x=>{clearTimeout(timeout);resolve(x)});});
 return {child,next,send:(value:any)=>child.stdin.write(JSON.stringify(value)+'\n'),raw:(line:string)=>child.stdin.write(line+'\n'),stop:async()=>{child.stdin.end();await closed;rl.close();},stderr:()=>stderr};
}
const query={operation:'send'};
test('production CLI and MCP sessions share output and ignore environment online injection',async()=>fixture(async path=>{
 const cli=spawnSync(process.execPath,['src/cli.ts','sessions','--registry',path,'--caller','a'],{encoding:'utf8',env:{...process.env,CLAUDEX_OBSERVER:'online',CLAUDEX_TEST_OBSERVER:'online'}});assert.equal(cli.status,0,cli.stderr);
 const p=start(path,'src/cli.ts');try{p.send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}});const init=await p.next();assert.equal(init.result.protocolVersion,'2025-06-18');p.send({jsonrpc:'2.0',method:'notifications/initialized'});p.send({jsonrpc:'2.0',id:2,method:'tools/list'});const tools=await p.next();assert.deepEqual(tools.result.tools.map((x:any)=>x.name),['sessions']);p.send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'sessions',arguments:query}});const result=await p.next();assert.deepEqual(JSON.parse(result.result.content[0].text),JSON.parse(cli.stdout));assert(!cli.stdout.includes('online'));}finally{await p.stop();}
}));
test('serve rejects sender spoof and unsupported operation; consumes binding once',async()=>fixture(async path=>{
 const p=start(path);try{p.send({id:1,method:'sessions',params:{...query,sender:'b'}});assert.equal((await p.next()).error.code,'invalid_params');p.send({id:2,method:'sessions',params:{operation:'delete'}});assert.equal((await p.next()).error.code,'invalid_params');p.send({id:3,method:'select',params:query});const s=(await p.next()).result;assert.equal(s.status,'selected');p.send({id:4,method:'revalidate',params:{binding:s.binding}});assert.equal((await p.next()).result.status,'validated');p.send({id:5,method:'revalidate',params:{binding:s.binding}});assert.equal((await p.next()).result.status,'consumed');const p2=start(path);try{p2.send({id:6,method:'revalidate',params:{binding:s.binding}});assert.equal((await p2.next()).result.status,'invalid_binding');}finally{await p2.stop();}}finally{await p.stop();}
}));
for(const change of ['revoked','invalid','caller-replaced'])test(`persistent process refuses ${change} registry on next request`,async()=>fixture(async path=>{
 const p=start(path);try{p.send({id:1,method:'select',params:query});const selected=(await p.next()).result;assert.equal(selected.status,'selected');const rs=records();if(change==='revoked')rs[1].grants=[];if(change==='caller-replaced')rs[0].generation='g2';await writeFile(path,change==='invalid'?'FAKE_SECRET_INVALID_JSON':JSON.stringify({sessions:rs}));p.send({id:2,method:'revalidate',params:{binding:selected.binding}});const r=await p.next();assert.notEqual(r.result?.status,'validated');if(change==='invalid')assert.equal(r.error.code,'registry_unavailable');assert(!JSON.stringify(r).includes('FAKE_SECRET'));assert(!p.stderr().includes('FAKE_SECRET'));}finally{await p.stop();}
}));
test('oversized and malformed lines are sanitized and subsequent request works',async()=>fixture(async path=>{
 const p=start(path);try{p.raw('FAKE_SECRET_BAD_JSON');const malformed=await p.next();assert.equal(malformed.error.code,'invalid_request');assert(!JSON.stringify(malformed).includes('FAKE_SECRET'));p.raw('x'.repeat(65537));const huge=await p.next();assert.equal(huge.id,null);assert.equal(huge.error.code,'invalid_request');p.send({id:3,method:'sessions',params:query});assert.equal((await p.next()).result.status,'ok');assert(!p.stderr().includes('FAKE_SECRET'));}finally{await p.stop();}
}));
for(const kind of ['online','self-grant','duplicate','mode','symlink','json-secret'])test(`CLI rejects ${kind} bootstrap without echoing values`,async()=>fixture(async path=>{
 const rs:any[]=records();if(kind==='online')rs[1].status='online';if(kind==='self-grant')rs[0].grants.push({peer:'a',operation:'send',direction:'outbound'});if(kind==='duplicate')rs.push(rs[0]);await writeFile(path,kind==='json-secret'?'FAKE_SECRET_INVALID_JSON':JSON.stringify({sessions:rs}));if(kind==='mode')await chmod(path,0o644);let input=path;if(kind==='symlink'){input=path+'.link';await symlink(path,input);}const result=spawnSync(process.execPath,['src/cli.ts','sessions','--registry',input,'--caller','a'],{encoding:'utf8'});assert.notEqual(result.status,0);assert(!`${result.stdout}${result.stderr}`.includes('FAKE_SECRET'));assert(!result.stderr.includes('SyntaxError'));
}));
test('MCP rejects spoof arguments and unknown read/send tools',async()=>fixture(async path=>{
 const p=start(path,'src/cli.ts');try{p.send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}}});await p.next();p.send({jsonrpc:'2.0',method:'notifications/initialized'});for(const name of ['read','send','sessions']){p.send({jsonrpc:'2.0',id:name,method:'tools/call',params:{name,arguments:{...query,sender:'b'}}});const r=await p.next();assert(r.error||r.result?.isError);}}finally{await p.stop();}
}));
test('FIFO registry is rejected without blocking startup',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'claudex-fifo-')),path=join(dir,'registry.json');
 try{const mk=spawnSync('mkfifo',[path]);assert.equal(mk.status,0);await chmod(path,0o600);
 const result=spawnSync(process.execPath,['src/cli.ts','sessions','--registry',path,'--caller','a'],{encoding:'utf8',timeout:3000});
 assert.equal(result.status,1);assert.equal(result.error,undefined);assert.equal(JSON.parse(result.stderr).error.code,'bootstrap_invalid');
 }finally{await rm(dir,{recursive:true,force:true});}
});
