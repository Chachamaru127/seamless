import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
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
async function withPath<T>(path:string,run:()=>Promise<T>):Promise<T>{
 const old=process.env.PATH;
 process.env.PATH=path;
 try{return await run();}
 finally{process.env.PATH=old;}
}
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const CURSOR_HOOK=join(ROOT,'hooks','cursor','seamless-hook.sh');
const GROK_HOOK=join(ROOT,'hooks','grok-cli','seamless-hook.sh');
const ANTIGRAVITY_HOOK=join(ROOT,'hooks','antigravity','seamless-hook.sh');
const OPENCODE_PLUGIN_DIR=join(ROOT,'packages','opencode-plugin');
// The registration older seamless versions wrote. opencode 2 refuses a plugin path that names a file, so setup has to
// replace it with the directory rather than leave it beside a second entry.
const OPENCODE_PLUGIN_FILE=join(OPENCODE_PLUGIN_DIR,'index.ts');
// A home where all four hook/plugin products are present. Antigravity is only present through the executable T3 Code
// manages (S5), so the fixture writes the same active.json/.install-complete.json pair the adapter reads.
async function connectedHome(dir:string):Promise<void>{
 await mkdir(join(dir,'.config','opencode'),{recursive:true});
 await mkdir(join(dir,'.cursor'),{recursive:true});
 await mkdir(join(dir,'.grok'),{recursive:true});
 await mkdir(join(dir,'.gemini','antigravity-cli'),{recursive:true});
 const root=join(dir,'.t3-ja','tools','antigravity-acp',`darwin-${process.arch}`),release='abc12345';
 const versionDir=join(root,'versions',release);
 await mkdir(versionDir,{recursive:true});
 await writeFile(join(root,'active.json'),JSON.stringify({releaseId:release}));
 await writeFile(join(versionDir,'.install-complete.json'),JSON.stringify({releaseId:release,version:'1.1.1',executable:{name:'agy_acp_server.par'}}));
 const binary=join(versionDir,'agy_acp_server.par');
 await writeFile(binary,'#!/bin/sh\nexit 0\n');
 await chmod(binary,0o755);
}
const productChanges=(out:any):string[]=>[...new Set(out.changes.filter((change:any)=>change.product&&change.product!=='claude-code').map((change:any)=>change.product))].sort() as string[];
const wired=(out:any):Record<string,boolean>=>Object.fromEntries(out.products.map((row:any)=>[row.product,row.wired]));
function configPaths(dir:string){
 return {
  claude:join(dir,'.claude.json'),
  opencode:join(dir,'.config','opencode','opencode.json'),
  cursor:join(dir,'.cursor','hooks.json'),
  antigravity:join(dir,'.gemini','antigravity-cli','settings.json'),
  grok:join(dir,'.grok','config.toml'),
 };
}
// The files a person already has. None of these entries belong to seamless: setup must keep every one of them.
async function seedConfigs(dir:string):Promise<{paths:ReturnType<typeof configPaths>;before:Record<string,string>}>{
 const paths=configPaths(dir);
 const before:Record<string,string>={
  claude:JSON.stringify({theme:'dark',mcpServers:{other:{command:'x'}}})+'\n',
  opencode:JSON.stringify({theme:'x',plugin:['other-plugin']})+'\n',
  cursor:JSON.stringify({version:1,hooks:{stop:[{command:'/bin/other'}],sessionStart:[]}})+'\n',
  antigravity:JSON.stringify({theme:'dark',hooks:{BeforeAgent:[{hooks:[{type:'command',command:'/bin/other'}]}]}})+'\n',
  grok:'[ui]\ntheme = "dark"\n[[hooks.Stop]]\ncommand = "/bin/other"\n',
 };
 for(const [name,file] of Object.entries(paths))await writeFile(file,before[name],{mode:0o600});
 return {paths,before};
}
const hasCommand=(value:unknown,path:string):boolean=>typeof value==='string'?value===path:(!!value&&typeof value==='object'&&(value as {command?:unknown}).command===path);
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
 const out=await withPath('/nonexistent',()=>cli(['setup'],dir));
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
 const out=await runSetup({home:dir,dryRun:true,env:{PATH:'/nonexistent'}});
 assert.equal(out.status,'ok');
 assert.equal(out.dryRun,true);
 assert.deepEqual(out.changes.map(c=>[c.kind,c.action]),[['mcp_registration','would_add']]);
 assert.equal(await readFile(file,'utf8'),before);
 assert.deepEqual((await files(dir)).filter(f=>f!=='.claude.json'),[]);
});

