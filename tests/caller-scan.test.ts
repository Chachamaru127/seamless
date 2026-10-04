import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,chmod,readFile,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {identifyCaller,createSignatureVerifier,type CallerOptions} from '../src/caller.ts';
import {scanSessions,readThreadRows,THREADS_SQL,inScope,type ScanOptions} from '../src/sessions-scan.ts';
import {findClaudeIdentityByPid,findCodexOwner} from '../src/native-runtime.ts';
const version=async()=>'26.928.40906+12694';
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
 const home=await realpath(await mkdtemp(join(tmpdir(),'cldx-auto-')));t.after(()=>rm(home,{recursive:true,force:true}));
 await mkdir(join(home,'.claude','sessions'),{recursive:true});await mkdir(join(home,'.codex'));
 const cwd=home,codex=join(home,'codex');await writeFile(codex,'fixture');
 const record={pid:41,sessionId:'claude-a',version:'2.1.286',peerProtocol:1,procStart:'Fri Oct 2 12:00:00 2026',startedAt:100,cwd,messagingSocketPath:join(home,'socket')};
 const save=async(value=record)=>writeFile(join(home,'.claude','sessions','41.json'),JSON.stringify(value),{mode:0o600});
 const options:CallerOptions={signature:async()=>{try{await readFile(join(home,'.claude','sessions','41.json'));return 'Q6L2SF6YDW';}catch{return '2DC432GLL2';}},codexLocations:async()=>[codex],home,pid:99,cwd,processCwd:async()=>cwd,env:{},version,rows:async()=>[{id:'codex-a',cwd,archived:0,updated_at_ms:1},{id:'child',cwd,archived:0,updated_at_ms:2}],owner:async()=> 'owner',process:async pid=>pid===99?{pid,ppid:41,executable:'node'}:pid===41?{pid,ppid:1,executable:codex}:null,claude:{socket:async()=>true,command:async(file,args)=>file==='ps'?`${process.getuid!()} ${record.procStart}`:args.includes('cwd')?`n${cwd}`:`n${record.messagingSocketPath}`}};
 return {home,cwd,record,save,options};
}
test('Claude caller binds ancestor PID start and cwd, ignoring content and environment claims',async t=>{
 const f=await fixture(t);await f.save();f.options.env={CODEX_THREAD_ID:'attacker'};
 const result=await identifyCaller({kind:'mcp',meta:{'x-codex-turn-metadata':{session_id:'attacker'}}},f.options);
 assert.equal(result.status,'ok');if(result.status==='ok'){assert.equal(result.caller.nativeId,'claude-a');assert.equal(result.caller.source,'claude-ancestor');}
});
test('reused Claude PID with different process start is rejected',async t=>{
 const f=await fixture(t);await f.save({...f.record,procStart:'old start'});
 assert.equal(await findClaudeIdentityByPid(41,f.home,f.options.claude),null);
 assert.equal((await identifyCaller({kind:'cli'},f.options)).status,'caller_unobserved');
});
test('Claude metadata mode, version, cwd and owner validation fail closed',async t=>{
 const f=await fixture(t);await f.save();const path=join(f.home,'.claude','sessions','41.json');
 await chmod(path,0o666);assert.equal(await findClaudeIdentityByPid(41,f.home,f.options.claude),null);await chmod(path,0o600);
 await f.save({...f.record,version:'unknown'});assert.equal(await findClaudeIdentityByPid(41,f.home,{...f.options.claude,strictVersions:true}),null);
 await f.save({...f.record,cwd:'/missing-fixture-cwd'});assert.equal(await findClaudeIdentityByPid(41,f.home,f.options.claude),null);
 await f.save();const uid=process.getuid!();t.mock.method(process as NodeJS.Process&{getuid:()=>number},'getuid',()=>uid+1);assert.equal(await findClaudeIdentityByPid(41,f.home,f.options.claude),null);
});
for(const encoded of [false,true])test(`Codex MCP metadata selects session or subagent, encoded=${encoded}`,async t=>{
 const f=await fixture(t);
 for(const subagent of [false,true]){
  const m={session_id:'codex-a',thread_id:'child',thread_source:subagent?'subagent':'main'};
  const r=await identifyCaller({kind:'mcp',meta:{'x-codex-turn-metadata':encoded?JSON.stringify(m):m}},f.options);
  assert.equal(r.status,'ok');if(r.status==='ok'){assert.equal(r.caller.nativeId,subagent?'child':'codex-a');assert.equal(r.caller.generation,'owner');assert.equal(r.caller.source,'codex-turn-metadata');}
 }
});
test('Codex CLI cannot claim either of two conversations in the same workspace via environment',async t=>{
 const f=await fixture(t);
 for(const id of ['codex-a','child']){
  assert.deepEqual(await identifyCaller({kind:'cli'},{...f.options,env:{CODEX_THREAD_ID:id}}),{status:'caller_unobserved',reason:'codex_cli_unsupported'});
 }
 assert.equal((await identifyCaller({kind:'mcp'},f.options)).status,'caller_unobserved');
});
test('Codex MCP checks observed process cwd against thread cwd',async t=>{
 const f=await fixture(t),context={kind:'mcp' as const,meta:{'x-codex-turn-metadata':{session_id:'codex-a'}}};
 for(const cwd of [tmpdir(),null])assert.deepEqual(await identifyCaller(context,{...f.options,processCwd:async pid=>{assert.equal(pid,99);return cwd;}}),{status:'caller_unobserved',reason:'caller_workspace_mismatch'});
 assert.equal((await identifyCaller(context,f.options)).status,'ok');
 assert.equal((await identifyCaller(context,{...f.options,process:async pid=>({pid,ppid:1,executable:'node'})})).status,'caller_unobserved');
});
test('caller traversal is bounded to eight ancestors and empty observation stops',async t=>{
 const f=await fixture(t);let calls=0;
 const r=await identifyCaller({kind:'cli'},{...f.options,pid:100,process:async pid=>{calls++;return {pid,ppid:pid-1,executable:'node'};}});
 assert.equal(r.status,'caller_unobserved');assert.equal(calls,9);
});
test('SQLite reads exactly four metadata columns read-only; missing schema is unknown',async t=>{
 const f=await fixture(t),path=join(f.home,'.codex','state_5.sqlite');
 assert.equal(await readThreadRows(f.home),null);
 const db=new DatabaseSync(path);db.exec('CREATE TABLE threads(id TEXT,cwd TEXT,archived INTEGER,updated_at_ms INTEGER,first_user_message TEXT)');
 db.prepare('INSERT INTO threads VALUES(?,?,?,?,?)').run('a',f.cwd,0,1,'BODY_NOT_FOR_LIST');db.prepare('INSERT INTO threads VALUES(?,?,?,?,?)').run('b',f.cwd,1,2,'ARCHIVED');db.close();
 const before=await readFile(path);assert.equal(THREADS_SQL,'SELECT id, cwd, archived, updated_at_ms FROM threads WHERE archived=0');
 assert.deepEqual(await readThreadRows(f.home),[{id:'a',cwd:f.cwd,archived:0,updated_at_ms:1}]);assert.deepEqual(await readFile(path),before);
 const broken=new DatabaseSync(path);broken.exec('ALTER TABLE threads RENAME COLUMN cwd TO moved');broken.close();assert.equal(await readThreadRows(f.home),null);
});
test('scan enumerates both providers using metadata and owner only, filtering before owner calls',async t=>{
 const f=await fixture(t);await f.save();const other=await realpath(await mkdtemp(join(tmpdir(),'cldx-other-')));t.after(()=>rm(other,{recursive:true,force:true}));let owners:string[]=[];
 const result=await scanSessions(f.cwd,'current_work',{...f.options,git:async cwd=>({state:'no_git',workspace:cwd}),rows:async()=>[{id:'in',cwd:f.cwd,archived:0,updated_at_ms:1},{id:'out',cwd:other,archived:0,updated_at_ms:2}],owner:async id=>{owners.push(id);return 'g';}});
 assert.deepEqual(result.sessions.map(n=>n.provider),['claude','codex']);assert.deepEqual(owners,['in']);
 const source=await readFile(new URL('../src/sessions-scan.ts',import.meta.url),'utf8');assert.equal(source.includes('following'),false);assert.equal(source.includes('transcript'),false);
 assert.equal(findCodexOwner.toString().includes('following'),false);
});
test('any scope limits newest Codex candidates to fifty before owner discovery',async t=>{
 const f=await fixture(t);const seen:string[]=[];
 const r=await scanSessions(f.cwd,'any',{...f.options,rows:async()=>Array.from({length:80},(_,i)=>({id:String(i),cwd:f.cwd,archived:0,updated_at_ms:i})),owner:async id=>{seen.push(id);return 'owner';}});
 assert.equal(r.sessions.length,50);assert.equal(r.codexTruncated,30);assert.deepEqual(seen,Array.from({length:50},(_,i)=>String(79-i)));
});
test('unsupported Desktop and missing columns report unobserved workspace without owner calls',async t=>{
 const f=await fixture(t);let calls=0;const owner=async()=>{calls++;return 'g';};
 assert.equal((await scanSessions(f.cwd,'any',{...f.options,version:async()=> 'new-version',strictVersions:true,owner})).codexWorkspace,'unknown');
 assert.equal((await scanSessions(f.cwd,'any',{...f.options,rows:async()=>null,owner})).codexWorkspace,'unknown');assert.equal(calls,0);
});
test('scope compares worktree for current_work and common repository for same_repository',async()=>{
 const git:NonNullable<ScanOptions['git']>=async cwd=>({state:'git',workspace:cwd,worktree:cwd.startsWith('/one')?'/one':'/two',repository:'/repo',headState:'attached',branch:'main',head:'a',dirty:false});
 assert.equal(await inScope('/one/sub','/one','current_work',git),true);assert.equal(await inScope('/two','/one','current_work',git),false);assert.equal(await inScope('/two','/one','same_repository',git),true);
});
test('current_work is the caller folder or inside it, never a parent or the whole git worktree',async()=>{
 const git:NonNullable<ScanOptions['git']>=async cwd=>({state:'git',workspace:cwd,worktree:'/code',repository:'/code/.git',headState:'attached',branch:'main',head:'a',dirty:false});
 assert.equal(await inScope('/code/claudex','/code/claudex','current_work',git),true);
 assert.equal(await inScope('/code/claudex/src','/code/claudex','current_work',git),true);
 assert.equal(await inScope('/code','/code/claudex','current_work',git),false);
 assert.equal(await inScope('/code/other','/code/claudex','current_work',git),false);
 assert.equal(await inScope('/code/claudex-old','/code/claudex','current_work',git),false);
 assert.equal(await inScope('/code/other','/code/claudex','same_repository',git),true);
});

