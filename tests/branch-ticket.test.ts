import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createAutomatic,parseTicket} from '../src/automatic.ts';
import type {Caller} from '../src/caller.ts';
for(const duringWrite of [false,true])for(const change of ['branch','generation'])test(`ticket stops ${change} interruption, during write=${duringWrite}, with zero writes`,async t=>{
 const home=await realpath(await mkdtemp(join(tmpdir(),'cldx-branch-')));t.after(()=>rm(home,{recursive:true,force:true}));
 const git=(...args:string[])=>execFileSync('git',['-C',home,...args],{stdio:'pipe'});git('init','-b','main');
 const caller:Caller={provider:'claude',nativeId:'a',generation:'g',cwd:home,socket:'unused',source:'claude-ancestor'},target={...caller,nativeId:'b'};let writes=0;
 const interrupt=()=>{if(change==='branch')git('symbolic-ref','HEAD','refs/heads/feature');else target.generation='restarted';};
 const automatic=createAutomatic({home,caller:async()=>({status:'ok',caller}),scan:async()=>({sessions:[caller,target],codexWorkspace:'observed'}),inspect:async()=>target,adapter:{read:async()=>({status:'ok'}),send:async(_r,_e,authorize)=>{if(duringWrite)interrupt();if(!await authorize!())return {status:'rejected'};writes++;return {status:'submitted'};}}});
 const list=await automatic('sessions',{}),ticket=list.candidates[0].ticket;assert.equal(parseTicket(ticket).branch,'refs/heads/main');
 if(!duringWrite)interrupt();
 assert.equal((await automatic('send',{ticket,id:'race',text:'hi'})).status,change==='branch'?'workspace_changed':'generation_mismatch');assert.equal(writes,0);
});