test('a second setup leaves the registration unchanged and writes no backup',async t=>{
 const dir=await home(t);
 const first=await runSetup({home:dir,env:{PATH:'/nonexistent'}});
 assert.equal(first.changes[0].action,'added');
 const bytes=await readFile(join(dir,'.claude.json'),'utf8');
 const second=await runSetup({home:dir,env:{PATH:'/nonexistent'}});
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
 const out=await runSetup({home:dir,now:()=>Date.parse('2026-10-19T01:02:03.456Z'),env:{PATH:'/nonexistent'}});
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
 const out=await runSetup({home:dir,env:{PATH:'/nonexistent'}});
 assert.equal(out.status,'config_unusable');
 assert.deepEqual(out.changes,[]);
 assert.equal(out.backup,null);
 assert.equal(await readFile(file,'utf8'),before);
 assert.equal((await files(dir)).includes('.seamless/backups'),false);
});

test('setup --dry-run plans the four product wirings without changing a file',async t=>{
 const dir=await home(t);
 await connectedHome(dir);
 const {paths,before}=await seedConfigs(dir);
 // Cursor and Antigravity have no settings file yet. A dry run must not create one.
 await rm(paths.cursor);
 await rm(paths.antigravity);
 const snapshot=await files(dir);
 const out=await runSetup({home:dir,dryRun:true,env:{PATH:'/nonexistent'}});
 assert.equal(out.status,'ok');
 assert.equal(out.dryRun,true);
 assert.deepEqual(productChanges(out),['antigravity','cursor','grok','opencode']);
 assert.equal(out.changes.every(change=>['would_add','would_update','unchanged'].includes(change.action)),true);
 assert.equal(await readFile(paths.claude,'utf8'),before.claude);
 assert.equal(await readFile(paths.opencode,'utf8'),before.opencode);
 assert.equal(await readFile(paths.grok,'utf8'),before.grok);
 assert.deepEqual(await files(dir),snapshot);
 assert.equal((await files(dir)).some(file=>file.startsWith('.seamless/backups')),false);
});

test('setup backs up every product file and keeps the entries it did not write',async t=>{
 const dir=await home(t);
 await connectedHome(dir);
 const {paths,before}=await seedConfigs(dir);
 const out=await runSetup({home:dir,now:()=>Date.parse('2026-10-20T02:03:04.500Z'),env:{PATH:'/nonexistent'}});
 assert.equal(out.status,'ok');
 assert.deepEqual(productChanges(out),['antigravity','cursor','grok','opencode']);
 assert.equal(out.backups.length,5);
 const contents=await Promise.all(out.backups.map(backup=>readFile(backup,'utf8')));
 assert.deepEqual(contents.sort(),Object.values(before).sort());
 for(const backup of out.backups)assert.equal((await stat(backup)).mode&0o777,0o600,backup);

 const claude=JSON.parse(await readFile(paths.claude,'utf8'));
 assert.equal(claude.theme,'dark');
 assert.equal(claude.mcpServers.other.command,'x');
 assert.deepEqual(claude.mcpServers.seamless,mcpRegistration());

 const opencode=JSON.parse(await readFile(paths.opencode,'utf8'));
 assert.equal(opencode.theme,'x');
 assert.deepEqual(opencode.plugin,['other-plugin',OPENCODE_PLUGIN_DIR]);
 // The registered path must be the directory opencode loads, not the index.ts file inside it.
 assert.equal(opencode.plugin.at(-1).endsWith('index.ts'),false);
 assert.equal((await stat(opencode.plugin.at(-1))).isDirectory(),true);

 const cursor=JSON.parse(await readFile(paths.cursor,'utf8'));
 assert.deepEqual(cursor.hooks.stop,[{command:'/bin/other'},{command:CURSOR_HOOK}]);
 assert.deepEqual(cursor.hooks.sessionStart,[{command:CURSOR_HOOK}]);
 assert.deepEqual(cursor.hooks.afterAgentResponse,[{command:CURSOR_HOOK}]);

 const antigravity=JSON.parse(await readFile(paths.antigravity,'utf8'));
 assert.equal(antigravity.theme,'dark');
 const nested=(antigravity.hooks.BeforeAgent as any[]).flatMap(group=>group.hooks??[]);
 assert.equal(nested.some((hook:any)=>hook.command==='/bin/other'),true);
 assert.equal(nested.some((hook:any)=>hook.command===ANTIGRAVITY_HOOK),true);

 const grok=await readFile(paths.grok,'utf8');
 assert.equal(grok.includes('command = "/bin/other"'),true);
 assert.equal(grok.includes(GROK_HOOK),true);
 assert.equal((grok.match(/\[\[hooks\.Stop\]\]/g)??[]).length,2);
});

test('opencode is registered with the plugin directory, and a second setup leaves it alone',async t=>{
 const dir=await home(t);
 await connectedHome(dir);
 const file=join(dir,'.config','opencode','opencode.json');
 const out=await runSetup({home:dir,env:{PATH:'/nonexistent'}});
 assert.equal(out.status,'ok');
 assert.equal(out.changes.find(change=>change.product==='opencode')?.action,'added');
 const config=JSON.parse(await readFile(file,'utf8'));
 assert.deepEqual(config.plugin,[OPENCODE_PLUGIN_DIR]);
 assert.equal(config.plugin[0].endsWith('index.ts'),false);
 // opencode 2 reads the directory's own index.ts, so the directory itself is what has to exist.
 assert.equal((await stat(config.plugin[0])).isDirectory(),true);
 assert.equal((await stat(join(config.plugin[0],'index.ts'))).isFile(),true);

 const second=await runSetup({home:dir,env:{PATH:'/nonexistent'}});
 assert.equal(second.changes.find(change=>change.product==='opencode')?.action,'unchanged');
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')).plugin,[OPENCODE_PLUGIN_DIR]);
});

