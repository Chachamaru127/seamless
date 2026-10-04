import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,chmod,symlink,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {signed,createSignatureVerifier} from '../src/caller.ts';
async function fixture(t:any){
 const home=await realpath(await mkdtemp(join(tmpdir(),'signature-')));t.after(()=>rm(home,{recursive:true,force:true}));
 const binary=join(home,'app'),cache=join(home,'.seamless','signature-cache.json');await writeFile(binary,'binary');
 let calls=0;const verifier=()=>createSignatureVerifier(async(_file,args,options)=>{calls++;assert.equal(options.timeout,5000);assert.match(args[2],/Q6L2SF6YDW/);});
 return {home,binary,cache,verifier,calls:()=>calls};
}
test('fresh success is shared across verifier instances and contains only permitted fields',async t=>{
 const f=await fixture(t);assert.equal(await signed(f.binary,'claude',f.verifier(),f.home),true);
 assert.equal(await signed(f.binary,'claude',f.verifier(),f.home),true);assert.equal(f.calls(),1);
 const saved=JSON.parse(await readFile(f.cache,'utf8'));assert.deepEqual(Object.keys(saved),[f.binary]);
 assert.deepEqual(Object.keys(saved[f.binary]).sort(),['at','ctimeMs','dev','ino','mtimeMs','size','team']);
 assert.equal((await stat(f.cache)).mode&0o777,0o600);assert.equal((await stat(join(f.home,'.seamless'))).mode&0o777,0o700);
});
for(const field of ['dev','ino','size','mtimeMs','ctimeMs','at','team'])test(`changed ${field} forces verification`,async t=>{
 const f=await fixture(t),now=Date.now();await signed(f.binary,'claude',f.verifier(),f.home,now);
 const saved=JSON.parse(await readFile(f.cache,'utf8'));
 saved[f.binary][field]=field==='team'?'2DC432GLL2':field==='at'?now-86400001:saved[f.binary][field]+1;
 await writeFile(f.cache,JSON.stringify(saved));assert.equal(await signed(f.binary,'claude',f.verifier(),f.home,now),true);assert.equal(f.calls(),2);
});
for(const bad of ['corrupt','mode','symlink'])test(`ignores ${bad} cache`,async t=>{
 const f=await fixture(t);await signed(f.binary,'claude',f.verifier(),f.home);
 if(bad==='corrupt')await writeFile(f.cache,'{');
 if(bad==='mode')await chmod(f.cache,0o644);
 if(bad==='symlink'){const target=join(f.home,'target');await writeFile(target,await readFile(f.cache),{mode:0o600});await rm(f.cache);await symlink(target,f.cache);}
 assert.equal(await signed(f.binary,'claude',f.verifier(),f.home),true);assert.equal(f.calls(),2);
});
for(const timeout of [false,true])test(`does not retain ${timeout?'timeout':'rejection'}`,async t=>{
 const f=await fixture(t);let calls=0;const verify=createSignatureVerifier(async()=>{calls++;throw Object.assign(Error('failed'),{killed:timeout});});
 for(let i=0;i<2;i++)assert.equal(await signed(f.binary,'claude',verify,f.home),false);
 assert.equal(calls,2);await assert.rejects(readFile(f.cache));
});
test('unwritable cache leaves verified identity usable',async t=>{
 const f=await fixture(t);await writeFile(join(f.home,'.seamless'),'not a directory');
 assert.equal(await signed(f.binary,'claude',f.verifier(),f.home),true);
});
test('binary changed during verification is rejected and not saved',async t=>{
 const f=await fixture(t);assert.equal(await signed(f.binary,'claude',async()=>{await writeFile(f.binary,'changed binary');return 'Q6L2SF6YDW';},f.home),false);await assert.rejects(readFile(f.cache));
});
test('provider selects exactly one team and wrong signer is rejected',async t=>{
 const f=await fixture(t);
 for(const provider of ['claude','codex'] as const){let calls=0;const team=provider==='claude'?'Q6L2SF6YDW':'2DC432GLL2';
 const verify=createSignatureVerifier(async(_file,args)=>{calls++;assert.ok(args[2].includes(team));throw Error('other signer');});
 assert.equal(await signed(f.binary,provider,verify,f.home),false);assert.equal(calls,1);}
});
