import {constants,openSync,closeSync,writeFileSync,readFileSync,lstatSync,fstatSync,fchmodSync,unlinkSync} from 'node:fs';
import {open,lstat,mkdir,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {dirname,join,basename} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

export type AutoScope='current_work'|'same_repository'|'any';
export type Limits={version:1;markUnapproved?:boolean;strictVersions?:boolean;codexMessageMaxChars?:number;exclude:Array<{provider?:'codex'|'claude'|'grok';nativeId?:string;workspace?:string}>;scope:AutoScope|null;operations:{read:boolean;send:boolean}|null};
export const unrestricted:Limits={version:1,exclude:[],scope:null,operations:null};
// Open decision 2 (Plans.md 7 章): the message body is refused, not shortened, above this many code points.
export const DEFAULT_CODEX_MESSAGE_MAX_CHARS=4000;
export function codexMessageMaxChars(limits:{codexMessageMaxChars?:number}):number{return limits.codexMessageMaxChars??DEFAULT_CODEX_MESSAGE_MAX_CHARS;}
export type LimitsRead=
 | {status:'absent';hash:null}
 | {status:'ok';value:Limits;hash:string}
 | {status:'unusable'};
export type LimitsWrite={status:'ok';hash:string|null}|{status:'conflict'|'unusable'};
export type LimitsWriteOptions={lockTimeoutMs?:number;beforeRename?:()=>Promise<void>};
export function defaultLimitsPath():string{return join(homedir(),'.seamless','limits.json');}
export function validLimits(value:unknown):value is Limits{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 if(!['version','exclude','scope','operations'].every(k=>Object.hasOwn(v,k))||Object.keys(v).some(k=>!['version','exclude','scope','operations','markUnapproved','strictVersions','codexMessageMaxChars'].includes(k))||Object.hasOwn(v,'markUnapproved')&&typeof v.markUnapproved!=='boolean'||Object.hasOwn(v,'strictVersions')&&typeof v.strictVersions!=='boolean'||Object.hasOwn(v,'codexMessageMaxChars')&&(!Number.isSafeInteger(v.codexMessageMaxChars)||(v.codexMessageMaxChars as number)<1)||v.version!==1||!Array.isArray(v.exclude)||v.scope!==null&&!['current_work','same_repository','any'].includes(v.scope as string))return false;
 if(!v.exclude.every(e=>e&&typeof e==='object'&&!Array.isArray(e)&&Object.keys(e).length>0&&Object.keys(e).every(k=>['provider','nativeId','workspace'].includes(k))&&(e.provider===undefined||['claude','codex','grok'].includes(e.provider))&&['nativeId','workspace'].every(k=>e[k]===undefined||typeof e[k]==='string'&&e[k].length>0)&&(e.workspace===undefined||e.workspace.startsWith('/'))))return false;
 const o=v.operations;
 return o===null||!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===2&&Object.keys(o).every(k=>['read','send'].includes(k))&&typeof (o as Record<string,unknown>).read==='boolean'&&typeof (o as Record<string,unknown>).send==='boolean';
}
function code(error:unknown):string|undefined{return (error as NodeJS.ErrnoException)?.code;}
function hash(bytes:Buffer|string):string{return createHash('sha256').update(bytes).digest('hex');}
function safeFile(s:{isFile:()=>boolean;mode:number;uid:number}):boolean{
 return s.isFile()&&(s.mode&0o7777)===0o600&&s.uid===process.getuid?.();
}
export async function readPrivateJson<T>(path:string,valid:(value:unknown)=>value is T):Promise<{status:'absent';hash:null}|{status:'ok';value:T;hash:string}|{status:'unusable'}>{
 let before;
 try{before=await lstat(path);}catch(error){return code(error)==='ENOENT'?{status:'absent',hash:null}:{status:'unusable'};}
 if(!safeFile(before))return {status:'unusable'};
 try{
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const current=await file.stat();
   if(!safeFile(current)||current.dev!==before.dev||current.ino!==before.ino)return {status:'unusable'};
   const bytes=await file.readFile(),value:unknown=JSON.parse(bytes.toString('utf8'));
   return valid(value)?{status:'ok',value,hash:hash(bytes)}:{status:'unusable'};
  }finally{await file.close();}
 }catch{return {status:'unusable'};}
}
function alive(pid:number):boolean{
 try{process.kill(pid,0);return true;}catch(error){return code(error)!=='ESRCH';}
}
function lockRecord(path:string):{pid:number;token:string;dev:number;ino:number}|null{
 try{
  const before=lstatSync(path);if(!safeFile(before))return null;
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const current=fstatSync(fd);
   if(!safeFile(current)||current.dev!==before.dev||current.ino!==before.ino)return null;
   const value=JSON.parse(readFileSync(fd,'utf8'));
   if(!Number.isSafeInteger(value.pid)||value.pid<=0||typeof value.token!=='string'||! /^[a-zA-Z0-9-]{1,64}$/.test(value.token))return null;
   return {pid:value.pid,token:value.token,dev:before.dev,ino:before.ino};
  }finally{closeSync(fd);}
 }catch{return null;}
}
function sameLock(a:ReturnType<typeof lockRecord>,b:ReturnType<typeof lockRecord>):boolean{
 return !!a&&!!b&&a.dev===b.dev&&a.ino===b.ino&&a.token===b.token;
}
async function acquire(path:string,timeoutMs:number):Promise<(()=>void)|null>{
 const deadline=Date.now()+timeoutMs;
 for(;;){
  const token=randomUUID();let fd:number;
  try{fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(error){
   if(code(error)!=='EEXIST')return null;
   const stale=lockRecord(path);
   if(stale&&!alive(stale.pid)){
    // Only one contender may remove this particular dead owner's inode.
    const claim=`${path}.reap-${stale.dev}-${stale.ino}-${stale.token}`;
    let claimFd:number|undefined;
    try{
     claimFd=openSync(claim,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
     if(sameLock(stale,lockRecord(path)))unlinkSync(path);
    }catch(error){if(!['EEXIST','ENOENT'].includes(code(error)??''))return null;}
    finally{if(claimFd!==undefined){closeSync(claimFd);try{unlinkSync(claim);}catch{}}}
   }
   if(Date.now()>=deadline)return null;
   await delay(10);continue;
  }
  try{fchmodSync(fd,0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,token}));}
  catch{closeSync(fd);try{unlinkSync(path);}catch{}return null;}
  closeSync(fd);
  return ()=>{if(lockRecord(path)?.token===token)unlinkSync(path);};
 }
}
export async function writePrivateJson<T>(value:T,expectedHash:string|null,path:string,valid:(value:unknown)=>value is T,options:LimitsWriteOptions={}):Promise<LimitsWrite>{
 if(!valid(value))return {status:'unusable'};
 // Serialize before the first await so callers cannot mutate the validated value.
 const bytes=JSON.stringify(value)+'\n';
 let release:(()=>void)|null=null,temp:string|undefined;
 try{
  const dir=dirname(path);await mkdir(dir,{recursive:true,mode:0o700});
  const parent=await lstat(dir);
  if(!parent.isDirectory()||parent.uid!==process.getuid?.()||(parent.mode&0o022)!==0)return {status:'unusable'};
  release=await acquire(`${path}.lock`,options.lockTimeoutMs??2000);
  if(!release)return {status:'unusable'};
  const current=await readPrivateJson(path,valid);
  if(current.status==='unusable')return current;
  if(current.hash!==expectedHash)return {status:'conflict'};
  const candidate=join(dir,`.${basename(path)}.${randomUUID()}.tmp`);
  const file=await open(candidate,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);temp=candidate;
  try{await file.chmod(0o600);await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  await options.beforeRename?.();
  const latest=await readPrivateJson(path,valid);
  if(latest.status==='unusable')return latest;
  if(latest.hash!==expectedHash)return {status:'conflict'};
  await rename(temp,path);temp=undefined;
  return {status:'ok',hash:hash(bytes)};
 }catch{return {status:'unusable'};}
 finally{if(temp)await unlink(temp).catch(()=>{});try{release?.();}catch{}}
}

export async function clearLimits(expectedHash:string|null,path=defaultLimitsPath()):Promise<LimitsWrite>{
 let release:(()=>void)|null=null;
 try{
  const dir=dirname(path);await mkdir(dir,{recursive:true,mode:0o700});const parent=await lstat(dir);
  if(!parent.isDirectory()||parent.uid!==process.getuid?.()||(parent.mode&0o022)!==0)return {status:'unusable'};
  release=await acquire(`${path}.lock`,2000);if(!release)return {status:'unusable'};
  const current=await readLimits(path);
  if(current.status!=='unusable'&&current.hash!==expectedHash)return {status:'conflict'};
  if(current.status!=='absent')await unlink(path);
  return {status:'ok',hash:null};
 }catch{return {status:'unusable'};}finally{try{release?.();}catch{}}
}

export function readLimits(path=defaultLimitsPath()):Promise<LimitsRead>{return readPrivateJson(path,validLimits);}
export function writeLimits(value:Limits,expectedHash:string|null,path=defaultLimitsPath(),options:LimitsWriteOptions={}):Promise<LimitsWrite>{return writePrivateJson(value,expectedHash,path,validLimits,options);}
