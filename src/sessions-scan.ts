import {isVersionAllowed,type CompatibilityOptions} from './compat.ts';
import {readdir,realpath} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {desktopVersion} from './adapters/codex.ts';
import {findClaudeIdentityByPid,findCodexOwner,createCodexOwnerLookup,OWNER_LIMIT_MS,codexReachable,type NativeIdentity,type ClaudeInspection} from './native-runtime.ts';
import {observeGit,type GitContext} from './git-context.ts';
import type {AutoScope} from './limits.ts';
export type SessionIdentity=NativeIdentity&{provider:'claude'|'codex'|'grok';status?:'online'|'offline'|'unknown';reason?:'process_exited'|'generation_changed'|'unsupported_version'|'unreachable'};
export type ThreadRow={id:string;cwd:string;archived:number;updated_at_ms:number};
export const THREADS_SQL='SELECT id, cwd, archived, updated_at_ms FROM threads WHERE archived=0';
export type ScanOptions=CompatibilityOptions&{includeUnavailable?:boolean;processStart?:(pid:number)=>Promise<number|null>;expectedPairCaller?:string;include?:(n:{provider:'claude'|'codex'|'grok';nativeId:string;generation:string;cwd:string})=>Promise<boolean>;home?:string;claude?:ClaudeInspection;version?:()=>Promise<string|null>;rows?:()=>Promise<ThreadRow[]|null>;openUrl?:(url:string)=>Promise<void>;reachable?:()=>Promise<boolean>;wakeAttempts?:number;wakeIntervalMs?:number;owner?:(id:string)=>Promise<string|null>;git?:(cwd:string)=>Promise<GitContext>;worktreeList?:(cwd:string)=>Promise<string>;grok?:import('./adapters/grok.ts').GrokOptions};
export async function readThreadRows(home=homedir()):Promise<ThreadRow[]|null>{
 let db:DatabaseSync|undefined;
 try{db=new DatabaseSync(join(home,'.codex','state_5.sqlite'),{readOnly:true});return db.prepare(THREADS_SQL).all().filter((r):r is ThreadRow=>typeof r.id==='string'&&typeof r.cwd==='string'&&r.archived===0&&typeof r.updated_at_ms==='number').map(r=>({...r})) as ThreadRow[];}
 catch{return null;}finally{db?.close();}
}
export async function inScope(cwd:string,callerCwd:string,scope:AutoScope,git:NonNullable<ScanOptions['git']>=observeGit):Promise<boolean>{
 if(scope==='any')return true;
 const [a,b]=await Promise.all([git(callerCwd),git(cwd)]);
 if(a.state==='unknown'||b.state==='unknown')return false;
 // current_work is the caller's project folder: the same folder or one inside it, not the whole git worktree or a parent.
 if(scope==='current_work')return a.workspace!==null&&b.workspace!==null&&(a.workspace===b.workspace||b.workspace.startsWith(a.workspace+'/'));
 if(a.state==='git'&&b.state==='git')return a.repository===b.repository;
 return a.state==='no_git'&&b.state==='no_git'&&a.workspace===b.workspace;
}
export async function codexIdentity(id:string,options:ScanOptions={}):Promise<SessionIdentity|null>{
 const home=options.home??homedir(),version=await (options.version??desktopVersion)();
 if(!isVersionAllowed('codex',version,options))return null;
 const row=(await (options.rows??(()=>readThreadRows(home)))())?.find(r=>r.id===id&&r.archived===0);if(!row)return null;
 const owner=await (options.owner??((id:string)=>findCodexOwner(id,home,8000,options.version,options)))(id);if(!owner)return null;
 try{return {version:version||null,provider:'codex',nativeId:id,generation:owner,owner,cwd:await realpath(row.cwd),socket:join(home,'.codex','ipc','ipc.sock')};}catch{return null;}
}
const run=promisify(execFile);
// Opening codex://threads/<id> makes Desktop load the thread, the same as clicking it (Desktop comes to the front, 2026-10-07).
// Only for one thread a caller named or is sending to; never from a listing.
export async function wakeCodexThread(id:string,options:ScanOptions={}):Promise<string|null>{
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))return null;
 const home=options.home??homedir();
 if(!(await (options.rows??(()=>readThreadRows(home)))())?.some(r=>r.id===id&&r.archived===0))return null;
 if(!await (options.reachable??(()=>codexReachable(home,options.version,options)))())return null;
 await (options.openUrl??(async url=>{await run('open',['-g',url]);}))(`codex://threads/${id}`);
 // A thread just opened by link is one lookup, so it keeps the wider 1.5s limit; the scan's limit is for a hundred unloaded threads.
 const owner=options.owner??((id:string)=>findCodexOwner(id,home,1500,options.version,options));
 for(let i=0;i<(options.wakeAttempts??5);i++){const found=await owner(id);if(found)return found;await new Promise(r=>setTimeout(r,options.wakeIntervalMs??1000));}
 return null;
}
// Worktree roots the scope can match: the caller's own worktree, or every worktree of its repository. null = no path filter.
export async function scopeRoots(callerCwd:string,scope:AutoScope,options:ScanOptions={}):Promise<string[]|null>{
 if(scope==='any')return null;
 const caller=await (options.git??observeGit)(callerCwd);
 if(caller.state==='no_git')return [caller.workspace];
 if(caller.state!=='git')return [];
 if(scope==='current_work')return [caller.workspace];
 try{
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_')));
  const stdout=options.worktreeList?await options.worktreeList(caller.worktree):(await run('git',['--no-optional-locks','-C',caller.worktree,'worktree','list','--porcelain'],{env,timeout:5000,maxBuffer:1024*1024})).stdout;
  const roots=stdout.split('\n').filter(l=>l.startsWith('worktree ')).map(l=>l.slice(9));
  return roots.length?roots:[caller.worktree];
 }catch{return [caller.worktree];}
}
// Running Grok CLI conversations come from Grok's own ledger, checked against the live process (see adapters/grok.ts).
// Stopped TUI conversations (no session_kind in the summary) are listed only when unavailable sessions are included;
// headless and subagent conversations are never listed. A ledger that cannot be read safely lists no Grok conversation.
async function scanGrok(home:string,scope:AutoScope,within:(cwd:string)=>Promise<boolean>,options:ScanOptions):Promise<SessionIdentity[]>{
 const g=await import('./adapters/grok.ts'),gopts={...options,...options.grok,home};
 const rows=await g.readGrokLedger(home);if(!rows)return [];
 const version=await (gopts.grokVersion??(()=>g.grokVersion(home)))();
 const supported=isVersionAllowed('grok',version,options);
 if(!supported&&!options.includeUnavailable)return [];
 const out:SessionIdentity[]=[],inLedger=new Set<string>();
 const groups=new Map<string,typeof rows>();for(const r of rows)groups.set(r.session_id,[...(groups.get(r.session_id)??[]),r]);
 for(const [id,group] of groups){
  inLedger.add(id);
  const alive=[];for(const r of group)if(await g.grokRowAlive(r,gopts))alive.push(r);
  const r=alive[0]??group.at(-1)!;let cwd:string;try{cwd=await realpath(r.cwd);}catch{continue;}
  if(!await within(cwd))continue;
  const n:SessionIdentity={version:version||null,provider:'grok',nativeId:id,generation:g.grokGeneration(r),cwd,socket:'',pid:r.pid};
  if(alive.length===1&&!supported){n.status='unknown';n.reason='unsupported_version';}
  // Two live processes on one conversation: neither is the conversation the caller saw, so none is a destination.
  else if(alive.length>1){n.status='unknown';n.reason='unreachable';n.generation='';}
  else if(!alive.length){if(!options.includeUnavailable)continue;n.status='offline';n.reason='process_exited';}
  if(options.include&&!await options.include(n))continue;
  out.push(n);
 }
 if(!options.includeUnavailable)return out;
 const stopped:(SessionIdentity&{lastActive:number})[]=[];
 for(const {cwd:named,dir} of await g.grokSessionDirs(home)){
  let cwd:string;try{cwd=await realpath(named);}catch{continue;}
  if(!await within(cwd))continue;
  let ids:string[]=[];try{ids=await readdir(dir);}catch{continue;}
  for(const id of ids){
   if(inLedger.has(id))continue;
   const s=await g.grokSummary(dir,id);if(!s||s.kind!==null)continue;
   const n={version:version||null,provider:'grok' as const,nativeId:id,generation:'none',cwd,socket:'',status:'offline' as const,reason:'process_exited' as const,lastActive:s.lastActive};
   if(options.include&&!await options.include(n))continue;
   stopped.push(n);
  }
 }
 stopped.sort((a,b)=>b.lastActive-a.lastActive);
 return [...out,...(scope==='any'?stopped.slice(0,50):stopped).map(({lastActive,...n})=>n)];
}
export async function scanSessions(callerCwd:string,scope:AutoScope='current_work',options:ScanOptions={}):Promise<{sessions:SessionIdentity[];codexWorkspace:'observed'|'unknown';codexTruncated?:number}>{
 const home=options.home??homedir(),sessions:SessionIdentity[]=[];
 // One git observation per distinct workspace; Codex can hold thousands of threads in few workspaces.
 const gitCache=new Map<string,Promise<GitContext>>(),baseGit=options.git??observeGit;
 const git=(cwd:string)=>{let v=gitCache.get(cwd);if(!v){v=baseGit(cwd);gitCache.set(cwd,v);}return v;};
 // Cheap path filter first: a candidate must sit inside one of the caller's worktrees. Only survivors are checked with git.
 const roots=await scopeRoots(callerCwd,scope,{...options,git});
 const scoped=new Map<string,Promise<boolean>>();
 const within=(cwd:string)=>{let v=scoped.get(cwd);if(!v){v=(async()=>{if(roots){let real:string;try{real=await realpath(cwd);}catch{return false;}if(!roots.some(r=>real===r||real.startsWith(r+'/')))return false;}return inScope(cwd,callerCwd,scope,git);})();scoped.set(cwd,v);}return v;};
 let names:string[]=[];try{names=await readdir(join(home,'.claude','sessions'));}catch{}
 // Each Claude process is inspected with ps and lsof; the records are checked in parallel and kept in directory order.
 const claudeCandidate=async(name:string):Promise<SessionIdentity|null>=>{if(!/^\d+\.json$/.test(name))return null;const n=await findClaudeIdentityByPid(Number(name.slice(0,-5)),home,{...options,...options.claude});if(n&&await within(n.cwd)&&(!options.include||await options.include({...n,provider:'claude'})))return {...n,provider:'claude'};if(!n&&options.includeUnavailable){try{const {privateJson}=await import('./request-store.ts');const raw=await privateJson(join(home,'.claude','sessions',name));if(typeof raw?.sessionId!=='string')return null;const {findClaudeSession}=await import('./adapters/claude.ts');const record=await findClaudeSession(raw.sessionId,{home});if(!record||record==='unreadable'||!await within(record.cwd))return null;const candidate:SessionIdentity={version:record.version==='unknown'?null:record.version||null,provider:'claude',nativeId:record.sessionId,generation:record.generation,cwd:record.cwd,socket:record.messagingSocketPath??'',status:'unknown',reason:'unreachable'};if(!isVersionAllowed('claude-code',record.version,{...options,...options.claude})){candidate.reason='unsupported_version';}else{const {processStart}=await import('./adapters/claude.ts');const started=await (options.processStart??processStart)(record.pid);if(started===null){candidate.status='offline';candidate.reason='process_exited';}else if(Math.abs(started-record.startedAt)>=2000){candidate.status='offline';candidate.reason='process_exited';}}if(!options.include||await options.include(candidate))return candidate;}catch{}}return null;};
 for(const n of await Promise.all(names.map(claudeCandidate)))if(n)sessions.push(n);
 if(!options.expectedPairCaller)sessions.push(...await scanGrok(home,scope,within,options));
 const version=await (options.version??desktopVersion)();
 const supported=isVersionAllowed('codex',version,options);
 if(!supported&&!options.includeUnavailable)return {sessions,codexWorkspace:'unknown'};
 const rows=await (options.rows??(()=>readThreadRows(home)))();if(!rows)return {sessions,codexWorkspace:'unknown'};
 const candidates:ThreadRow[]=[];
 // The scope check runs one git observation per distinct workspace; rows are checked in parallel and kept in order.
 const inRange=await Promise.all(rows.map(async r=>r.archived===0&&await within(r.cwd)&&(!options.include||await options.include({provider:'codex',nativeId:r.id,generation:'',cwd:await realpath(r.cwd).catch(()=>r.cwd)}))));
 for(const [i,r] of rows.entries())if(inRange[i])candidates.push(r);
 if(options.expectedPairCaller){const keys=[...sessions.map(n=>`${n.provider}:${n.nativeId}`),...candidates.map(n=>`codex:${n.id}`)];if(keys.length!==2||!keys.includes(options.expectedPairCaller))return {sessions:[],codexWorkspace:'unknown'};}
 candidates.sort((a,b)=>b.updated_at_ms-a.updated_at_ms);
 // Owner lookups share one Desktop connection and run in wide parallel waves: a thread Desktop has not loaded is
 // answered only after Desktop's own 10s wait, so each lookup costs the full limit and only the wave count matters
 // (measured 2026-10-07: 101 threads in waves of 16 at 1.5s took 10.5s; one wave of 120 took one limit).
 const shared=options.owner||!supported?undefined:createCodexOwnerLookup(home,options.version,options);
 const owner=options.owner??((id:string)=>shared!.owner(id)),list=scope==='any'?candidates.slice(0,50):candidates;
 try{
  for(let i=0;i<list.length;i+=128){
   const wave=await Promise.all(list.slice(i,i+128).map(async r=>({r,owner:supported?await owner(r.id):null})));
   for(const {r,owner} of wave){if(!owner&&!options.includeUnavailable)continue;try{sessions.push({version:version||null,provider:'codex',nativeId:r.id,generation:owner??'',...(owner?{owner}:{status:'unknown' as const,reason:supported?'unreachable' as const:'unsupported_version' as const}),cwd:await realpath(r.cwd),socket:join(home,'.codex','ipc','ipc.sock')});}catch{}}
  }
 }finally{await shared?.close();}
 return {sessions,codexWorkspace:supported?'observed':'unknown',...(candidates.length>list.length?{codexTruncated:candidates.length-list.length}:{})};
}
