import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,chmod,symlink,rm,readdir,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {readLimits,writeLimits,clearLimits,validLimits,type Limits} from '../src/limits.ts';
const empty:Limits={version:1,exclude:[],scope:null,operations:null};
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
 const dir=await mkdtemp(join(tmpdir(),'cldx-limits-'));t.after(()=>rm(dir,{recursive:true,force:true}));return {dir,path:join(dir,'limits.json')};
}
test('missing limits are distinct from unusable limits',async t=>{
 const {path}=await fixture(t);assert.deepEqual(await readLimits(path),{status:'absent',hash:null});
 await writeFile(path,'{broken',{mode:0o600});assert.equal((await readLimits(path)).status,'unusable');
 assert.equal((await writeLimits(empty,null,path)).status,'unusable');assert.equal(await readFile(path,'utf8'),'{broken');
});
test('limits round trip and stale hashes conflict without overwriting',async t=>{
 const {path}=await fixture(t);const saved=await writeLimits(empty,null,path);assert.equal(saved.status,'ok');
 const value=await readLimits(path);assert.equal(value.status,'ok');if(value.status!=='ok')return;
 assert.deepEqual(value.value,empty);assert.equal((await writeLimits(empty,null,path)).status,'conflict');
 assert.equal((await writeLimits(empty,value.hash,path)).status,'ok');
});
test('symlinks, wrong modes, directories and unknown fields are unusable',async t=>{
 const {dir,path}=await fixture(t);const target=join(dir,'target');await writeFile(target,JSON.stringify(empty),{mode:0o600});await symlink(target,path);
 assert.equal((await readLimits(path)).status,'unusable');assert.equal((await writeLimits(empty,null,path)).status,'unusable');
 await rm(path);await writeFile(path,JSON.stringify(empty),{mode:0o644});assert.equal((await readLimits(path)).status,'unusable');
 await chmod(path,0);assert.equal((await readLimits(path)).status,'unusable');await chmod(path,0o600);
 await writeFile(path,JSON.stringify({...empty,unknown:true}));assert.equal((await readLimits(path)).status,'unusable');
 await rm(path);await mkdir(path);assert.equal((await readLimits(path)).status,'unusable');
});
test('invalid schema is rejected on both read and write',async t=>{
 const {path}=await fixture(t);
 for(const value of [null,[],{}, {...empty,version:2},{...empty,exclude:[{}]},{...empty,exclude:['unimplemented']},{...empty,scope:'unknown'},{...empty,operations:[]}]){
  await writeFile(path,JSON.stringify(value),{mode:0o600});assert.equal((await readLimits(path)).status,'unusable');
  assert.equal((await writeLimits(value as Limits,null,path)).status,'unusable');
 }
});
test('failure after temporary write preserves original bytes and cleans temporary files',async t=>{
 const {dir,path}=await fixture(t);await writeFile(path,JSON.stringify(empty,null,2),{mode:0o600});
 const original=await readFile(path,'utf8'),before=await readLimits(path);assert.equal(before.status,'ok');if(before.status!=='ok')return;
 const result=await writeLimits(empty,before.hash,path,{beforeRename:async()=>{throw new Error('injected failure');}});
 assert.equal(result.status,'unusable');assert.equal(await readFile(path,'utf8'),original);assert.deepEqual(await readdir(dir),['limits.json']);
});
test('dead process lock is reclaimed but a live owner is never replaced',async t=>{
 const {path}=await fixture(t);
 const child=fork(new URL('./support/limits-writer.ts',import.meta.url),[path,'exit'],{execPath:process.execPath,stdio:['ignore','ignore','pipe','ipc']});
 const exited=once(child,'exit');const pid=child.pid!;await exited;
 await writeFile(`${path}.lock`,JSON.stringify({pid,token:'dead'}),{mode:0o600});assert.equal((await writeLimits(empty,null,path)).status,'ok');
 await writeFile(`${path}.lock`,JSON.stringify({pid:process.pid,token:'live'}),{mode:0o600});
 assert.equal((await writeLimits(empty,null,path,{lockTimeoutMs:30})).status,'unusable');assert.equal(JSON.parse(await readFile(`${path}.lock`,'utf8')).token,'live');
});
for(const existing of [false,true])test(`two processes released from the same snapshot preserve the winner and report conflict (existing=${existing})`, {timeout:10000},async t=>{
 const {path}=await fixture(t);
 if(existing)await writeFile(path,JSON.stringify(empty,null,2),{mode:0o600});
 const snapshot=await readLimits(path);assert.notEqual(snapshot.status,'unusable');if(snapshot.status==='unusable')return;
 const children=[0,1].map(()=>fork(new URL('./support/limits-writer.ts',import.meta.url),[path],{execPath:process.execPath,stdio:['ignore','ignore','pipe','ipc']}));
 t.after(async()=>{for(const child of children)if(child.exitCode===null)child.kill();});
 const exits=children.map(child=>once(child,'exit'));
 const ready=await Promise.all(children.map(child=>once(child,'message')));assert.deepEqual(ready.map(x=>x[0]),[{status:'ready',hash:snapshot.hash},{status:'ready',hash:snapshot.hash}]);
 const replies=children.map(child=>once(child,'message'));for(const child of children)child.send('go');
 const results=(await Promise.all(replies)).map(x=>x[0] as {status:string;hash?:string});
 assert.deepEqual(results.map(x=>x.status).sort(),['conflict','ok']);
 const current=await readLimits(path);assert.equal(current.status,'ok');if(current.status==='ok'){assert.deepEqual(current.value,empty);assert.equal(current.hash,results.find(x=>x.status==='ok')!.hash);}
 for(const [code] of await Promise.all(exits))assert.equal(code,0);
});