test('current_work prefilter skips git and owner lookup outside caller folder with injected git',async t=>{
 const f=await fixture(t),inside=join(f.cwd,'inside'),outside=await realpath(await mkdtemp(join(tmpdir(),'cldx-out-')));
 t.after(()=>rm(outside,{recursive:true,force:true}));await mkdir(inside);
 const gitCalls:string[]=[],owners:string[]=[];
 const result=await scanSessions(f.cwd,'current_work',{...f.options,git:async cwd=>{gitCalls.push(cwd);return {state:'no_git',workspace:cwd};},rows:async()=>[f.cwd,inside,outside].map((cwd,i)=>({id:String(i),cwd,archived:0,updated_at_ms:i})),owner:async id=>{owners.push(id);return 'owner';}});
 assert.deepEqual(gitCalls.sort(),[f.cwd,inside].sort());assert.deepEqual(owners,['1','0']);assert.equal(result.sessions.length,2);
});
test('same_repository prefilter uses worktree list before candidate git and owner lookups',async t=>{
 const f=await fixture(t),worktree=join(f.cwd,'wt'),other=join(f.cwd,'other'),second=join(f.cwd,'second'),inside=join(worktree,'inside');
 await mkdir(inside,{recursive:true});await mkdir(other);await mkdir(second);
 const gitCalls:string[]=[],owners:string[]=[],listCalls:string[]=[];
 const result=await scanSessions(worktree,'same_repository',{...f.options,git:async cwd=>{gitCalls.push(cwd);return {state:'git',workspace:cwd,worktree,repository:'/fake/repo',headState:'attached',branch:'main',head:'a',dirty:false};},worktreeList:async cwd=>{listCalls.push(cwd);return `worktree ${worktree}\nHEAD a\n\nworktree ${second}\nHEAD b\n\n`;},rows:async()=>[inside,other,second].map((cwd,i)=>({id:String(i),cwd,archived:0,updated_at_ms:i})),owner:async id=>{owners.push(id);return 'owner';}});
 assert.deepEqual(listCalls,[worktree]);assert.deepEqual(gitCalls,[worktree,inside,second]);assert.deepEqual(owners,['2','0']);assert.equal(result.sessions.length,2);
});

