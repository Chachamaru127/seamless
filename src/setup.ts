import {constants} from 'node:fs';
import {access, lstat, mkdir, open, readdir, readFile, rename, stat, unlink, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {delimiter, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// `setup` has one write: the MCP registration in Claude Code's own user file (`~/.claude.json`). Everything else it reports
// is read-only observation. A settings file is copied under ~/.seamless/backups before it is changed, so a person can put
// the old file back (H3). No Keychain value is read and nothing leaves this Mac.
export type SetupProduct='claude-code'|'codex'|'opencode'|'cursor'|'antigravity'|'grok'|'grok-bot';
export type DetectedAgent={product:SetupProduct;installed:boolean;version:string|null;sessions:number};
export type SetupDestination={id:string;product:'claude-code';workspace:string;state:'online'|'unreachable';reason?:string};
export type SetupChangeAction='added'|'updated'|'unchanged'|'would_add'|'would_update';
export type SetupChange={file:string;kind:'mcp_registration';name:'seamless';action:SetupChangeAction};
export type SetupResult={
 status:'ok'|'config_unusable'|'write_failed';
 dryRun:boolean;
 file:string;
 agents:DetectedAgent[];
 destinations:SetupDestination[];
 changes:SetupChange[];
 backup:string|null;
};
export type SetupOptions={home?:string;dryRun?:boolean;now?:()=>number;env?:NodeJS.ProcessEnv;nodePath?:string;cliPath?:string};
export type McpRegistration={type:'stdio';command:string;args:string[]};
export type ClaudeSessionRecord={sessionId:string;cwd:string;version:string|null;messagingSocketPath:string|null;status:string|null};

const MAX_SETTINGS_BYTES=4*1024*1024,MAX_SESSION_BYTES=65536;
const code=(error:unknown)=>(error as NodeJS.ErrnoException)?.code;

function defaultCliPath():string{
 const here=fileURLToPath(import.meta.url);
 return join(dirname(here),here.endsWith('.ts')?'cli.ts':'cli.js');
}
// The MCP server is this repository's own `mcp` entry, run by the same Node that ran setup. A path is used rather than a
// package name because v1 is installed from a checkout (H5 decides the published name later).
export function mcpRegistration(nodePath=process.execPath,cliPath=defaultCliPath()):McpRegistration{
 return {type:'stdio',command:nodePath,args:[cliPath,'mcp']};
}
async function exists(path:string):Promise<boolean>{
 try{await stat(path);return true;}catch{return false;}
}
export async function findOnPath(name:string,env:NodeJS.ProcessEnv=process.env):Promise<string|null>{
 const path=env.PATH;
 if(typeof path!=='string')return null;
 for(const dir of path.split(delimiter)){
  if(!dir)continue;
  const file=join(dir,name);
  try{await access(file,constants.X_OK);const s=await stat(file);if(s.isFile())return file;}catch{}
 }
 return null;
}
export function antigravityPlatform(arch:string=process.arch):string{return `darwin-${arch}`;}
// T3 Code keeps the Antigravity ACP build outside PATH: active.json names the release, and that release's
// .install-complete.json names the executable. Both are read as data; nothing is started.
export async function findT3Antigravity(home:string):Promise<{binary:string|null;version:string|null}>{
 const root=join(home,'.t3-ja','tools','antigravity-acp',antigravityPlatform());
 let release:string|undefined;
 try{
  const active:unknown=JSON.parse(await readFile(join(root,'active.json'),'utf8'));
  const id=(active as {releaseId?:unknown})?.releaseId;
  if(typeof id==='string'&&/^[a-z0-9]{8,128}$/i.test(id))release=id;
 }catch{}
 const releases:string[]=[];
 if(release)releases.push(release);
 else{
  try{releases.push(...(await readdir(join(root,'versions'))).filter(n=>/^[a-z0-9]{8,128}$/i.test(n)).sort().reverse());}catch{}
 }
 for(const id of releases){
  const dir=join(root,'versions',id);
  let install:unknown;
  try{install=JSON.parse(await readFile(join(dir,'.install-complete.json'),'utf8'));}catch{continue;}
  const name=(install as {executable?:{name?:unknown}})?.executable?.name;
  if(typeof name!=='string'||!/^[A-Za-z0-9._-]+$/.test(name))continue;
  const file=join(dir,name);
  try{await access(file,constants.X_OK);const version=(install as {version?:unknown}).version;return {binary:file,version:typeof version==='string'?version:null};}catch{}
 }
 return {binary:null,version:null};
}
export async function findAntigravity(home:string,env:NodeJS.ProcessEnv=process.env):Promise<{binary:string|null;version:string|null}>{
 const onPath=await findOnPath('antigravity',env);
 if(onPath)return {binary:onPath,version:null};
 return findT3Antigravity(home);
}
// Every sessions/<pid>.json that names a session and a workspace. A record that cannot be read is skipped, not guessed at.
export async function readClaudeSessionRecords(home:string):Promise<ClaudeSessionRecord[]>{
 let names:string[];
 try{names=await readdir(join(home,'.claude','sessions'));}catch{return [];}
 const found=new Map<string,ClaudeSessionRecord>();
 for(const name of names.filter(n=>/^\d+\.json$/.test(n)).sort()){
  try{
   const file=join(home,'.claude','sessions',name),s=await lstat(file);
   if(!s.isFile()||s.isSymbolicLink()||s.size>MAX_SESSION_BYTES)continue;
   const raw:unknown=JSON.parse(await readFile(file,'utf8'));
   const r=raw as Record<string,unknown>;
   if(typeof r.sessionId!=='string'||typeof r.cwd!=='string')continue;
   found.set(r.sessionId,{
    sessionId:r.sessionId,
    cwd:r.cwd,
    version:typeof r.version==='string'?r.version:null,
    messagingSocketPath:typeof r.messagingSocketPath==='string'?r.messagingSocketPath:null,
    status:typeof r.status==='string'?r.status:null,
   });
  }catch{}
 }
 return [...found.values()].sort((a,b)=>a.sessionId.localeCompare(b.sessionId));
}
// The list AC1 shows: which v1 products are on this Mac, and which Claude conversations currently name an inbox socket.
export async function detectAgents(home:string,env:NodeJS.ProcessEnv=process.env):Promise<{agents:DetectedAgent[];destinations:SetupDestination[]}>{
 const [claudeSessions,claudeBin,codexBin,opencodeBin,cursorBin,grokBin,antigravity,peers]=await Promise.all([
  readClaudeSessionRecords(home),
  findOnPath('claude',env),
  findOnPath('codex',env),
  findOnPath('opencode',env),
  findOnPath('cursor',env),
  findOnPath('grok',env),
  findAntigravity(home,env),
  exists(join(home,'.seamless','peers.json')),
 ]);
 const destinations:SetupDestination[]=[];
 for(const r of claudeSessions){
  destinations.push({id:`claude:${r.sessionId}`,product:'claude-code',workspace:r.cwd,state:r.messagingSocketPath?'online':'unreachable',...(r.messagingSocketPath?{}:{reason:'no_inbox_socket'})});
 }
 const claudeVersion=claudeSessions.find(r=>r.version)?.version??null;
 const agents:DetectedAgent[]=[
  {product:'claude-code',installed:!!claudeBin||await exists(join(home,'.claude'))||await exists(join(home,'.claude.json')),version:claudeVersion,sessions:claudeSessions.length},
  {product:'codex',installed:!!codexBin||await exists(join(home,'.codex')),version:null,sessions:0},
  {product:'opencode',installed:!!opencodeBin||await exists(join(home,'.config','opencode'))||await exists(join(home,'.opencode')),version:null,sessions:0},
  {product:'cursor',installed:!!cursorBin||await exists(join(home,'.cursor')),version:null,sessions:0},
  {product:'antigravity',installed:!!antigravity.binary||await exists(join(home,'.gemini','antigravity-cli')),version:antigravity.version,sessions:0},
  {product:'grok',installed:!!grokBin||await exists(join(home,'.grok')),version:null,sessions:0},
  {product:'grok-bot',installed:peers,version:null,sessions:0},
 ];
 return {agents,destinations};
}
type SettingsRead={status:'absent'}|{status:'ok';value:Record<string,unknown>;mode:number;bytes:Buffer}|{status:'unusable'};
async function readSettings(file:string):Promise<SettingsRead>{
 let before;
 try{before=await lstat(file);}catch(error){return code(error)==='ENOENT'?{status:'absent'}:{status:'unusable'};}
 if(!before.isFile()||before.isSymbolicLink()||before.uid!==process.getuid?.()||before.size>MAX_SETTINGS_BYTES)return {status:'unusable'};
 try{
  const bytes=await readFile(file),value:unknown=JSON.parse(bytes.toString('utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))return {status:'unusable'};
  return {status:'ok',value:value as Record<string,unknown>,mode:before.mode&0o777,bytes};
 }catch{return {status:'unusable'};}
}
async function writeBackup(home:string,bytes:Buffer,at:number):Promise<string>{
 const dir=join(home,'.seamless','backups');
 await mkdir(dir,{recursive:true,mode:0o700});
 const stamp=new Date(at).toISOString().replace(/[:.]/g,'-');
 for(let i=0;i<1000;i++){
  const file=join(dir,`${stamp}-claude.json${i?`-${i}`:''}`);
  try{await writeFile(file,bytes,{mode:0o600,flag:'wx'});return file;}
  catch(error){if(code(error)!=='EEXIST')throw error;}
 }
 throw new Error('backup_unavailable');
}
async function writeSettings(file:string,text:string):Promise<void>{
 const temp=join(dirname(file),`.${randomUUID()}.claude.json.tmp`);
 let handle:Awaited<ReturnType<typeof open>>|undefined;
 try{
  handle=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  await handle.writeFile(text);
  await handle.sync();
 }finally{await handle?.close();}
 try{await rename(temp,file);}catch(error){await unlink(temp).catch(()=>{});throw error;}
}
function sameRegistration(value:unknown,entry:McpRegistration):boolean{
 const v=value as {command?:unknown;args?:unknown};
 return !!v&&typeof v==='object'&&v.command===entry.command&&Array.isArray(v.args)&&v.args.length===entry.args.length&&v.args.every((a,i)=>a===entry.args[i]);
}
export async function runSetup(options:SetupOptions={}):Promise<SetupResult>{
 const home=options.home??homedir(),dryRun=options.dryRun===true,env=options.env??process.env,now=options.now??Date.now;
 const {agents,destinations}=await detectAgents(home,env);
 const file=join(home,'.claude.json'),entry=mcpRegistration(options.nodePath??process.execPath,options.cliPath??defaultCliPath());
 const base={dryRun,file,agents,destinations};
 const before=await readSettings(file);
 if(before.status==='unusable')return {status:'config_unusable',...base,changes:[],backup:null};
 const current=before.status==='ok'?before.value:{};
 const servers=current.mcpServers;
 if(servers!==undefined&&(!servers||typeof servers!=='object'||Array.isArray(servers)))return {status:'config_unusable',...base,changes:[],backup:null};
 const existing=(servers as Record<string,unknown>|undefined)?.seamless;
 const action:SetupChangeAction=sameRegistration(existing,entry)?'unchanged':existing===undefined?(dryRun?'would_add':'added'):(dryRun?'would_update':'updated');
 const change:SetupChange={file,kind:'mcp_registration',name:'seamless',action};
 if(action==='unchanged')return {status:'ok',...base,changes:[change],backup:null};
 if(dryRun)return {status:'ok',...base,changes:[change],backup:null};
 let backup:string|null=null;
 try{
  if(before.status==='ok')backup=await writeBackup(home,before.bytes,now());
  const next={...current,mcpServers:{...(servers as Record<string,unknown>|undefined??{}),seamless:entry}};
  await writeSettings(file,JSON.stringify(next,null,2)+'\n');
 }catch{return {status:'write_failed',...base,changes:[change],backup};}
 return {status:'ok',...base,changes:[change],backup};
}
