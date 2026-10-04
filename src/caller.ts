import {isClaudeVersionAllowed,isVersionAllowed} from './compat.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {realpath,readdir,stat} from 'node:fs/promises';
import {readPrivateJson,writePrivateJson} from './limits.ts';
import {command,findClaudeIdentityByPid} from './native-runtime.ts';
import {codexIdentity,type SessionIdentity,type ScanOptions} from './sessions-scan.ts';
export type Caller=SessionIdentity&{source:'claude-ancestor'|'codex-turn-metadata'};
export type CallerResult={status:'ok';caller:Caller}|{status:'caller_unobserved';reason:string}|{status:'unsupported_version';reason:string;version:string};
export type Ancestor={pid:number;ppid:number;executable:string;command?:string};
export type CallerOptions=ScanOptions&{signature?:SignatureVerifier;codexLocations?:()=>Promise<string[]>;pid?:number;env?:NodeJS.ProcessEnv;cwd?:string;processCwd?:(pid:number)=>Promise<string|null>;process?:(pid:number)=>Promise<Ancestor|null>};
export async function codexLocations(home=homedir()):Promise<string[]>{
 const releases=join(home,'.codex','packages','standalone','releases');
 const names=await readdir(releases).catch(()=>[]);
 return ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',...names.map(name=>join(releases,name,'bin','codex'))];
}
async function knownCodex(executable:string,locations:()=>Promise<string[]>):Promise<boolean>{
 const actual=await realpath(executable).catch(()=>null);if(!actual)return false;
 const known=await Promise.all((await locations()).map(path=>realpath(path).catch(()=>null)));
 return known.includes(actual);
}
export type SignatureTeam='2DC432GLL2'|'Q6L2SF6YDW';
export type SignatureVerifier=(path:string,team:SignatureTeam)=>Promise<string|null>;
const runSignature=promisify(execFile);
export function createSignatureVerifier(run:(file:string,args:string[],options:{timeout:number})=>Promise<unknown>=runSignature):SignatureVerifier{
 return async(path,team)=>{
  try{await run('/usr/bin/codesign',['--verify','--strict',`-R=anchor apple generic and certificate leaf[subject.OU] = "${team}"`,path],{timeout:5000});return team;}catch{return null;}
 };
}
export const verifySignature=createSignatureVerifier();
const signatureFields=['dev','ino','size','mtimeMs','ctimeMs'] as const;
type SignatureEntry=Pick<Awaited<ReturnType<typeof stat>>,typeof signatureFields[number]>&{team:SignatureTeam;at:number};
type SignatureCache=Record<string,SignatureEntry>;
function validSignatureCache(value:unknown):value is SignatureCache{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([path,v])=>path.startsWith('/')&&v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')==='at,ctimeMs,dev,ino,mtimeMs,size,team'&&[...signatureFields,'at'].every(k=>typeof v[k]==='number'&&Number.isFinite(v[k]))&&['2DC432GLL2','Q6L2SF6YDW'].includes(v.team));
}
export async function signed(path:string,provider:'claude'|'codex',verify:SignatureVerifier,home:string,now=Date.now()){
 try{
  path=await realpath(path);const info=await stat(path);
  const team=provider==='codex'?'2DC432GLL2':'Q6L2SF6YDW';
  const cachePath=join(home,'.seamless','signature-cache.json');
  const read=await readPrivateJson(cachePath,validSignatureCache);
  const fresh=(entry:SignatureEntry)=>entry.at<=now&&now-entry.at<=86400000;
  const matches=(entry:Pick<SignatureEntry,typeof signatureFields[number]>)=>signatureFields.every(k=>entry[k]===info[k]);
  const old=read.status==='ok'?read.value[path]:undefined;
  if(old&&old.team===team&&fresh(old)&&matches(old))return true;
  if(await verify(path,team)!==team)return false;
  // Do not persist a result for a binary replaced or modified during verification.
  if(!matches(await stat(path)))return false;
  if(read.status!=='unusable'){
   const next:SignatureCache=Object.fromEntries(Object.entries(read.status==='ok'?read.value:{}).filter(([,entry])=>fresh(entry)));
   next[path]={dev:info.dev,ino:info.ino,size:info.size,mtimeMs:info.mtimeMs,ctimeMs:info.ctimeMs,team,at:now};
   await writePrivateJson(next,read.hash,cachePath,validSignatureCache).catch(()=>{});
  }
  return true;
 }catch{return false;}
}
export async function processInfo(pid:number):Promise<Ancestor|null>{
 try{const line=(await command('ps',['-p',String(pid),'-o','ppid=,command='])).trim(),m=/^(\d+)\s+(.+)$/.exec(line);if(!m)return null;const paths=await command('lsof',['-a','-p',String(pid),'-d','txt','-Fn']);const executable=paths.split('\n').find(line=>line.startsWith('n'))?.slice(1);return executable?{pid,ppid:Number(m[1]),executable,command:m[2]}:null;}catch{return null;}
}
export async function processCwd(pid:number):Promise<string|null>{
 try{return (await command('lsof',['-a','-p',String(pid),'-d','cwd','-Fn'])).split('\n').find(line=>line.startsWith('n'))?.slice(1)??null;}catch{return null;}
}
export async function identifyCaller(context:{kind:'cli'|'mcp';meta?:unknown},options:CallerOptions={}):Promise<CallerResult>{
 const fail=(reason:string):CallerResult=>({status:'caller_unobserved',reason});
 try{
  const home=options.home??homedir(),inspect=options.process??processInfo;
  let current=await inspect(options.pid??process.pid);let codex=false;const seen=new Set<number>();
  for(let i=0;i<8&&current&&current.ppid>1;i++){
   if(seen.has(current.ppid))break;seen.add(current.ppid);
   current=await inspect(current.ppid);if(!current)break;
   const n=await findClaudeIdentityByPid(current.pid,home,{...options,...options.claude},true);
   if(n){if(!await signed(current.executable,'claude',options.signature??verifySignature,home))return fail('signature_untrusted');if(!isClaudeVersionAllowed(n.version??'unknown',{...options,...options.claude}))return {status:'unsupported_version',reason:n.version??'unknown',version:n.version??'unknown'};return {status:'ok',caller:{...n,provider:'claude',source:'claude-ancestor'}};}
   if(await knownCodex(current.executable,options.codexLocations??(()=>codexLocations(home)))){if(!await signed(current.executable,'codex',options.signature??verifySignature,home))return fail('signature_untrusted');codex=true;break;}
  }
  if(!codex)return fail('native_ancestor_missing');
  let id:unknown,source:Caller['source'];
  if(context.kind==='mcp'){
   const meta=context.meta as Record<string,unknown>|undefined;let value=meta?.['x-codex-turn-metadata'];
   if(typeof value==='string'){try{value=JSON.parse(value);}catch{return fail('invalid_turn_metadata');}}
   if(!value||typeof value!=='object'||Array.isArray(value))return fail('missing_turn_metadata');
   const m=value as Record<string,unknown>;id=m.thread_source==='subagent'?m.thread_id:m.session_id;source='codex-turn-metadata';
  }else{return fail('codex_cli_unsupported');}
  if(typeof id!=='string'||!id)return fail('missing_native_id');
  const version=await (options.version??(await import('./adapters/codex.ts')).desktopVersion)();
  if(!isVersionAllowed('codex',version,options))return {status:'unsupported_version',reason:version??'unknown',version:version??'unknown'};
  const n=await codexIdentity(id,{...options,version:async()=>version});if(!n)return fail('native_identity_unobserved');
  const cwd=await (options.processCwd??processCwd)(options.pid??process.pid);
  if(!cwd||await realpath(cwd)!==n.cwd)return fail('caller_workspace_mismatch');
  return {status:'ok',caller:{...n,source}};
 }catch{return fail('native_identity_unobserved');}
}