for(const name of ['codex','runner'])test(`nearest known Codex ancestor blocks outer Claude identity: ${name}`,async t=>{
 const f=await fixture(t);await f.save();const visited:number[]=[];const executable=join(f.home,name);await writeFile(executable,'fixture');f.options.codexLocations=async()=>[executable];
 f.options.signature=async()=> '2DC432GLL2';
 f.options.process=async pid=>{visited.push(pid);return pid===99?{pid,ppid:70,executable:'node'}:pid===70?{pid,ppid:60,executable,command:'codex exec'}:pid===60?{pid,ppid:41,executable:'bash'}:{pid,ppid:1,executable:'claude'};};
 assert.deepEqual(await identifyCaller({kind:'cli'},f.options),{status:'caller_unobserved',reason:'codex_cli_unsupported'});
 assert.deepEqual(visited,[99,70]);visited.length=0;
 const result=await identifyCaller({kind:'mcp',meta:{'x-codex-turn-metadata':{session_id:'codex-a'}}},f.options);
 assert.equal(result.status,'ok');if(result.status==='ok'){assert.equal(result.caller.nativeId,'codex-a');assert.equal(result.caller.provider,'codex');}
 assert.deepEqual(visited,[99,70]);
 assert.deepEqual(await identifyCaller({kind:'mcp'},f.options),{status:'caller_unobserved',reason:'missing_turn_metadata'});
});

