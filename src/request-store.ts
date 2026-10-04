import {constants} from 'node:fs';
import {mkdir,open,link,unlink,readdir,lstat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
export type RequestParty={id:string;provider:'claude'|'codex';nativeId:string;generation:string;cwd:string};
export type RequestRecord={id:string;sender:RequestParty;recipient:RequestParty;replyTo?:string;at:number;hash:string;status:string};
export const DAY=86400000;
export async function privateJson(path:string):Promise<any>{
 let file;try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=await file.stat();if(!s.isFile()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o600||s.size>16384)return null;return JSON.parse(await file.readFile('utf8'));}catch{return null;}finally{await file?.close();}
}
async function publish(path:string,contents:string|Buffer){
 const tmp=path+'.'+randomUUID();let f;
 try{f=await open(tmp,'wx',0o600);await f.writeFile(contents);await f.sync();await f.close();f=undefined;await link(tmp,path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return false;throw e;}finally{await f?.close();await unlink(tmp).catch(()=>{});}
}
export async function requestHash(keyPath:string,parts:unknown[]):Promise<string>{
 await mkdir(dirname(keyPath),{recursive:true,mode:0o700});
 await publish(keyPath,randomBytes(32));
 const f=await open(keyPath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=await f.stat();if(!s.isFile()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o600||s.size!==32)throw Error('unsafe_key');return createHmac('sha256',await f.readFile()).update(JSON.stringify(parts)).digest('hex');}finally{await f.close();}
}
// A persistent claim also covers a process lost between reservation and native write.
export async function claimRequest(dir:string,hash:string,id:string,now:number):Promise<{duplicate?:string;release:()=>Promise<void>}>{
 await mkdir(dir,{recursive:true,mode:0o700});const s=await lstat(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700)throw Error('unsafe_store');
 const path=join(dir,hash+'.claim');
 if(!await publish(path,JSON.stringify({id,at:now}))){
  const old=await privateJson(path);if(!old||typeof old.id!=='string'||!Number.isFinite(old.at))throw Error('claim_unreadable');
  if(old.id===id)return {release:async()=>{}};
  const prior=(await requests(dir)).find(r=>r.id===old.id&&r.hash===hash);
  if(now-old.at<=DAY&&(!prior||!['submitted','rejected'].includes(prior.status)))return {duplicate:old.id,release:async()=>{}};
  // Expired claims are moved out of the namespace under a separate exclusive lock.
  const lock=path+'.expire';let handle;
  try{handle=await open(lock,'wx',0o600);const current=await privateJson(path);if(current&&current.id===old.id&&current.at===old.at)await unlink(path);}
  catch{throw Error('claim_busy');}finally{await handle?.close();if(handle)await unlink(lock).catch(()=>{});}
  return claimRequest(dir,hash,id,now);
 }
 return {release:async()=>{const current=await privateJson(path);if(current?.id===id)await unlink(path).catch(()=>{});}};
}
function isRecord(r:any):r is RequestRecord{return r&&typeof r.id==='string'&&typeof r.hash==='string'&&typeof r.status==='string'&&Number.isFinite(r.at)&&[r.sender,r.recipient].every(p=>p&&['claude','codex'].includes(p.provider)&&['id','nativeId','generation','cwd'].every(k=>typeof p[k]==='string'));}
export async function requests(dir:string):Promise<RequestRecord[]>{
 const out:RequestRecord[]=[];for(const name of await readdir(dir).catch(()=>[])){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const r=await privateJson(join(dir,name));if(isRecord(r))out.push(r);}return out;
}
