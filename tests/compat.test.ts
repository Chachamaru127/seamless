import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CLAUDE_COMPATIBILITY,isClaudeVersionAllowed} from '../src/compat.ts';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';

test('only verified Claude versions are allowed',()=>{
 assert.deepEqual(CLAUDE_COMPATIBILITY.map(x=>[x.version,x.status]),[
  ['2.1.284','verified'],['2.1.286','verified'],['2.1.287','checking']
 ]);
 for(const version of ['2.1.284','2.1.286'])assert.equal(isClaudeVersionAllowed(version),true);
 for(const version of ['2.1.287','9.9.9',''])assert.equal(isClaudeVersionAllowed(version),false);
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
 await writeFile(join(dir,`${process.pid}.json`),JSON.stringify({sessionId:'fixture',pid:process.pid,version,peerProtocol:1,procStart:'unused',cwd:home,messagingSocketPath:join(home,'unused.sock')}),{mode:0o600});
 assert.equal(await findClaudeIdentity('fixture',home),null);
 assert.equal(processInspections,0);
});