test('untrusted temporary executable named codex cannot claim a Codex conversation',async t=>{
 const f=await fixture(t);f.options.codexLocations=async()=>[join(f.home,'trusted','codex')];
 assert.deepEqual(await identifyCaller({kind:'mcp',meta:{'x-codex-turn-metadata':{session_id:'codex-a'}}},f.options),{status:'caller_unobserved',reason:'native_ancestor_missing'});
});

test('Codex trust compares canonical executable with injected known locations',async t=>{
 const f=await fixture(t),alias=join(f.home,'alias');await symlink(join(f.home,'codex'),alias);
 f.options.codexLocations=async()=>[alias];
 assert.equal((await identifyCaller({kind:'mcp',meta:{'x-codex-turn-metadata':{session_id:'codex-a'}}},f.options)).status,'ok');
});

for(const team of [null,'WRONGTEAM1','2DC432GLL2'])test(`Codex signature team ${team} is checked via injection`,async t=>{
 const f=await fixture(t);let calls=0;f.options.signature=async()=>{calls++;return team;};
 const context={kind:'mcp' as const,meta:{'x-codex-turn-metadata':{session_id:'codex-a'}}};
 assert.equal((await identifyCaller(context,f.options)).status,team==='2DC432GLL2'?'ok':'caller_unobserved');
 await identifyCaller(context,f.options);assert.equal(calls,team==='2DC432GLL2'?1:2);
 const {utimes}=await import('node:fs/promises');await utimes(join(f.home,'codex'),new Date(),new Date(Date.now()+10000));await identifyCaller(context,f.options);assert.equal(calls,team==='2DC432GLL2'?2:3);
});
for(const team of [null,'2DC432GLL2','Q6L2SF6YDW'])test(`Claude signature team ${team} is checked via injection`,async t=>{
 const f=await fixture(t);await f.save();f.options.signature=async()=>team;
 assert.equal((await identifyCaller({kind:'cli'},f.options)).status,team==='Q6L2SF6YDW'?'ok':'caller_unobserved');
});

for(const reason of ['process_exited','generation_changed','unsupported_version','unreachable'] as const)test(`unavailable Claude metadata candidate reports ${reason==='generation_changed'?'process_exited for reused PID':reason}`,async t=>{
 const f=await fixture(t);await f.save({...f.record,procStart:'not-current',...(reason==='unsupported_version'?{version:'future'}:{})});
 const result=await scanSessions(f.cwd,'current_work',{...f.options,rows:async()=>[],strictVersions:true,includeUnavailable:true,processStart:async()=>reason==='process_exited'?null:reason==='generation_changed'?9000:100});
 assert.equal(result.sessions.length,1);assert.equal(result.sessions[0].reason,reason==='generation_changed'?'process_exited':reason);assert.equal(result.sessions[0].status,['process_exited','generation_changed'].includes(reason)?'offline':'unknown');
});
test('unavailable Codex candidates distinguish unsupported version and unreachable owner',async t=>{
 const f=await fixture(t);
 for(const supported of [true,false]){const result=await scanSessions(f.cwd,'current_work',{...f.options,strictVersions:true,includeUnavailable:true,version:async()=>supported?'26.928.40906+12694':'future',owner:async()=>null});assert.equal(result.sessions.length,2);assert.equal(result.sessions[0].reason,supported?'unreachable':'unsupported_version');}
});

