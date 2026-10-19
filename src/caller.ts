import {isClaudeVersionAllowed,isVersionAllowed} from './compat.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {join,basename} from 'node:path';
import {realpath,readdir,stat} from 'node:fs/promises';
import {readPrivateJson,writePrivateJson} from './limits.ts';
import {command,findClaudeIdentityByPid,claudeSessionRecord,claudeProcessMatches,processFiles,type ProcessFiles} from './native-runtime.ts';
import {codexIdentity,type SessionIdentity,type ScanOptions} from './sessions-scan.ts';
export type Caller=SessionIdentity&{source:'claude-ancestor'|'codex-turn-metadata'|'grok-ancestor'};
export type CallerResult={status:'ok';caller:Caller}|{status:'caller_unobserved';reason:string}|{status:'unsupported_version';reason:string;version:string};
// executable is read with lsof only when the process may be a Claude or Codex ancestor; command is argv[0] from ps.
export type Ancestor={pid:number;ppid:number;executable:string|null;command?:string};
export type CallerOptions=ScanOptions&{signature?:SignatureVerifier;codexLocations?:()=>Promise<string[]>;pid?:number;env?:NodeJS.ProcessEnv;cwd?:string;processCwd?:(pid:number)=>Promise<string|null>;process?:(pid:number)=>Promise<Ancestor|null>;previous?:Caller;grokLocations?:()=>Promise<string[]>};
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
// The Grok launcher (~/.grok/bin/grok) and the versioned binaries it points to (~/.grok/downloads/grok-<version>-macos-<arch>).
export async function grokLocations(home=homedir()):Promise<string[]>{
 const downloads=join(home,'.grok','downloads'),names=await readdir(downloads).catch(()=>[]);
 return [join(home,'.grok','bin','grok'),...names.filter(name=>/^grok-\d+\.\d+\.\d+-macos-/.test(name)).map(name=>join(downloads,name))];
}
export type SignatureTeam='2DC432GLL2'|'Q6L2SF6YDW'|'5Y6N3AJ54S';
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
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([path,v])=>path.startsWith('/')&&v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')==='at,ctimeMs,dev,ino,mtimeMs,size,team'&&[...signatureFields,'at'].every(k=>typeof v[k]==='number'&&Number.isFinite(v[k]))&&['2DC432GLL2','Q6L2SF6YDW','5Y6N3AJ54S'].includes(v.team));
}
export async function signed(path:string,provider:'claude'|'codex'|'grok',verify:SignatureVerifier,home:string,now=Date.now()){
 try{
  path=await realpath(path);const info=await stat(path);
  // Grok Build CLI is signed with X.AI Corporation's Developer ID (team 5Y6N3AJ54S, checked 2026-10-08).
  const team=provider==='codex'?'2DC432GLL2':provider==='grok'?'5Y6N3AJ54S':'Q6L2SF6YDW';
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
 try{const line=(await command('ps',['-p',String(pid),'-o','ppid=,comm='])).trim(),m=/^(\d+)\s+(.+)$/.exec(line);if(!m)return null;return {pid,ppid:Number(m[1]),executable:null,command:m[2]};}catch{return null;}
}
export async function processCwd(pid:number):Promise<string|null>{
 try{return (await command('lsof',['-a','-p',String(pid),'-d','cwd','-Fn'])).split('\n').find(line=>line.startsWith('n'))?.slice(1)??null;}catch{return null;}
}
// A caller identified earlier in the same call is confirmed again cheaply: the same process must still be running
// from the same start, and its record must still name the same conversation, generation, workspace and socket.
// Anything else falls back to the full identification. The ancestor walk and signature are not repeated: the
// process they established cannot be replaced while its pid and start time stay the same.
async function stillCaller(previous:Caller,options:CallerOptions):Promise<boolean>{
 try{
  const home=options.home??homedir();
  if(previous.source==='claude-ancestor'){
   if(previous.pid===undefined)return false;
   const m=await claudeSessionRecord(previous.pid,home,options.env);
   return !!m&&m.sessionId===previous.nativeId&&`${previous.pid}@${m.startedAt}`===previous.generation&&m.messagingSocketPath===previous.socket&&await realpath(m.cwd)===previous.cwd&&await claudeProcessMatches(previous.pid,m.procStart,options.claude?.command??command);
  }
  if(previous.source==='grok-ancestor'){
   if(previous.pid===undefined)return false;
   const {readGrokLedger,grokRowAlive,grokGeneration}=await import('./adapters/grok.ts');
   const rows=(await readGrokLedger(home))?.filter(r=>r.pid===previous.pid)??[];
   return rows.length===1&&rows[0].session_id===previous.nativeId&&grokGeneration(rows[0])===previous.generation&&await realpath(rows[0].cwd)===previous.cwd&&await grokRowAlive(rows[0],{...options,...options.grok});
  }
  const n=await codexIdentity(previous.nativeId,options);
  return !!n&&n.generation===previous.generation&&n.cwd===previous.cwd;
 }catch{return false;}
}
export async function identifyCaller(context:{kind:'cli'|'mcp';meta?:unknown},options:CallerOptions={}):Promise<CallerResult>{
 const fail=(reason:string):CallerResult=>({status:'caller_unobserved',reason});
 if(options.previous&&await stillCaller(options.previous,options))return {status:'ok',caller:options.previous};
 try{
  const home=options.home??homedir(),inspect=options.process??processInfo;
  const locations=options.codexLocations??(()=>codexLocations(home)),run=options.claude?.command??command;
  // The executable is listed with lsof only for a process that has a Claude session record or whose argv[0] is a known
  // Codex binary; other ancestors are passed over. If that finds nothing, every ancestor is listed once more, as before.
  // The executable that is verified always comes from lsof, never from argv[0].
  let skipped=false,ledger:Promise<import('./adapters/grok.ts').GrokRow[]|null>|undefined;
  const grok=await import('./adapters/grok.ts'),grokRows=()=>ledger??=grok.readGrokLedger(home),grokPaths=options.grokLocations??(()=>grokLocations(home));
  // A Grok TUI ancestor is the caller only when its pid is in Grok's ledger, the row's process started when the row says,
  // the row's workspace is the process's own working directory, and the executable carries X.AI's signature.
  // Environment variables and arguments naming a conversation are never used.
  const grokCaller=async(current:Ancestor,files?:ProcessFiles):Promise<CallerResult>=>{
   const rows=(await grokRows())?.filter(r=>r.pid===current.pid)??[];
   if(rows.length!==1||!await grok.grokRowAlive(rows[0],{...options,...options.grok}))return fail('grok_ledger_unobserved');
   const cwd=files?.cwd??await (options.processCwd??processCwd)(current.pid);
   let workspace:string;try{workspace=await realpath(rows[0].cwd);if(!cwd||await realpath(cwd)!==workspace)return fail('caller_workspace_mismatch');}catch{return fail('caller_workspace_mismatch');}
   if(!await signed(current.executable!,'grok',options.signature??verifySignature,home))return fail('signature_untrusted');
   const version=await (options.grok?.grokVersion??(()=>grok.grokVersion(home)))();
   if(!isVersionAllowed('grok',version,options))return {status:'unsupported_version',reason:version??'unknown',version:version??'unknown'};
   return {status:'ok',caller:{version:version||null,provider:'grok',nativeId:rows[0].session_id,generation:grok.grokGeneration(rows[0]),cwd:workspace,socket:'',pid:current.pid,source:'grok-ancestor'}};
  };
  const walk=async(every:boolean):Promise<CallerResult|'codex'|null>=>{
   let current=await inspect(options.pid??process.pid);const seen=new Set<number>();
   for(let i=0;i<8&&current&&current.ppid>1;i++){
    if(seen.has(current.ppid))break;seen.add(current.ppid);
    current=await inspect(current.ppid);if(!current)break;
    let files:ProcessFiles|undefined;
    // A Grok process names itself grok (measured 2026-10-08). Such an ancestor ends the walk here: it is the caller only when
    // it is a known, signed Grok in the ledger, and otherwise (a headless grok -p, an executable lsof cannot show, a grok
    // installed elsewhere) nothing above it is taken as the caller, so a Claude or Codex ancestor is never mistaken for it.
    const grokNamed=typeof current.command==='string'&&/^grok(-\d+\.\d+\.\d+-macos-.*)?$/.test(basename(current.command));
    const candidate=every||grokNamed||await claudeSessionRecord(current.pid,home,options.env)!==null||typeof current.command==='string'&&await knownCodex(current.command,locations)||!!(await grokRows())?.some(r=>r.pid===current!.pid);
    if(current.executable===null&&candidate){files=await processFiles(current.pid,run);current={...current,executable:files.executable};}
    if(current.executable===null){if(grokNamed)return fail('grok_identity_unobserved');skipped=true;continue;}
    if(grokNamed&&!await knownCodex(current.executable,grokPaths))return fail('grok_identity_unobserved');
    const n=await findClaudeIdentityByPid(current.pid,home,{...options,...options.claude},true,files);
    if(n){if(!await signed(current.executable,'claude',options.signature??verifySignature,home))return fail('signature_untrusted');if(!isClaudeVersionAllowed(n.version??'unknown',{...options,...options.claude}))return {status:'unsupported_version',reason:n.version??'unknown',version:n.version??'unknown'};return {status:'ok',caller:{...n,provider:'claude',source:'claude-ancestor'}};}
    if(await knownCodex(current.executable,locations)){if(!await signed(current.executable,'codex',options.signature??verifySignature,home))return fail('signature_untrusted');return 'codex';}
    if(await knownCodex(current.executable,grokPaths))return grokCaller(current,files);
   }
   return null;
  };
  let found=await walk(false);if(found===null&&skipped)found=await walk(true);
  if(found!==null&&found!=='codex')return found;
  const codex=found==='codex';
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
