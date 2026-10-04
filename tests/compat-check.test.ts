import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,readFile,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compatibilityCheck} from '../src/compat-check.ts';
import {writeLimits,unrestricted} from '../src/limits.ts';
import {createAutomatic,type AutomaticOptions} from '../src/automatic.ts';
import type {Caller} from '../src/caller.ts';
import type {SessionIdentity} from '../src/sessions-scan.ts';
import {isVersionAllowed,type CompatibilityEntry} from '../src/compat.ts';
const testCompatibility:CompatibilityEntry[]=[{product:'codex',version:'26.930.31730+12947',connection:'desktop',status:'checking',checkedAt:null,checks:[]}];
async function fixture(t:{after:(f:()=>Promise<void>)=>void}){
 const home=await realpath(await mkdtemp(join(tmpdir(),'cldx-check-')));t.after(()=>rm(home,{recursive:true,force:true}));
 const caller:Caller={provider:'claude',version:'2.1.286',nativeId:'a',generation:'g',cwd:home,socket:'unused',source:'claude-ancestor'},target:SessionIdentity={provider:'codex',version:'26.930.31730+12947',nativeId:'b',generation:'g',cwd:home,socket:'unused'};
 let sessions:SessionIdentity[]=[caller,target],reads=0;
 const options:AutomaticOptions={home,caller:async()=>({status:'ok',caller}),scan:async()=>({sessions,codexWorkspace:'observed'}),scanOptions:{git:async cwd=>({state:'no_git',workspace:cwd})},inspect:async()=>target,adapter:{read:async()=>{reads++;return {status:'ok'};},send:async()=>{throw new Error('no send');}}};
 return {home,options,caller,target,path:join(home,'test-limits.json'),reads:()=>reads,set:(s:SessionIdentity[])=>sessions=s};
}
test('compat-check rejects default limits, unrestricted copies and unreadable settings before any read',async t=>{
 const f=await fixture(t),value={...unrestricted,exclude:[{nativeId:'other'}]};const path=join(f.home,'.seamless','limits.json');await writeLimits(value,null,path);
 assert.equal((await compatibilityCheck(path,f.options)).status,'compat_check_requires_test_limits');
 await writeLimits(unrestricted,null,f.path);assert.equal((await compatibilityCheck(f.path,f.options)).status,'compat_check_requires_test_limits');
 assert.equal((await compatibilityCheck(join(f.home,'absent'),f.options)).status,'compat_check_requires_test_limits');assert.equal(f.reads(),0);
});
test('compat-check limits test pair, reports read result, and never promotes the compatibility table',async t=>{
 const f=await fixture(t),path=new URL('../src/compat.ts',import.meta.url),before=await readFile(path);await writeLimits({...unrestricted,exclude:[{nativeId:'other'}]},null,f.path);
 const result=await compatibilityCheck(f.path,f.options);assert.equal(result.status,'compat_check_passed');assert.equal('compatibilityStatus' in result,false);assert.equal(f.reads(),1);assert.deepEqual(await readFile(path),before);
 f.set([f.caller,f.target,{...f.target,nativeId:'unexpected'}]);assert.equal((await compatibilityCheck(f.path,f.options)).status,'compat_check_failed');assert.equal(f.reads(),1);
});
test('checking permission is limited to test mode and still rejects fix_required and unknown states',()=>{
 const version='test-checking';const compatibility:CompatibilityEntry[]=[{product:'codex',version,connection:'desktop',status:'checking',checkedAt:null,checks:[]}];assert.equal(isVersionAllowed('codex',version,{compatibility,strictVersions:true}),false);assert.equal(isVersionAllowed('codex',version,{compatibility,allowChecking:true,strictVersions:true}),true);
 for(const status of ['fix_required','other'])assert.equal(isVersionAllowed('codex',version,{allowChecking:true,compatibility:[{product:'codex',version,connection:'desktop',status:status as CompatibilityEntry['status'],checkedAt:null,checks:[]}]}),false);
});
test('compat-check scanning excludes other sessions before Codex owner connection',async t=>{
 const f=await fixture(t);await writeLimits({...unrestricted,exclude:[{nativeId:'other'}]},null,f.path);const owners:string[]=[];
 // The caller is included as a Codex row so this test uses no real metadata or sockets.
 f.caller.provider='codex';f.caller.version='26.930.31730+12947';
 const result=await compatibilityCheck(f.path,{...f.options,scan:undefined,scanOptions:{compatibility:testCompatibility,version:async()=>'26.930.31730+12947',rows:async()=>['a','b','other'].map(id=>({id,cwd:f.home,archived:0,updated_at_ms:1})),owner:async id=>{owners.push(id);return 'g';},git:async cwd=>({state:'no_git',workspace:cwd})}});
 assert.equal(result.status,'compat_check_passed');assert.ok(owners.length>0);assert.ok(!owners.includes('other'));
});
test('test mode exposes no write or limits mutation operation',async t=>{
 const f=await fixture(t);const automatic=createAutomatic({...f.options,compatTest:true});
 for(const method of ['send','limits','select','revalidate'])assert.equal((await automatic(method,{action:'clear'})).status,'compat_check_read_only');
});