for(const accepted of [null,'2DC432GLL2','Q6L2SF6YDW'])test(`codesign anchored requirement uses injected executor: ${accepted}`,async()=>{
 const calls:string[][]=[];
 const verify=createSignatureVerifier(async(file,args,options)=>{
  assert.equal(file,'/usr/bin/codesign');assert.equal(options.timeout,5000);calls.push(args);
  assert.deepEqual(args.slice(0,2),['--verify','--strict']);assert.equal(args[3],'/fixture/app');
  assert.match(args[2],/^-R=anchor apple generic and certificate leaf\[subject\.OU\] = "(2DC432GLL2|Q6L2SF6YDW)"$/);
  if(!accepted||!args[2].includes(accepted))throw Error('untrusted');
 });
 for(const expected of ['2DC432GLL2','Q6L2SF6YDW'] as const){assert.equal(await verify('/fixture/app',expected),accepted===expected?expected:null);}
 assert.equal(calls.length,2);
});
test('unobserved Claude caller version returns unsupported_version after identity validation',async t=>{
 const f=await fixture(t);await f.save({...f.record,version:'9.9.999'});
 assert.deepEqual(await identifyCaller({kind:'cli'},{...f.options,strictVersions:true}),{status:'unsupported_version',reason:'9.9.999',version:'9.9.999'});
 await f.save({...f.record,version:'9.9.999',procStart:'old'});
 assert.equal((await identifyCaller({kind:'cli'},f.options)).status,'caller_unobserved');
});

for(const version of ['2.1.287','future','',null])test(`default Claude identity and caller accept unverified version ${version}`,async t=>{
 const f=await fixture(t);await f.save({...f.record,version} as typeof f.record);
 const identity=await findClaudeIdentityByPid(41,f.home,f.options.claude);assert.ok(identity);
 assert.equal((await identifyCaller({kind:'cli'},f.options)).status,'ok');
 const strict={...f.options,strictVersions:true};
 assert.equal((await identifyCaller({kind:'cli'},strict)).status,'unsupported_version');
 await f.save({...f.record,version,peerProtocol:2} as typeof f.record);
 assert.equal(await findClaudeIdentityByPid(41,f.home,f.options.claude),null);
});
for(const v of ['future','',null])test(`default Codex scan accepts unverified version ${v} and strict never calls owner`,async t=>{
 const f=await fixture(t);let owners=0;const options={...f.options,version:async()=>v,owner:async()=>{owners++;return 'owner';}};
 const normal=await scanSessions(f.cwd,'any',options);assert.equal(normal.sessions.length,2);assert.equal(owners,2);assert.equal(normal.sessions[0].version,v||null);
 owners=0;const strict=await scanSessions(f.cwd,'any',{...options,strictVersions:true,includeUnavailable:true});assert.equal(owners,0);assert.equal(strict.sessions.length,2);
 for(const n of strict.sessions){assert.equal(n.status,'unknown');assert.equal(n.reason,'unsupported_version');}
});

import {createAutomatic} from '../src/automatic.ts';
import {writeLimits,unrestricted} from '../src/limits.ts';
for(const v of ['future','',null])test(`automatic native Codex caller ${v} is rejected before owner lookup under strict limits`,async t=>{
 const f=await fixture(t);let owners=0,scans=0;
 const options={...f.options,version:async()=>v,owner:async()=>{owners++;return 'owner';}};
 const context={kind:'mcp' as const,meta:{'x-codex-turn-metadata':{session_id:'codex-a'}}};
 assert.equal((await identifyCaller(context,options)).status,'ok');assert.equal(owners,1);owners=0;
 const limitsPath=join(f.home,'limits.json');await writeLimits({...unrestricted,strictVersions:true},null,limitsPath);
 const automatic=createAutomatic({home:f.home,limitsPath,callerOptions:options,scan:async()=>{scans++;return {sessions:[],codexWorkspace:'observed'};}});
 assert.deepEqual(await automatic('sessions',{},context),{status:'unsupported_version',reason:v??'unknown',version:v??'unknown'});
 assert.equal(owners,0);assert.equal(scans,0);
});
