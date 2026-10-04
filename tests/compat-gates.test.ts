import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {COMPATIBILITY,compatibilityMarkdown,type CompatibilityEntry} from '../src/compat.ts';
import {createClaudeReader,claudeTranscriptPath} from '../src/adapters/claude.ts';
import {createCodexReader} from '../src/adapters/codex.ts';
import {createNativeRuntime} from '../src/native-runtime.ts';
import type {Registration} from '../src/protocol.ts';
const target=(provider:'claude'|'codex'):Registration=>({id:'target',provider,nativeId:'b',generation:'g',workspace:'/w',host:'local',displayName:'target',operations:['read','send'],grants:[]});
const envelope={id:'m',sender:{id:'a',nativeId:'a',generation:'g'},recipient:{id:'target',nativeId:'b',generation:'g'},text:'hi'};
test('generated compatibility markdown exactly matches the single source table',async()=>{
 assert.equal(await readFile(new URL('../specs/202610-everyday-use/compat.md',import.meta.url),'utf8'),compatibilityMarkdown());
 assert.deepEqual(COMPATIBILITY.filter(e=>e.product==='codex').map(e=>[e.version,e.status]),[['26.928.31416+12553','verified'],['26.928.40906+12694','verified'],['26.930.31730+12947','verified']]);
});
for(const strictVersions of [false,true])for(const status of (strictVersions?['absent','checking','fix_required','future_state']:['fix_required','future_state']))test(`compatibility ${status} strict=${strictVersions} blocks both providers before transcript open and socket connect`,async t=>{
 const home=await mkdtemp(join(tmpdir(),'cldx-compat-gate-'));t.after(()=>rm(home,{recursive:true,force:true}));
 await mkdir(join(home,'.claude','sessions'),{recursive:true});await writeFile(join(home,'.claude','sessions','9.json'),JSON.stringify({pid:9,sessionId:'b',cwd:home,startedAt:1,version:'test-version'}));
 const compatibility:CompatibilityEntry[]=status==='absent'?[]:(['claude-code','codex'] as const).map(product=>({product,version:'test-version',connection:'desktop',status:status as CompatibilityEntry['status'],checkedAt:null,checks:[]}));
 let transcriptOpens=0,connections=0,inspections=0;
 const open=fs.open;t.mock.method(fs,'open',((...args:Parameters<typeof fs.open>)=>{if(String(args[0]).endsWith('.jsonl'))transcriptOpens++;return open(...args);}) as typeof fs.open);
 t.mock.method(net,'createConnection',()=>{connections++;throw new Error('must not connect');});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const c=await createClaudeReader({home,compatibility,strictVersions})(target('claude'),{complete:false});assert.equal('status' in c&&c.status,'unsupported_version');assert.equal('reason' in c&&c.reason,'test-version');
 const x=await createCodexReader({version:async()=>'test-version',compatibility,strictVersions})(target('codex'),{complete:false});assert.equal('status' in x&&x.status,'unsupported_version');assert.equal('reason' in x&&x.reason,'test-version');
 const runtime=createNativeRuntime({home,desktopVersion:async()=>'test-version',compatibility,strictVersions,claudeIdentity:async()=>{inspections++;return null;},codexIdentity:async()=>{inspections++;return null;}});
 for(const provider of ['claude','codex'] as const){assert.deepEqual(await runtime.adapter.send(target(provider),envelope),{status:'rejected',reason:'unsupported_version',version:'test-version'});const read:any=await runtime.adapter.read(target(provider),{});assert.equal(read.status,'unsupported_version');assert.equal(read.version,'test-version');}
 assert.equal(transcriptOpens,0);assert.equal(connections,0);assert.equal(inspections,0);
});
test('verified Claude version reaches transcript open and reads visible text',async t=>{
 const home=await mkdtemp(join(tmpdir(),'cldx-verified-'));t.after(()=>rm(home,{recursive:true,force:true}));
 await mkdir(join(home,'.claude','sessions'),{recursive:true});await writeFile(join(home,'.claude','sessions','9.json'),JSON.stringify({pid:9,sessionId:'b',cwd:home,startedAt:1,version:'2.1.284'}));
 const path=claudeTranscriptPath(home,'b',{home});await mkdir(join(path,'..'),{recursive:true});await writeFile(path,JSON.stringify({sessionId:'b',uuid:'u',type:'user',message:{content:'visible'}})+'\n');
 const result=await createClaudeReader({home})(target('claude'),{complete:false});assert.ok('items' in result);if('items' in result)assert.equal(result.items[0].text,'visible');
});

