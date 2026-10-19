import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CLAUDE_COMPATIBILITY,COMPATIBILITY,compatibilityMarkdown,isClaudeVersionAllowed,isVersionAllowed,versionStatus} from '../src/compat.ts';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';

test('strict mode allows only verified Claude versions',()=>{
 assert.deepEqual(CLAUDE_COMPATIBILITY.map(x=>[x.version,x.status]),[
  ['2.1.284','verified'],['2.1.286','verified'],['2.1.287','checking'],['2.1.303','checking']
 ]);
 for(const version of ['2.1.284','2.1.286'])assert.equal(isClaudeVersionAllowed(version),true);
 for(const version of ['2.1.287','2.1.303','9.9.9',''])assert.equal(isClaudeVersionAllowed(version,{strictVersions:true}),false);
});
// v1 keeps the measured rows and adds the seven current products as checking with the day each version was observed.
const v1Products=[
 ['claude-code','2.1.303','desktop'],
 ['codex','0.163.0','cli'],
 ['codex','26.1013.40934+20770','desktop'],
 ['opencode','2.0.32','cli'],
 ['cursor','2026.10.17','cli'],
 ['antigravity','1.1.1','cli'],
 ['grok','1.0.62','cli'],
] as const;
test('the generated table lists the seven v1 products as checking with product, version, connection, status and checkedAt',()=>{
 for(const [product,version,connection] of v1Products){
  const rows=COMPATIBILITY.filter(e=>e.product===product&&e.version===version);
  assert.equal(rows.length,1,`${product} ${version}`);
  assert.equal(rows[0].connection,connection);assert.equal(rows[0].status,'checking');assert.equal(rows[0].checkedAt,'2026-10-19');
 }
 const lines=compatibilityMarkdown().split('\n').filter(l=>l.startsWith('| ')&&!l.startsWith('|---'));
 assert.deepEqual(lines[0].split('|').slice(1,-1).map(c=>c.trim()),['product','version','connection','status','checkedAt','checks']);
 assert.equal(lines.length-1,COMPATIBILITY.length);
 for(const line of lines.slice(1))assert.equal(line.split('|').slice(1,-1).length,6);
});
test('a version absent from the table is unverified for every v1 product',()=>{
 for(const [product,,connection] of v1Products)assert.equal(versionStatus(product,'9.9.9',{},connection),'unverified');
});
test('a Desktop connection that does not go through is unverified_desktop even for a listed version',()=>{
 assert.equal(versionStatus('codex','26.1013.40934+20770',{desktopConnection:'failed'},'desktop'),'unverified_desktop');
 assert.equal(versionStatus('claude-code','2.1.284',{desktopConnection:'failed'},'desktop'),'unverified_desktop');
 assert.equal(versionStatus('codex','0.163.0',{desktopConnection:'failed'},'cli'),'checking');
 assert.equal(versionStatus('codex','26.1013.40934+20770',{desktopConnection:'ok'},'desktop'),'checking');
 // 未確認（Desktop）is a display like 未確認: it does not stop use by default, and strict still refuses it.
 assert.equal(isVersionAllowed('codex','26.1013.40934+20770',{desktopConnection:'failed'}),true);
 assert.equal(isVersionAllowed('codex','26.1013.40934+20770',{desktopConnection:'failed',strictVersions:true}),false);
});
for(const version of ['2.1.287','9.9.9'])test(`Claude identity rejects unverified version ${version} before process inspection`,async t=>{
 let processInspections=0;
 t.mock.method(childProcess,'execFile',()=>{processInspections++;throw new Error('unexpected process inspection');});
 syncBuiltinESMExports();
 t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 const modulePath=`../src/native-runtime.ts?compat-test=${version}`;
 const {findClaudeIdentity}=await import(modulePath);
 const home=await mkdtemp(join(tmpdir(),'cldx-compat-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const dir=join(home,'.claude','sessions');await mkdir(dir,{recursive:true});
 await writeFile(join(dir,`${process.pid}.json`),JSON.stringify({sessionId:'fixture',pid:process.pid,version,startedAt:1,peerProtocol:1,procStart:'unused',cwd:home,messagingSocketPath:join(home,'unused.sock')}),{mode:0o600});
 assert.equal(await findClaudeIdentity('fixture',home,{strictVersions:true}),null);
 assert.equal(processInspections,0);
});

import type {CompatibilityEntry} from '../src/compat.ts';
test('a fix_required version stops use even when the Desktop connection fails',()=>{
 const compatibility:CompatibilityEntry[]=[{product:'codex',version:'fix',connection:'desktop',status:'fix_required',checkedAt:null,checks:[]}];
 for(const strictVersions of [false,true]){
  const options={compatibility,desktopConnection:'failed' as const,strictVersions};
  assert.equal(versionStatus('codex','fix',options),'fix_required');
  assert.equal(isVersionAllowed('codex','fix',options),false);
  assert.equal(isVersionAllowed('codex','fix',{...options,allowChecking:true}),false);
 }
 assert.equal(versionStatus('codex','fix',{compatibility,desktopConnection:'ok'}),'fix_required');
 assert.equal(isVersionAllowed('codex','fix',{compatibility}),false);
});
for(const strictVersions of [false,true])test(`version matrix strict=${strictVersions} preserves checking override and invalid denial`,()=>{
 for(const status of ['verified','checking','fix_required','future_state','absent']){
  const compatibility:CompatibilityEntry[]=status==='absent'?[]:[{product:'codex',version:'v',connection:'desktop',status:status as CompatibilityEntry['status'],checkedAt:null,checks:[]}];
  const options={compatibility,strictVersions};
  assert.equal(versionStatus('codex','v',options),status==='absent'?'unverified':status==='future_state'?'invalid':status);
  assert.equal(isVersionAllowed('codex','v',options),status==='verified'||!strictVersions&&['checking','absent'].includes(status));
  assert.equal(isVersionAllowed('codex','v',{...options,allowChecking:true}),status==='verified'||status==='checking'||!strictVersions&&status==='absent');
 }
 for(const version of [null,undefined,'']){
  assert.equal(versionStatus('codex',version),'unverified');
  assert.equal(isVersionAllowed('codex',version,{strictVersions}),!strictVersions);
 }
 assert.equal(isVersionAllowed('codex','new-version'),true);
});
