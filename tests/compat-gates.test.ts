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
for(const status of ['absent','checking','fix_required','future_state'])test(`compatibility ${status} blocks both providers before transcript open and socket connect`,async t=>{
 const home=await mkdtemp(join(tmpdir(),'cldx-compat-gate-'));t.after(()=>rm(home,{recursive:true,force:true}));
 await mkdir(join(home,'.claude','sessions'),{recursive:true});await writeFile(join(home,'.claude','sessions','9.json'),JSON.stringify({pid:9,sessionId:'b',cwd:home,startedAt:1,version:'test-version'}));
 const compatibility:CompatibilityEntry[]=status==='absent'?[]:(['claude-code','codex'] as const).map(product=>({product,version:'test-version',connection:'desktop',status:status as CompatibilityEntry['status'],checkedAt:null,checks:[]}));
 let transcriptOpens=0,connections=0,inspections=0;
 const open=fs.open;t.mock.method(fs,'open',((...args:Parameters<typeof fs.open>)=>{if(String(args[0]).endsWith('.jsonl'))transcriptOpens++;return open(...args);}) as typeof fs.open);
 t.mock.method(net,'createConnection',()=>{connections++;throw new Error('must not connect');});syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const c=await createClaudeReader({home,compatibility})(target('claude'),{complete:false});assert.equal('status' in c&&c.status,'unsupported_version');assert.equal('reason' in c&&c.reason,'test-version');
 const x=await createCodexReader({version:async()=>'test-version',compatibility})(target('codex'),{complete:false});assert.equal('status' in x&&x.status,'unsupported_version');assert.equal('reason' in x&&x.reason,'test-version');
 const runtime=createNativeRuntime({home,desktopVersion:async()=>'test-version',compatibility,claudeIdentity:async()=>{inspections++;return null;},codexIdentity:async()=>{inspections++;return null;}});
 for(const provider of ['claude','codex'] as const){assert.deepEqual(await runtime.adapter.send(target(provider),envelope),{status:'rejected',reason:'unsupported_version',version:'test-version'});const read:any=await runtime.adapter.read(target(provider),{});assert.equal(read.status,'unsupported_version');assert.equal(read.version,'test-version');}
 assert.equal(transcriptOpens,0);assert.equal(connections,0);assert.equal(inspections,0);
});
test('verified Claude version reaches transcript open and reads visible text',async t=>{
 const home=await mkdtemp(join(tmpdir(),'cldx-verified-'));t.after(()=>rm(home,{recursive:true,force:true}));
 await mkdir(join(home,'.claude','sessions'),{recursive:true});await writeFile(join(home,'.claude','sessions','9.json'),JSON.stringify({pid:9,sessionId:'b',cwd:home,startedAt:1,version:'2.1.284'}));
 const path=claudeTranscriptPath(home,'b',{home});await mkdir(join(path,'..'),{recursive:true});await writeFile(path,JSON.stringify({sessionId:'b',uuid:'u',type:'user',message:{content:'visible'}})+'\n');
 const result=await createClaudeReader({home})(target('claude'),{complete:false});assert.ok('items' in result);if('items' in result)assert.equal(result.items[0].text,'visible');
});