for(const state of ['absent','checking','null','empty'])test(`default ${state} reaches Claude transcript and Codex connection`,async t=>{
 const home=await mkdtemp(join(tmpdir(),'cldx-relaxed-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const version=state==='null'?null:state==='empty'?'':'new-version';
 const compatibility:CompatibilityEntry[]=state==='checking'?(['claude-code','codex'] as const).map(product=>({product,version:'new-version',connection:'desktop',status:'checking',checkedAt:null,checks:[]})):[];
 await mkdir(join(home,'.claude','sessions'),{recursive:true});await writeFile(join(home,'.claude','sessions','9.json'),JSON.stringify({pid:9,sessionId:'b',cwd:home,startedAt:1,version}));
 const path=claudeTranscriptPath(home,'b',{home});await mkdir(join(path,'..'),{recursive:true});await writeFile(path,JSON.stringify({sessionId:'b',uuid:'u',type:'user',message:{content:'visible'}})+'\n');
 const result=await createClaudeReader({home,compatibility})(target('claude'),{complete:false});assert.ok('items' in result);
 const lstat=fs.lstat;t.mock.method(fs,'lstat',((path:Parameters<typeof fs.lstat>[0],...args:any[])=>String(path)===join(home,'fixture.sock')?Promise.resolve({isSocket:()=>true,uid:process.getuid!()}):lstat(path,...args)) as typeof fs.lstat);
 let connections=0;t.mock.method(net,'createConnection',()=>{connections++;throw new Error('test connection');});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const codex=await createCodexReader({version:async()=>version,compatibility,socketPath:join(home,'fixture.sock')})(target('codex'),{complete:false});
 assert.equal('status' in codex&&codex.status,'unavailable');assert.equal(connections,1);
 const runtime=createNativeRuntime({home,compatibility,desktopVersion:async()=>version});
 assert.equal(await runtime.checkCompatibility(target('claude')),null);assert.equal(await runtime.checkCompatibility(target('codex')),null);
});

import {createAutomatic,issueTicket} from '../src/automatic.ts';
import {writeLimits,unrestricted} from '../src/limits.ts';
for(const provider of ['claude','codex'] as const)for(const version of ['future','',null])test(`native automatic strict ${provider} ${version} target blocks before transcript open, inspection and connection`,async t=>{
 const home=await (await import('node:fs/promises')).realpath(await mkdtemp(join(tmpdir(),'cldx-auto-strict-')));t.after(()=>rm(home,{recursive:true,force:true}));
 const limitsPath=join(home,'limits.json');await writeLimits({...unrestricted,strictVersions:true},null,limitsPath);
 await mkdir(join(home,'.claude','sessions'),{recursive:true});
 if(provider==='claude')await writeFile(join(home,'.claude','sessions','9.json'),JSON.stringify({pid:9,sessionId:'b',cwd:home,startedAt:1,version,peerProtocol:1,procStart:'unused',messagingSocketPath:join(home,'peer.sock')}),{mode:0o600});
 let transcriptOpens=0,connections=0,inspections=0,owners=0;
 const open=fs.open;t.mock.method(fs,'open',((...args:Parameters<typeof fs.open>)=>{if(String(args[0]).endsWith('.jsonl'))transcriptOpens++;return open(...args);}) as typeof fs.open);
 t.mock.method(net,'createConnection',()=>{connections++;throw Error('must not connect');});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const automatic=createAutomatic({home,limitsPath,caller:async()=>({status:'ok',caller:{provider:'claude',version:'2.1.286',nativeId:'a',generation:'g',cwd:home,socket:'unused',source:'claude-ancestor'}}),scanOptions:{version:async()=>version,rows:async()=>provider==='codex'?[{id:'b',cwd:home,archived:0,updated_at_ms:1}]:[],owner:async()=>{owners++;return 'g';},git:async cwd=>({state:'no_git',workspace:cwd}),claude:{command:async()=>{inspections++;throw Error('must not inspect');},socket:async()=>{inspections++;return false;}}},inspect:async()=>{inspections++;return null;}});
 const list=await automatic('sessions',{includeOffline:true});assert.equal(list.status,'ok');assert.equal(list.candidates.length,1);assert.equal(list.candidates[0].reason,'unsupported_version');assert.equal(list.candidates[0].status,'unknown');assert.equal(list.candidates[0].version,version||null);assert.equal(list.candidates[0].versionStatus,'unverified');
 const denied={status:'unsupported_version',reason:version??'unknown',version:version??'unknown'};
 assert.deepEqual(await automatic('read',{target:`${provider}:b`}),denied);
 assert.deepEqual(await automatic('send',{ticket:issueTicket({provider,nativeId:'b',generation:'g',cwd:home}),id:'blocked',text:'no'}),denied);
 assert.equal(transcriptOpens,0);assert.equal(connections,0);assert.equal(inspections,0);assert.equal(owners,0);
});
