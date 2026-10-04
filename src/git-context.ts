import {realpath,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {resolve} from 'node:path';

export type GitContext =
 | {state:'git';workspace:string;worktree:string;repository:string;headState:'attached'|'detached'|'unborn';branch:string|null;head:string|null;dirty:boolean}
 | {state:'no_git';workspace:string}
 | {state:'unknown';workspace:string|null;reason:'path_unavailable'|'timeout'|'command_failed'|'invalid_output'};
export type GitRunner = (args:string[], options:{cwd:string;env:NodeJS.ProcessEnv;timeout:number;maxBuffer:number}) => Promise<{stdout:string;stderr:string;code:number}>;
const run:GitRunner=(args,options)=>new Promise((res,rej)=>{
 execFile('git',args,{...options,encoding:'utf8'},(error,stdout,stderr)=>{
  if(error && (typeof error.code!=='number' || error.killed))rej(error);
  else res({stdout,stderr,code:error ? Number(error.code):0});
 });
});
export async function observeGit(cwd:string,options:{runner?:GitRunner}={}):Promise<GitContext>{
 let workspace:string;
 try{workspace=await realpath(cwd);if(!(await stat(workspace)).isDirectory())throw new Error();}catch{return {state:'unknown',workspace:null,reason:'path_unavailable'};}
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 env.LC_ALL='C';env.GIT_OPTIONAL_LOCKS='0';
 const runner=options.runner??run;
 const base=['--no-optional-locks','-c','core.fsmonitor=false'];
 const call=(args:string[])=>runner([...base,...args],{cwd:workspace,env,timeout:5000,maxBuffer:1024*1024});
 const unknown=(reason:'timeout'|'command_failed'|'invalid_output'):GitContext=>({state:'unknown',workspace,reason});
 try{
  const inside=await call(['rev-parse','--is-inside-work-tree']);
  if(inside.code!==0){if(inside.code===128&&/^fatal: not a git repository(?: \(|:)/.test(inside.stderr))return {state:'no_git',workspace};return unknown('command_failed');}
  if(inside.stdout.trim()!=='true')return unknown('invalid_output');
  const wt=await call(['rev-parse','--show-toplevel']);
  const common=await call(['rev-parse','--path-format=absolute','--git-common-dir']);
  const branchResult=await call(['symbolic-ref','-q','HEAD']);
  const headResult=await call(['rev-parse','--verify','--quiet','HEAD^{commit}']);
  if(wt.code!==0||common.code!==0||![0,1].includes(branchResult.code))return unknown('command_failed');
  const branch=branchResult.code===0?branchResult.stdout.trim():null;
  const head=headResult.code===0?headResult.stdout.trim():null;
  if((branch!==null&&!branch.startsWith('refs/heads/'))||(head!==null&&!/^[0-9a-f]{40,64}$/.test(head)))return unknown('invalid_output');
  if(head===null&&branch===null)return unknown('command_failed');
  if(head===null){if(headResult.code!==1)return unknown('command_failed');const exists=await call(['show-ref','--exists',branch!]);if(exists.code!==2)return unknown('command_failed');}
  const filters=await call(['config','--name-only','--get-regexp','^filter\\..*\\.(clean|process|required)$']);
  if(![0,1].includes(filters.code))return unknown('command_failed');
  const disable:string[]=[];
  for(const key of filters.stdout.split(/\r?\n/).filter(Boolean)){
   if(key.includes('=')||!/^filter\..+\.(clean|process|required)$/i.test(key))return unknown('invalid_output');
   disable.push('-c',`${key}=${/\.required$/i.test(key)?'false':''}`);
  }
  const status=await call([...disable,'status','--porcelain=v1','--untracked-files=normal','--ignore-submodules=all']);
  if(status.code!==0)return unknown('command_failed');
  const worktree=await realpath(wt.stdout.trim());
  const repository=await realpath(resolve(workspace,common.stdout.trim()));
  return {state:'git',workspace,worktree,repository,headState:head===null?'unborn':branch===null?'detached':'attached',branch,head,dirty:status.stdout.length>0};
 }catch(error){const e=error as {code?:string;killed?:boolean};return unknown(e.code==='ETIMEDOUT'||e.killed?'timeout':'command_failed');}
}
