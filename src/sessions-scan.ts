import {isVersionAllowed,type CompatibilityOptions} from './compat.ts';
import {readdir,realpath} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {desktopVersion} from './adapters/codex.ts';
import {findClaudeIdentityByPid,findCodexOwner,type NativeIdentity,type ClaudeInspection} from './native-runtime.ts';
import {observeGit,type GitContext} from './git-context.ts';
import type {AutoScope} from './limits.ts';
export type SessionIdentity=NativeIdentity&{provider:'claude'|'codex';status?:'online'|'offline'|'unknown';reason?:'process_exited'|'generation_changed'|'unsupported_version'|'unreachable'};
export type ThreadRow={id:string;cwd:string;archived:number;updated_at_ms:number};
export const THREADS_SQL='SELECT id, cwd, archived, updated_at_ms FROM threads WHERE archived=0';
export type ScanOptions=CompatibilityOptions&{includeUnavailable?:boolean;processStart?:(pid:number)=>Promise<number|null>;expectedPairCaller?:string;include?:(n:{provider:'claude'|'codex';nativeId:string;generation:string;cwd:string})=>Promise<boolean>;home?:string;claude?:ClaudeInspection;version?:()=>Promise<string|null>;rows?:()=>Promise<ThreadRow[]|null>;owner?:(id:string)=>Promise<string|null>;git?:(cwd:string)=>Promise<GitContext>;worktreeList?:(cwd:string)=>Promise<string>};
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
 for(const name of names){if(!/^\d+\.json$/.test(name))continue;const n=await findClaudeIdentityByPid(Number(name.slice(0,-5)),home,{...options,...options.claude});if(n&&await within(n.cwd)&&(!options.include||await options.include({...n,provider:'claude'})))sessions.push({...n,provider:'claude'});else if(!n&&options.includeUnavailable){try{const {privateJson}=await import('./request-store.ts');const raw=await privateJson(join(home,'.claude','sessions',name));if(typeof raw?.sessionId!=='string')continue;const {findClaudeSession}=await import('./adapters/claude.ts');const record=await findClaudeSession(raw.sessionId,{home});if(!record||record==='unreadable'||!await within(record.cwd))continue;const candidate:SessionIdentity={version:record.version==='unknown'?null:record.version||null,provider:'claude',nativeId:record.sessionId,generation:record.generation,cwd:record.cwd,socket:record.messagingSocketPath??'',status:'unknown',reason:'unreachable'};if(!isVersionAllowed('claude-code',record.version,{...options,...options.claude})){candidate.reason='unsupported_version';}else{const {processStart}=await import('./adapters/claude.ts');const started=await (options.processStart??processStart)(record.pid);if(started===null){candidate.status='offline';candidate.reason='process_exited';}else if(Math.abs(started-record.startedAt)>=2000){candidate.status='offline';candidate.reason='process_exited';}}if(!options.include||await options.include(candidate))sessions.push(candidate);}catch{}}}
 const version=await (options.version??desktopVersion)();
 const supported=isVersionAllowed('codex',version,options);
 if(!supported&&!options.includeUnavailable)return {sessions,codexWorkspace:'unknown'};
 const rows=await (options.rows??(()=>readThreadRows(home)))();if(!rows)return {sessions,codexWorkspace:'unknown'};
 const candidates:ThreadRow[]=[];
 for(const r of rows){if(r.archived===0&&await within(r.cwd)&&(!options.include||await options.include({provider:'codex',nativeId:r.id,generation:'',cwd:await realpath(r.cwd).catch(()=>r.cwd)})))candidates.push(r);}
 if(options.expectedPairCaller){const keys=[...sessions.map(n=>`${n.provider}:${n.nativeId}`),...candidates.map(n=>`codex:${n.id}`)];if(keys.length!==2||!keys.includes(options.expectedPairCaller))return {sessions:[],codexWorkspace:'unknown'};}
 candidates.sort((a,b)=>b.updated_at_ms-a.updated_at_ms);
 // Owner lookups run in small parallel waves; a thread not loaded in Desktop simply has no owner.
 const owner=options.owner??((id:string)=>findCodexOwner(id,home,1500,options.version,options)),list=scope==='any'?candidates.slice(0,50):candidates;
 for(let i=0;i<list.length;i+=16){
  const wave=await Promise.all(list.slice(i,i+16).map(async r=>({r,owner:supported?await owner(r.id):null})));
  for(const {r,owner} of wave){if(!owner&&!options.includeUnavailable)continue;try{sessions.push({version:version||null,provider:'codex',nativeId:r.id,generation:owner??'',...(owner?{owner}:{status:'unknown' as const,reason:supported?'unreachable' as const:'unsupported_version' as const}),cwd:await realpath(r.cwd),socket:join(home,'.codex','ipc','ipc.sock')});}catch{}}
 }
 return {sessions,codexWorkspace:supported?'observed':'unknown',...(candidates.length>list.length?{codexTruncated:candidates.length-list.length}:{})};
}