test('setup replaces an index.ts registration with the directory and keeps the other plugins',async t=>{
 const dir=await home(t);
 await connectedHome(dir);
 const file=join(dir,'.config','opencode','opencode.json');
 const before=JSON.stringify({theme:'x',plugin:['other-plugin',OPENCODE_PLUGIN_FILE,'third-plugin']})+'\n';
 await writeFile(file,before,{mode:0o600});
 // The file form is the one opencode 2 refuses, so it is not reported as a working wiring before setup repairs it.
 const unwired=await runDoctor({home:dir,env:{PATH:'/nonexistent'},versionCommand:async()=>null});
 assert.equal(wired(unwired).opencode,false);

 const at=Date.parse('2026-10-20T05:06:07.800Z');
 const out=await runSetup({home:dir,now:()=>at,env:{PATH:'/nonexistent'}});
 assert.equal(out.status,'ok');
 assert.equal(out.changes.find(change=>change.product==='opencode')?.action,'updated');
 const config=JSON.parse(await readFile(file,'utf8'));
 assert.equal(config.theme,'x');
 assert.deepEqual(config.plugin,['other-plugin',OPENCODE_PLUGIN_DIR,'third-plugin']);
 const backup=out.backups.find(path=>path.endsWith('-opencode.json'));
 assert.ok(backup);
 assert.equal(await readFile(backup,'utf8'),before);

 const second=await runSetup({home:dir,now:()=>at,env:{PATH:'/nonexistent'}});
 assert.equal(second.changes.find(change=>change.product==='opencode')?.action,'unchanged');
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')).plugin,['other-plugin',OPENCODE_PLUGIN_DIR,'third-plugin']);
});

test('setup --remove takes back only the entries seamless added',async t=>{
 const dir=await home(t);
 await connectedHome(dir);
 const {paths}=await seedConfigs(dir);
 assert.equal((await runSetup({home:dir,env:{PATH:'/nonexistent'}})).status,'ok');
 const out=await withPath('/nonexistent',()=>cli(['setup','--remove'],dir));
 assert.equal(out.status,'ok');
 assert.deepEqual(productChanges(out),['antigravity','cursor','grok','opencode']);
 assert.equal(out.changes.every((change:any)=>change.action==='removed'),true);

 const claude=JSON.parse(await readFile(paths.claude,'utf8'));
 assert.equal(claude.mcpServers.seamless,undefined);
 assert.equal(claude.mcpServers.other.command,'x');
 assert.equal(claude.theme,'dark');

 const opencode=JSON.parse(await readFile(paths.opencode,'utf8'));
 assert.equal(opencode.theme,'x');
 assert.deepEqual(opencode.plugin,['other-plugin']);

 const cursor=JSON.parse(await readFile(paths.cursor,'utf8'));
 assert.deepEqual(cursor.hooks.stop,[{command:'/bin/other'}]);
 for(const event of ['sessionStart','afterAgentResponse','stop'])assert.equal((cursor.hooks[event] as any[]).some(hook=>hasCommand(hook,CURSOR_HOOK)),false,event);

 const antigravity=JSON.parse(await readFile(paths.antigravity,'utf8'));
 const nested=(antigravity.hooks.BeforeAgent as any[]).flatMap(group=>group.hooks??[]);
 assert.equal(nested.some((hook:any)=>hook.command==='/bin/other'),true);
 assert.equal(nested.some((hook:any)=>hook.command===ANTIGRAVITY_HOOK),false);

 const grok=await readFile(paths.grok,'utf8');
 assert.equal(grok.includes('command = "/bin/other"'),true);
 assert.equal(grok.includes(GROK_HOOK),false);

 const doctor=await runDoctor({home:dir,env:{PATH:'/nonexistent'},versionCommand:async()=>null});
 assert.deepEqual(wired(doctor),{'claude-code':false,codex:false,opencode:false,cursor:false,antigravity:false,grok:false,'grok-bot':false});
});

test('doctor --json reports wired per product after setup',async t=>{
 const dir=await home(t);
 await connectedHome(dir);
 assert.equal((await runSetup({home:dir,env:{PATH:'/nonexistent'}})).status,'ok');
 const out=await runDoctor({home:dir,env:{PATH:'/nonexistent'},versionCommand:async()=>null});
 assert.deepEqual(wired(out),{'claude-code':true,codex:false,opencode:true,cursor:true,antigravity:true,grok:true,'grok-bot':false});
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