test('compat-check rejects a hard link to default limits',async t=>{
 const f=await fixture(t),path=join(f.home,'.seamless','limits.json');await writeLimits({...unrestricted,exclude:[{nativeId:'other'}]},null,path);await link(path,f.path);
 assert.equal((await compatibilityCheck(f.path,f.options)).status,'compat_check_requires_test_limits');assert.equal(f.reads(),0);
});
test('compat-check refuses an extra metadata candidate before any owner connection',async t=>{
 const f=await fixture(t);await writeLimits({...unrestricted,exclude:[{nativeId:'other'}]},null,f.path);let owners=0;f.caller.provider='codex';f.caller.version='26.930.31730+12947';
 const result=await compatibilityCheck(f.path,{...f.options,scan:undefined,scanOptions:{compatibility:testCompatibility,version:async()=>'26.930.31730+12947',rows:async()=>['a','b','unexpected'].map(id=>({id,cwd:f.home,archived:0,updated_at_ms:1})),owner:async()=>{owners++;return 'g';},git:async cwd=>({state:'no_git',workspace:cwd})}});
 assert.equal(result.status,'compat_check_failed');assert.equal(owners,0);assert.equal(f.reads(),0);
});

test('CLI compat-check rejects default test-home limits before caller discovery',async t=>{
 const f=await fixture(t),path=join(f.home,'.seamless','limits.json');await writeLimits({...unrestricted,exclude:[{nativeId:'other'}]},null,path);
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync(process.execPath,['src/cli.ts','compat-check','--limits',path],{env:{...process.env,HOME:f.home},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,'compat_check_requires_test_limits');
});
test('compat-check fails closed if the designated limits change during listing',async t=>{
 const f=await fixture(t);await writeLimits({...unrestricted,exclude:[{nativeId:'other'}]},null,f.path);
 const {readLimits}=await import('../src/limits.ts');
 const result=await compatibilityCheck(f.path,{...f.options,scan:async()=>{const old=await readLimits(f.path);if(old.status==='ok')await writeLimits(unrestricted,old.hash,f.path);return {sessions:[f.caller,f.target],codexWorkspace:'observed'};}});
 assert.equal(result.status,'compat_check_limits_changed');assert.equal(f.reads(),0);
});
test('compat-check target narrows the pair before any owner connection',async t=>{
 const {scanSessions}=await import('../src/sessions-scan.ts');
 const w=await realpath(await mkdtemp(join(tmpdir(),'cldx-pair-')));t.after(()=>rm(w,{recursive:true,force:true}));
 const owners:string[]=[];
 const rows=[{id:'caller',cwd:w,archived:0,updated_at_ms:3},{id:'pair',cwd:w,archived:0,updated_at_ms:2},{id:'other',cwd:w,archived:0,updated_at_ms:1},{id:'gone',cwd:join(w,'deleted-folder'),archived:0,updated_at_ms:0}];
 const r=await scanSessions(w,'any',{git:async (cwd:string)=>({state:'no_git',workspace:cwd}),rows:async()=>rows,owner:async (id:string)=>{owners.push(id);return 'g';},version:async()=>'26.928.40906+12694',home:'/nonexistent-home',expectedPairCaller:'codex:caller',include:async (n:{nativeId:string})=>['caller','pair'].includes(n.nativeId)} as any);
 assert.deepEqual(owners.sort(),['caller','pair']);assert.deepEqual(r.sessions.map((n:{nativeId:string})=>n.nativeId).sort(),['caller','pair']);
});

test('compat-check does not write seen and unrelated failures omit compatibilityStatus',async t=>{
 const f=await fixture(t);await writeLimits({...unrestricted,exclude:[{nativeId:'other'}]},null,f.path);
 await compatibilityCheck(f.path,f.options);await assert.rejects(readFile(join(f.home,'.seamless','seen.json')),{code:'ENOENT'});
 f.set([f.caller]);const result=await compatibilityCheck(f.path,f.options);assert.equal(result.status,'compat_check_failed');assert.equal('compatibilityStatus' in result,false);
 const missing=await compatibilityCheck(f.path,{...f.options,caller:async()=>({status:'caller_unobserved',reason:'test'})});assert.equal('compatibilityStatus' in missing,false);
});

test('compat-check still permits checking but rejects unlisted versions before reading',async t=>{
 const f=await fixture(t);await writeLimits({...unrestricted,exclude:[{nativeId:'other'}]},null,f.path);
 f.target.provider='claude';f.target.version='2.1.287';
 assert.equal((await compatibilityCheck(f.path,f.options)).status,'compat_check_passed');assert.equal(f.reads(),1);
 f.target.version='future';
 assert.equal((await compatibilityCheck(f.path,f.options)).status,'compat_check_failed');assert.equal(f.reads(),1);
});