test('foreign owner is unusable without changing filesystem ownership',async t=>{
 const {path}=await fixture(t);await writeFile(path,JSON.stringify(empty),{mode:0o600});
 const uid=process.getuid!();t.mock.method(process as NodeJS.Process & {getuid:()=>number},'getuid',()=>uid+1);
 assert.equal((await readLimits(path)).status,'unusable');
 assert.equal((await writeLimits(empty,null,path)).status,'unusable');
});
test('external edit before rename returns conflict and preserves that edit',async t=>{
 const {path}=await fixture(t);await writeFile(path,JSON.stringify(empty,null,2),{mode:0o600});
 const before=await readLimits(path);assert.equal(before.status,'ok');if(before.status!=='ok')return;
 const external=JSON.stringify(empty)+'  ';
 const result=await writeLimits(empty,before.hash,path,{beforeRename:async()=>{await writeFile(path,external);}});
 assert.equal(result.status,'conflict');assert.equal(await readFile(path,'utf8'),external);
});

test('clear returns absent hash for existing and absent settings and preserves hash conflicts',async t=>{
 const {path}=await fixture(t);assert.deepEqual(await clearLimits(null,path),{status:'ok',hash:null});
 await writeLimits(empty,null,path);const current=await readLimits(path);assert.equal(current.status,'ok');if(current.status!=='ok')return;
 assert.deepEqual(await clearLimits('stale',path),{status:'conflict'});assert.deepEqual(await readLimits(path),current);
 assert.deepEqual(await clearLimits(current.hash,path),{status:'ok',hash:null});assert.deepEqual(await readLimits(path),{status:'absent',hash:null});
});

test('workspace exclusions reject relative paths on read and write',async t=>{
 const {path}=await fixture(t);
 for(const workspace of ['relative','./relative','../relative','~/relative','']){
  const value:Limits={...empty,exclude:[{workspace}]};
  assert.deepEqual(await writeLimits(value,null,path),{status:'unusable'});
  await writeFile(path,JSON.stringify(value),{mode:0o600});
  assert.deepEqual(await readLimits(path),{status:'unusable'});
 }
 for(const workspace of ['/','/absolute/missing']){
  await writeFile(path,JSON.stringify({...empty,exclude:[{workspace}]}));
  const current=await readLimits(path);assert.equal(current.status,'ok');
  if(current.status==='ok')assert.equal((await writeLimits(current.value,current.hash,path)).status,'ok');
 }
});

 test('markUnapproved is optional and accepts only booleans',async t=>{
 const {path}=await fixture(t);
 for(const value of [empty,{...empty,markUnapproved:true},{...empty,markUnapproved:false}]){
  assert.equal(validLimits(value),true);
  await writeFile(path,JSON.stringify(value),{mode:0o600});
  const loaded=await readLimits(path);assert.equal(loaded.status,'ok');
  if(loaded.status==='ok')assert.deepEqual(loaded.value,value);
 }
 for(const markUnapproved of ['yes',0,1,null,undefined])assert.equal(validLimits({...empty,markUnapproved}),false);
 for(const key of ['version','exclude','scope','operations']){const value:Record<string,unknown>={...empty,markUnapproved:true};delete value[key];assert.equal(validLimits(value),false);}
 assert.equal(validLimits({...empty,markUnapproved:true,unknown:false}),false);
 });

test('strictVersions is optional and accepts only booleans',async t=>{
 const {path}=await fixture(t);
 for(const value of [empty,{...empty,strictVersions:true},{...empty,strictVersions:false}]){
  assert.equal(validLimits(value),true);
  await writeFile(path,JSON.stringify(value),{mode:0o600});
  const loaded=await readLimits(path);assert.equal(loaded.status,'ok');
  if(loaded.status==='ok')assert.deepEqual(loaded.value,value);
 }
 for(const strictVersions of ['true','false',0,1,null,undefined])assert.equal(validLimits({...empty,strictVersions}),false);
 assert.equal(validLimits({...empty,strictVersions:true,unknown:false}),false);
});
