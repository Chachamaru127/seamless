import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat,symlink,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {observeSeen} from '../src/seen.ts';
const row={provider:'claude' as const,nativeId:'a',generation:'g',cwd:'/work'};
async function fixture(t:{after:(f:()=>Promise<void>)=>void}){const home=await mkdtemp(join(tmpdir(),'cldx-seen-'));t.after(()=>rm(home,{recursive:true,force:true}));return join(home,'seen.json');}
test('seen distinguishes unknown, unchanged, generation and new ID without saving body',async t=>{
 const path=await fixture(t);
 assert.deepEqual((await observeSeen(path,[row],100)).changes.get('claude:a'),{change:'unknown'});
 assert.deepEqual((await observeSeen(path,[row],101)).changes.get('claude:a'),{change:'none'});
 assert.deepEqual((await observeSeen(path,[{...row,generation:'new'}],102)).changes.get('claude:a'),{change:'generation_changed'});
 const next={...row,nativeId:'b',body:'BODY_NEVER_STORED'};
 assert.deepEqual((await observeSeen(path,[next],103)).changes.get('claude:b'),{change:'new',possible_restart_of:'a'});
 assert.equal((await stat(path)).mode&0o777,0o600);
 const text=await readFile(path,'utf8');assert.ok(!text.includes('BODY_NEVER_STORED'));assert.deepEqual(Object.keys(JSON.parse(text)[0]).sort(),['at','cwd','generation','nativeId','provider']);
});
test('seen expires rows after 24 hours and does not link another product or workspace',async t=>{
 const path=await fixture(t);await observeSeen(path,[row],0);
 const result=await observeSeen(path,[{...row,nativeId:'b'}],86400001);
 assert.deepEqual(result.changes.get('claude:b'),{change:'unknown'});assert.equal(JSON.parse(await readFile(path,'utf8')).length,1);
 assert.deepEqual((await observeSeen(path,[{...row,provider:'codex'}],86400002)).changes.get('codex:a'),{change:'unknown'});
 assert.deepEqual((await observeSeen(path,[{...row,cwd:'/other'}],86400003)).changes.get('claude:a'),{change:'unknown'});
});
test('seen ambiguity never invents a restart predecessor',async t=>{
 const path=await fixture(t);await observeSeen(path,[row,{...row,nativeId:'b'}],1);
 assert.deepEqual((await observeSeen(path,[{...row,nativeId:'c'}],2)).changes.get('claude:c'),{change:'new'});
});
test('seen rejects corrupt files, wrong modes and symlinks without overwriting them',async t=>{
 const path=await fixture(t);await writeFile(path,'bad',{mode:0o600});
 assert.equal((await observeSeen(path,[row])).changes.get('claude:a')?.change,'unknown');assert.equal(await readFile(path,'utf8'),'bad');
 await writeFile(path,'[]');await chmod(path,0o644);await observeSeen(path,[row]);assert.equal(await readFile(path,'utf8'),'[]');
 const link=path+'.link';await symlink(path,link);await observeSeen(link,[row]);assert.equal((await stat(path)).mode&0o777,0o644);
});
test('concurrent seen updates merge the winning snapshot under the shared lock',async t=>{
 const path=await fixture(t);await Promise.all([observeSeen(path,[row],1),observeSeen(path,[{...row,nativeId:'b'}],1)]);
 assert.deepEqual(JSON.parse(await readFile(path,'utf8')).map((n:{nativeId:string})=>n.nativeId).sort(),['a','b']);
});

test('same native ID moving workspace is not described as unchanged or generation-only',async t=>{
 const path=await fixture(t);await observeSeen(path,[row],1);
 assert.equal((await observeSeen(path,[{...row,cwd:'/other'}],2)).changes.get('claude:a')?.change,'unknown');
});
