import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CLAUDE_COMPATIBILITY,isClaudeVersionAllowed} from '../src/compat.ts';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';

test('strict mode allows only verified Claude versions',()=>{
 assert.deepEqual(CLAUDE_COMPATIBILITY.map(x=>[x.version,x.status]),[
  ['2.1.284','verified'],['2.1.286','verified'],['2.1.287','checking']
 ]);
 for(const version of ['2.1.284','2.1.286'])assert.equal(isClaudeVersionAllowed(version),true);
 for(const version of ['2.1.287','9.9.9',''])assert.equal(isClaudeVersionAllowed(version,{strictVersions:true}),false);
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

import {isVersionAllowed,versionStatus,type CompatibilityEntry} from '../src/compat.ts';
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
