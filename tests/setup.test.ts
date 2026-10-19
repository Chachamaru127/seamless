import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';
import {performance} from 'node:perf_hooks';
import {runCli} from '../src/cli.ts';
import {runDoctor} from '../src/doctor.ts';
import {mcpRegistration, runSetup} from '../src/setup.ts';
import type {Automatic} from '../src/automatic.ts';

const unused:Automatic=async()=>({status:'caller_unobserved'});
async function home(t:test.TestContext):Promise<string>{
 const dir=await mkdtemp(join(tmpdir(),'seamless-setup-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 return dir;
}
async function cli(args:string[],dir:string):Promise<any>{
 let output='';
 const log=console.log;
 console.log=(value:unknown)=>{output+=String(value);};
 try{await runCli(args,unused,undefined,async()=>'',{home:dir});}finally{console.log=log;}
 return JSON.parse(output);
}
async function files(root:string):Promise<string[]>{
 const out:string[]=[];
 const walk=async(dir:string)=>{
  let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}
  for(const entry of entries){
   const full=join(dir,entry.name);
   if(entry.isDirectory())await walk(full);else out.push(relative(root,full));
  }
 };
 await walk(root);
 return out.sort();
}
const record=(over:Record<string,unknown>={})=>({version:'2.1.303',pid:41,sessionId:'waiting',cwd:'/tmp/work',startedAt:1000,kind:'interactive',status:'idle',messagingSocketPath:'/tmp/cc-socks/41.sock',...over});

test('setup lists the agents and registers one MCP server in a temporary home within ten seconds',async t=>{
 const dir=await home(t);
 await mkdir(join(dir,'.claude','sessions'),{recursive:true});
 await writeFile(join(dir,'.claude','sessions','41.json'),JSON.stringify(record()));
 const before=await files(dir);
 const started=performance.now();
 const out=await cli(['setup'],dir);
 const elapsed=performance.now()-started;
 assert.equal(out.status,'ok');
 assert.equal(out.dryRun,false);
 assert.ok(elapsed<10_000,`setup took ${elapsed}ms`);
 assert.deepEqual(out.destinations,[{id:'claude:waiting',product:'claude-code',workspace:'/tmp/work',state:'online'}]);
 const claude=out.agents.find((a:any)=>a.product==='claude-code');
 assert.equal(claude.installed,true);
 assert.equal(claude.sessions,1);
 assert.equal(claude.version,'2.1.303');
 assert.deepEqual(out.changes.map((c:any)=>[c.name,c.action]),[['seamless','added']]);
 // The only new file is the one MCP registration (no backup directory is created when the file did not exist).
 assert.deepEqual((await files(dir)).filter(f=>!before.includes(f)),['.claude.json']);
 const config=JSON.parse(await readFile(join(dir,'.claude.json'),'utf8'));
 assert.equal(config.mcpServers.seamless.command,process.execPath);
 assert.equal(config.mcpServers.seamless.type,'stdio');
 assert.equal(config.mcpServers.seamless.args.at(-1),'mcp');
 assert.match(config.mcpServers.seamless.args[0],/cli\.(ts|js)$/);
});

test('setup --dry-run reports the change and writes nothing',async t=>{
 const dir=await home(t);
 const file=join(dir,'.claude.json'),before=JSON.stringify({numStartups:3})+'\n';
 await writeFile(file,before,{mode:0o600});
 const out=await runSetup({home:dir,dryRun:true});
 assert.equal(out.status,'ok');
 assert.equal(out.dryRun,true);
 assert.deepEqual(out.changes.map(c=>[c.kind,c.action]),[['mcp_registration','would_add']]);
 assert.equal(await readFile(file,'utf8'),before);
 assert.deepEqual((await files(dir)).filter(f=>f!=='.claude.json'),[]);
});

test('a second setup leaves the registration unchanged and writes no backup',async t=>{
 const dir=await home(t);
 const first=await runSetup({home:dir});
 assert.equal(first.changes[0].action,'added');
 const bytes=await readFile(join(dir,'.claude.json'),'utf8');
 const second=await runSetup({home:dir});
 assert.equal(second.changes[0].action,'unchanged');
 assert.equal(second.backup,null);
 assert.equal(await readFile(join(dir,'.claude.json'),'utf8'),bytes);
 const backups=await readdir(join(dir,'.seamless')).catch(()=>[] as string[]);
 assert.equal(backups.includes('backups'),false);
});

test('setup backs up the old settings before changing them and keeps unrelated keys',async t=>{
 const dir=await home(t);
 const file=join(dir,'.claude.json'),before=JSON.stringify({theme:'dark',mcpServers:{other:{command:'x'}}})+'\n';
 await writeFile(file,before,{mode:0o600});
 const out=await runSetup({home:dir,now:()=>Date.parse('2026-10-19T01:02:03.456Z')});
 assert.equal(out.status,'ok');
 assert.equal(out.changes[0].action,'added');
 assert.ok(out.backup);
 assert.equal(await readFile(out.backup,'utf8'),before);
 assert.equal((await stat(out.backup)).mode&0o777,0o600);
 const config=JSON.parse(await readFile(file,'utf8'));
 assert.equal(config.theme,'dark');
 assert.equal(config.mcpServers.other.command,'x');
 assert.deepEqual(config.mcpServers.seamless,mcpRegistration());
});

test('setup refuses an unreadable settings file without writing or backing up',async t=>{
 const dir=await home(t);
 const file=join(dir,'.claude.json'),before='{not json\n';
 await writeFile(file,before,{mode:0o600});
 const out=await runSetup({home:dir});
 assert.equal(out.status,'config_unusable');
 assert.deepEqual(out.changes,[]);
 assert.equal(out.backup,null);
 assert.equal(await readFile(file,'utf8'),before);
 assert.equal((await files(dir)).includes('.seamless/backups'),false);
});

test('doctor --json prints node, products, inbox, compatibility, Reason hooks and Antigravity',async t=>{
 const dir=await home(t);
 await mkdir(join(dir,'.claude','sessions'),{recursive:true});
 await writeFile(join(dir,'.claude','sessions','41.json'),JSON.stringify(record()));
 const {messagingSocketPath:_socket,...withoutSocket}=record({pid:42,sessionId:'nosocket'});
 await writeFile(join(dir,'.claude','sessions','42.json'),JSON.stringify(withoutSocket));
 const bin=join(dir,'bin');
 await mkdir(bin);
 for(const name of ['claude','codex','opencode','cursor','grok']){
  const file=join(bin,name);
  await writeFile(file,'#!/bin/sh\necho "1.2.3"\n');await chmod(file,0o755);
 }
 const oldPath=process.env.PATH;
 process.env.PATH=bin;
 try{
  const out=await cli(['doctor','--json'],dir);
  assert.equal(out.status,'ok');
  assert.equal(out.node.ok,true);
  assert.equal(typeof out.reason_network_hooks,'boolean');
  assert.equal(out.reason_network_hooks,false);
  assert.ok(out.antigravity);
  assert.equal(out.antigravity.binary,null);
  assert.equal(out.antigravity.hooks,false);
  assert.equal(out.inbox.claude.sessions,2);
  assert.equal(out.inbox.claude.reachable,1);
  assert.equal(out.inbox.claude.unreachable,1);
  assert.ok(Array.isArray(out.products));
  assert.equal(out.products.length,7);
  assert.equal(out.products.find((p:any)=>p.product==='claude-code').version,'1.2.3');
  assert.ok(out.compatibility.entries>=7);
 }finally{process.env.PATH=oldPath;}
});

test('doctor finds Reason Network hooks, Antigravity hooks and the T3-managed executable',async t=>{
 const dir=await home(t);
 const platform=`darwin-${process.arch}`;
 const root=join(dir,'.t3-ja','tools','antigravity-acp',platform);
 const release='abc12345';
 const versionDir=join(root,'versions',release);
 await mkdir(versionDir,{recursive:true});
 await writeFile(join(root,'active.json'),JSON.stringify({releaseId:release}));
 const binary=join(versionDir,'agy_acp_server.par');
 await writeFile(binary,'#!/bin/sh\nexit 0\n');await chmod(binary,0o755);
 await writeFile(join(versionDir,'.install-complete.json'),JSON.stringify({releaseId:release,version:'1.1.1',executable:{name:'agy_acp_server.par'}}));
 await mkdir(join(dir,'.claude'),{recursive:true});
 await writeFile(join(dir,'.claude','settings.json'),JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:'/usr/local/bin/reason-network hook'}]}]}}));
 await mkdir(join(dir,'.gemini','antigravity-cli'),{recursive:true});
 await writeFile(join(dir,'.gemini','antigravity-cli','settings.json'),JSON.stringify({hooks:{BeforeAgent:[{hooks:[{type:'command',command:'seamless-hook'}]}]}}));
 const out=await runDoctor({home:dir,env:{PATH:'/nonexistent'},versionCommand:async()=>null});
 assert.equal(out.reason_network_hooks,true);
 assert.equal(out.antigravity.binary,binary);
 assert.equal(out.antigravity.hooks,true);
 const antigravity=out.products.find(p=>p.product==='antigravity');
 assert.equal(antigravity?.installed,true);
 assert.equal(antigravity?.version,'1.1.1');
 assert.equal(antigravity?.versionStatus,'checking');
});

test('doctor does not mistake an ordinary hook or a comment for a Reason wiring',async t=>{
 const dir=await home(t);
 await mkdir(join(dir,'.codex'),{recursive:true});
 await writeFile(join(dir,'.codex','config.toml'),'# reason-network is not wired here\n[ui]\ntheme = "dark"\n[[hooks.Stop]]\ncommand = "seamless-grok-hook"\n');
 const out=await runDoctor({home:dir,env:{PATH:'/nonexistent'},versionCommand:async()=>null});
 assert.equal(out.reason_network_hooks,false);
});
