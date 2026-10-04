import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,stat,mkdir,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {observeGit} from '../src/git-context.ts';
const root=await mkdtemp(join(tmpdir(),'claudex-git-'));
function git(cwd:string,...args:string[]){return execFileSync('git',args,{cwd,encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'}}).trim();}
async function repo(name:string,commit=true){const dir=join(root,name);git(root,'init','-q',dir);git(dir,'config','user.email','fixture@example.invalid');git(dir,'config','user.name','Fixture');if(commit){await writeFile(join(dir,'a'),'hello');git(dir,'add','a');git(dir,'commit','-qm','fixture');}return dir;}
test('actual worktrees, clones, detached, unborn and no Git remain distinct',async()=>{
 const a=await repo('a'); const before=(await stat(join(a,'.git/index'))).mtimeMs; const ca=await observeGit(a);assert.equal(ca.state,'git');if(ca.state!=='git')return;assert.equal(ca.dirty,false);assert.equal(ca.headState,'attached');assert.match(ca.branch!,/^refs\/heads\//);assert.equal((await stat(join(a,'.git/index'))).mtimeMs,before);
 const linked=join(root,'linked');git(a,'worktree','add','-qb','other',linked);const cl=await observeGit(linked);assert.equal(cl.state,'git');if(cl.state==='git'){assert.equal(cl.repository,ca.repository);assert.notEqual(cl.worktree,ca.worktree);assert.notEqual(cl.branch,ca.branch);}
 const same=join(root,'same');git(a,'worktree','add','--force',same,ca.branch!.replace('refs/heads/',''));const cs=await observeGit(same);if(cs.state==='git'){assert.equal(cs.branch,ca.branch);assert.notEqual(cs.worktree,ca.worktree);}else assert.fail('same branch worktree');
 const b=await repo('b');const cb=await observeGit(b);if(cb.state==='git')assert.notEqual(cb.repository,ca.repository);else assert.fail('repo');
 const clone=join(root,'clone');git(root,'clone','-q',a,clone);const cc=await observeGit(clone);if(cc.state==='git')assert.notEqual(cc.repository,ca.repository);else assert.fail('clone');
 git(clone,'checkout','--detach','-q');const detached=await observeGit(clone);if(detached.state==='git'){assert.equal(detached.headState,'detached');assert.equal(detached.branch,null);}else assert.fail('detached');
 const unborn=await observeGit(await repo('unborn',false));if(unborn.state==='git'){assert.equal(unborn.headState,'unborn');assert.equal(unborn.head,null);}else assert.fail('unborn');
 assert.equal((await observeGit(root)).state,'no_git');await writeFile(join(a,'untracked'),'x');const dirty=await observeGit(a);if(dirty.state==='git')assert.equal(dirty.dirty,true);
 const alias=join(root,'alias');await symlink(a,alias);assert.deepEqual(await observeGit(alias),await observeGit(a));
 const prior=process.env.GIT_DIR;process.env.GIT_DIR=join(b,'.git');try{assert.deepEqual(await observeGit(a),dirty);}finally{if(prior===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=prior;}
});
test('configured fsmonitor and clean/process filters are never executed',async()=>{const a=await repo('filters');const marker=join(root,'executed');git(a,'config','core.fsmonitor',`touch ${marker}`);git(a,'config','filter.danger.clean',`touch ${marker}`);git(a,'config','filter.danger.process',`touch ${marker}`);git(a,'config','filter.danger.required','true');await writeFile(join(a,'.gitattributes'),'a filter=danger\n');await writeFile(join(a,'a'),'changed');assert.equal((await observeGit(a)).state,'git');await assert.rejects(stat(marker));});
test('missing cwd and failing or timed out runner are unknown',async()=>{assert.equal((await observeGit(join(root,'missing'))).state,'unknown');for(const reason of ['timeout','command_failed']){const result=await observeGit(root,{runner:async()=>{throw Object.assign(new Error('SECRET_RUNNER_MESSAGE'),{code:reason==='timeout'?'ETIMEDOUT':'EIO'});}});assert.equal(result.state,'unknown');assert.ok(!JSON.stringify(result).includes('SECRET_RUNNER_MESSAGE'));}});

test('default subprocess timeout kills a slow Git executable',async()=>{const bin=join(root,'slow-bin');await mkdir(bin);const exe=join(bin,'git');await writeFile(exe,'#!/bin/sh\nexec /bin/sleep 30\n');await chmod(exe,0o700);const prior=process.env.PATH;process.env.PATH=bin;const start=Date.now();try{const observed=await observeGit(root);assert.equal(observed.state,'unknown');if(observed.state==='unknown')assert.equal(observed.reason,'timeout');assert.ok(Date.now()-start>=4500);assert.ok(Date.now()-start<15000);}finally{process.env.PATH=prior;}});
test('filter driver name containing equals is rejected before status can execute it',async()=>{
 const a=await repo('equals-filter'),marker=join(root,'equals-executed');
 await writeFile(join(a,'.gitattributes'),'a filter=x=y\n');
 git(a,'config','filter.x=y.clean',`touch ${marker}`);
 await writeFile(join(a,'a'),'changed-for-filter');
 const context=await observeGit(a);assert.equal(context.state,'unknown');
 if(context.state==='unknown')assert.equal(context.reason,'invalid_output');
 await assert.rejects(stat(marker));
});
