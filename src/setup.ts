import {constants} from 'node:fs';
import {access, lstat, mkdir, open, readdir, readFile, rename, stat, unlink, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {basename, delimiter, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// `setup` writes the MCP registration in Claude Code's own user file (`~/.claude.json`) and the product-side wiring for
// opencode, Cursor, Antigravity and Grok CLI. Everything else it reports is read-only observation. A settings file is
// copied under ~/.seamless/backups before it is changed, so a person can put the old file back (H3). No Keychain value
// is read and nothing leaves this Mac.
export type SetupProduct='claude-code'|'codex'|'opencode'|'cursor'|'antigravity'|'grok'|'grok-bot';
export type DetectedAgent={product:SetupProduct;installed:boolean;version:string|null;sessions:number};
export type SetupDestination={id:string;product:'claude-code';workspace:string;state:'online'|'unreachable';reason?:string};
export type SetupChangeKind='mcp_registration'|'plugin'|'hooks';
export type SetupChangeAction='added'|'updated'|'unchanged'|'would_add'|'would_update'|'removed'|'would_remove'|'skipped';
export type SetupChange={file:string;kind:SetupChangeKind;name:'seamless';action:SetupChangeAction;product?:SetupProduct;reason?:string};
export type SetupResult={
 status:'ok'|'config_unusable'|'write_failed';
 dryRun:boolean;
 file:string;
 agents:DetectedAgent[];
 destinations:SetupDestination[];
 changes:SetupChange[];
 backup:string|null;
 backups:string[];
};
export type SetupOptions={home?:string;dryRun?:boolean;remove?:boolean;root?:string;now?:()=>number;env?:NodeJS.ProcessEnv;nodePath?:string;cliPath?:string};
export type McpRegistration={type:'stdio';command:string;args:string[]};
export type ClaudeSessionRecord={sessionId:string;cwd:string;version:string|null;messagingSocketPath:string|null;status:string|null};

const MAX_SETTINGS_BYTES=4*1024*1024,MAX_SESSION_BYTES=65536;
const code=(error:unknown)=>(error as NodeJS.ErrnoException)?.code;

function defaultCliPath():string{
 const here=fileURLToPath(import.meta.url);
 return join(dirname(here),here.endsWith('.ts')?'cli.ts':'cli.js');
}
// The repository root is where the hook scripts and the opencode plugin live. setup is `src/setup.ts`, so one level up.
function defaultRootPath():string{return fileURLToPath(new URL('..',import.meta.url));}
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
type RawRead={status:'absent'}|{status:'ok';bytes:Buffer}|{status:'unusable'};
// A TOML file is not JSON: it gets the same owner/size/symlink checks and its bytes, without a parse that would refuse it.
async function readRaw(file:string):Promise<RawRead>{
 let before;
 try{before=await lstat(file);}catch(error){return code(error)==='ENOENT'?{status:'absent'}:{status:'unusable'};}
 if(!before.isFile()||before.isSymbolicLink()||before.uid!==process.getuid?.()||before.size>MAX_SETTINGS_BYTES)return {status:'unusable'};
 try{return {status:'ok',bytes:await readFile(file)};}catch{return {status:'unusable'};}
}
// The backup keeps the old bytes under a name a person can find next to the other backups: `.claude.json` becomes
// `claude.json`, and every product file keeps its own base name so a restore is not ambiguous.
function backupBase(file:string):string{
 const name=basename(file);
 return name.startsWith('.')?name.slice(1):name;
}
async function writeBackup(home:string,bytes:Buffer,at:number,name:string):Promise<string>{
 const dir=join(home,'.seamless','backups');
 await mkdir(dir,{recursive:true,mode:0o700});
 const stamp=new Date(at).toISOString().replace(/[:.]/g,'-');
 for(let i=0;i<1000;i++){
  const file=join(dir,`${stamp}-${name}${i?`-${i}`:''}`);
  try{await writeFile(file,bytes,{mode:0o600,flag:'wx'});return file;}
  catch(error){if(code(error)!=='EEXIST')throw error;}
 }
 throw new Error('backup_unavailable');
}
async function writeSettings(file:string,text:string):Promise<void>{
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 const temp=join(dirname(file),`.${randomUUID()}.${basename(file)}.tmp`);
 let handle:Awaited<ReturnType<typeof open>>|undefined;
 try{
  handle=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  await handle.writeFile(text);
  await handle.sync();
 }finally{await handle?.close();}
 try{await rename(temp,file);}catch(error){await unlink(temp).catch(()=>{});throw error;}
}
function sameRegistration(value:unknown,entry:McpRegistration):boolean{
 // The type decides how the command is launched: the same command and args under another type is a different server.
 const v=value as {type?:unknown;command?:unknown;args?:unknown};
 return !!v&&typeof v==='object'&&v.type===entry.type&&v.command===entry.command&&Array.isArray(v.args)&&v.args.length===entry.args.length&&v.args.every((a,i)=>a===entry.args[i]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Product wiring
//
// The file, the relative entry and the hook event names come from each manifest's install steps. A plan is only carried
// out for a product that is present on this Mac, so an empty home stays untouched (T06). Antigravity additionally needs
// its executable: without it the phase 2 product cannot run the hook (issue #38).
// ---------------------------------------------------------------------------------------------------------------------
const CURSOR_HOOK_SUFFIX='/hooks/cursor/seamless-hook.sh';
const ANTIGRAVITY_HOOK_SUFFIX='/hooks/antigravity/seamless-hook.sh';
const GROK_HOOK_SUFFIX='/hooks/grok-cli/seamless-hook.sh';
const OPENCODE_PLUGIN_SUFFIX='/packages/opencode-plugin/index.ts';
const OPENCODE_DIR_SUFFIX='/packages/opencode-plugin';

type WiringKind='plugin_json'|'cursor_hooks_json'|'gemini_hooks_json'|'grok_toml';
type WiringProduct='opencode'|'cursor'|'antigravity'|'grok';
type WiringPlan={product:WiringProduct;kind:WiringKind;changeKind:'plugin'|'hooks';file:string;entry:string;events:string[]};
type InstallStep={entry:string;events:string[];file:string};

function isRecord(value:unknown):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value);
}
// `add <entry> to <file>` (opencode) and `add <hook> to <events> in <file>` (hooks products).
function parseInstallStep(step:string):InstallStep|null{
 const match=/^add (\S+) to (.+)$/.exec(step);
 if(!match)return null;
 const entry=match[1],rest=match[2],at=rest.indexOf(' in ');
 if(at<0)return {entry,events:[],file:rest};
 const events=rest.slice(0,at).split(/,| and /).map(name=>name.trim()).filter(Boolean);
 if(!events.length)return null;
 return {entry,events,file:rest.slice(at+4)};
}
function wiringKind(file:string):WiringKind|null{
 if(file.endsWith('/opencode.json'))return 'plugin_json';
 if(file.endsWith('/hooks.json'))return 'cursor_hooks_json';
 if(file.endsWith('/settings.json')&&file.includes('antigravity'))return 'gemini_hooks_json';
 if(file.endsWith('.toml'))return 'grok_toml';
 return null;
}
function homePath(home:string,file:string):string|null{
 if(!file.startsWith('~/'))return null;
 const parts=file.slice(2).split('/');
 if(!parts.length||parts.some(part=>!part||part==='.'||part==='..'))return null;
 return join(home,...parts);
}
function repoPath(root:string,entry:string):string|null{
 if(entry.startsWith('/')||entry.startsWith('~/'))return null;
 const parts=entry.split('/');
 if(parts.some(part=>!part||part==='.'||part==='..'))return null;
 return join(root,...parts);
}
// The Antigravity manifest is pinned to phase 2 (install.hook must be null, one step) and cannot name a hook file yet.
// The path is therefore kept here until S5 gives the adapter a send port; the settings file is still the manifest's.
const ANTIGRAVITY_FALLBACK:InstallStep={entry:'hooks/antigravity/seamless-hook.sh',events:['BeforeAgent'],file:'~/.gemini/antigravity-cli/settings.json'};
async function loadWiringPlans(home:string,root:string):Promise<WiringPlan[]>{
 const manifests=[
  ['opencode','opencode.json'],
  ['cursor','cursor.json'],
  ['grok','grok-cli.json'],
  ['antigravity','antigravity.json'],
 ] as const;
 const plans:WiringPlan[]=[];
 for(const [product,name] of manifests){
  let manifest:unknown;
  try{manifest=JSON.parse(await readFile(join(root,'src','manifests',name),'utf8'));}catch{continue;}
  const install=isRecord(manifest)?manifest.install:undefined;
  const steps=isRecord(install)&&Array.isArray(install.steps)?install.steps:[];
  const step=steps.find((item):item is string=>typeof item==='string'&&item.startsWith('add '));
  let parsed=step?parseInstallStep(step):null;
  if(!parsed&&product==='antigravity')parsed=ANTIGRAVITY_FALLBACK;
  if(!parsed)continue;
  const kind=wiringKind(parsed.file),file=homePath(home,parsed.file),entry=repoPath(root,parsed.entry);
  if(!kind||!file||!entry)continue;
  plans.push({product,kind,changeKind:kind==='plugin_json'?'plugin':'hooks',file,entry,events:parsed.events});
 }
 return plans;
}
function hookCommand(value:unknown):string|null{
 if(typeof value==='string')return value;
 if(isRecord(value)&&typeof value.command==='string')return value.command;
 return null;
}
function matchesEntry(command:string,abs:string,suffix:string,dirSuffix?:string):boolean{
 const relative=suffix.startsWith('/')?suffix.slice(1):suffix;
 const relativeDir=dirSuffix?.startsWith('/')?dirSuffix.slice(1):dirSuffix;
 return command===abs||command===relative||command.endsWith(suffix)||(relativeDir!==undefined&&(command===relativeDir||(dirSuffix!==undefined&&command.endsWith(dirSuffix))));
}
function listAt(value:unknown):unknown[]{
 if(value===undefined)return [];
 if(!Array.isArray(value))throw new Error('config_unusable');
 return value;
}
function editOpencode(current:Record<string,unknown>,abs:string,remove:boolean):{value:Record<string,unknown>;changed:boolean}{
 const raw=current.plugin;
 if(raw!==undefined&&(!Array.isArray(raw)||raw.some(item=>typeof item!=='string')))throw new Error('config_unusable');
 const list=(raw??[]) as string[];
 const index=list.findIndex(item=>matchesEntry(item,abs,OPENCODE_PLUGIN_SUFFIX,OPENCODE_DIR_SUFFIX));
 if(remove){
  if(index<0)return {value:current,changed:false};
  const next=[...list];next.splice(index,1);
  return {value:{...current,plugin:next},changed:true};
 }
 if(index>=0)return {value:current,changed:false};
 return {value:{...current,plugin:[...list,abs]},changed:true};
}
function editCursorHooks(current:Record<string,unknown>,abs:string,events:string[],remove:boolean):{value:Record<string,unknown>;changed:boolean}{
 const raw=current.hooks;
 if(raw!==undefined&&!isRecord(raw))throw new Error('config_unusable');
 const hooks:{[name:string]:unknown}={...(isRecord(raw)?raw:{})};
 let changed=false;
 for(const event of events){
  const list=listAt(hooks[event]);
  const kept:unknown[]=[];let found=false;
  for(const item of list){
   const command=hookCommand(item);
   if(command!==null&&matchesEntry(command,abs,CURSOR_HOOK_SUFFIX)){
    found=true;
    if(!remove)kept.push(item);
   }else kept.push(item);
  }
  if(remove){
   if(found){hooks[event]=kept;changed=true;}
  }else if(!found){
   kept.push({command:abs});hooks[event]=kept;changed=true;
  }else hooks[event]=kept;
 }
 if(!changed)return {value:current,changed:false};
 const next:Record<string,unknown>={...current};
 if(next.version===undefined)next.version=1;
 next.hooks=hooks;
 return {value:next,changed:true};
}
// Antigravity follows the Gemini-style hook table: each event holds matcher groups, and a group holds the commands.
function editAntigravityHooks(current:Record<string,unknown>,abs:string,events:string[],remove:boolean):{value:Record<string,unknown>;changed:boolean}{
 const raw=current.hooks;
 if(raw!==undefined&&!isRecord(raw))throw new Error('config_unusable');
 const hooks:{[name:string]:unknown}={...(isRecord(raw)?raw:{})};
 let changed=false;
 for(const event of events){
  const groups=listAt(hooks[event]);
  if(remove){
   const kept:unknown[]=[];let eventChanged=false;
   for(const group of groups){
    if(!isRecord(group)){kept.push(group);continue;}
    const nested=group.hooks;
    if(Array.isArray(nested)){
     const commands=nested.filter(item=>{
      const command=hookCommand(item);
      if(command!==null&&matchesEntry(command,abs,ANTIGRAVITY_HOOK_SUFFIX)){eventChanged=true;return false;}
      return true;
     });
     if(nested.length>0&&commands.length===0)continue;
     kept.push({...group,hooks:commands});
    }else{
     const command=hookCommand(group);
     if(command!==null&&matchesEntry(command,abs,ANTIGRAVITY_HOOK_SUFFIX)){eventChanged=true;continue;}
     kept.push(group);
    }
   }
   if(eventChanged){hooks[event]=kept;changed=true;}
  }else{
   const found=groups.some(group=>{
    if(!isRecord(group))return false;
    const nested=group.hooks;
    if(Array.isArray(nested))return nested.some(item=>{const command=hookCommand(item);return command!==null&&matchesEntry(command,abs,ANTIGRAVITY_HOOK_SUFFIX);});
    const command=hookCommand(group);
    return command!==null&&matchesEntry(command,abs,ANTIGRAVITY_HOOK_SUFFIX);
   });
   if(!found){hooks[event]=[...groups,{hooks:[{type:'command',command:abs}]}];changed=true;}
  }
 }
 if(!changed)return {value:current,changed:false};
 return {value:{...current,hooks},changed:true};
}
function editJson(kind:WiringKind,current:Record<string,unknown>,abs:string,events:string[],remove:boolean):{value:Record<string,unknown>;changed:boolean}{
 if(kind==='plugin_json')return editOpencode(current,abs,remove);
 if(kind==='cursor_hooks_json')return editCursorHooks(current,abs,events,remove);
 return editAntigravityHooks(current,abs,events,remove);
}
type TomlBlock={header:string|null;lines:string[]};
function tomlBlocks(text:string):TomlBlock[]{
 const blocks:TomlBlock[]=[];let current:TomlBlock={header:null,lines:[]};
 for(const line of text.split('\n')){
  if(/^\s*\[\[?[^\]]+\]\]?\s*$/.test(line)){
   blocks.push(current);
   current={header:line,lines:[]};
  }else current.lines.push(line);
 }
 blocks.push(current);
 return blocks.filter(block=>block.header!==null||block.lines.length>0);
}
function isStopHeader(header:string|null):boolean{
 return header!==null&&/^\s*\[\[?hooks\.Stop\]\]?\s*$/.test(header);
}
function blockCommand(block:TomlBlock):string|null{
 for(const line of block.lines){
  const match=/^\s*command\s*=\s*(?:"([^"]*)"|'([^']*)')\s*$/.exec(line);
  if(match)return match[1]??match[2]??null;
 }
 return null;
}
function editToml(text:string,abs:string,remove:boolean):{text:string;changed:boolean}{
 const blocks=tomlBlocks(text);
 const ours=(block:TomlBlock):boolean=>{
  if(!isStopHeader(block.header))return false;
  const command=blockCommand(block);
  return command!==null&&matchesEntry(command,abs,GROK_HOOK_SUFFIX);
 };
 if(!remove){
  if(blocks.some(ours))return {text,changed:false};
  const block=`[[hooks.Stop]]\ncommand = ${JSON.stringify(abs)}\n`;
  const separator=text.length===0?'':text.endsWith('\n')?'\n':'\n\n';
  return {text:`${text}${separator}${block}`,changed:true};
 }
 const kept=blocks.filter(block=>!ours(block));
 if(kept.length===blocks.length)return {text,changed:false};
 const parts=kept.map(block=>block.header===null?block.lines.join('\n'):[block.header,...block.lines].join('\n'));
 let next=parts.join('\n');
 if(text.endsWith('\n')&&!next.endsWith('\n'))next+='\n';
 return {text:next,changed:true};
}

export type WiringProductKey='claude-code'|'opencode'|'cursor'|'antigravity'|'grok';
export type WiringState=Record<WiringProductKey,boolean>;
async function readJson(file:string):Promise<unknown>{
 try{return JSON.parse(await readFile(file,'utf8'));}catch{return undefined;}
}
// `doctor --json` uses this: a product is wired only when this Mac's own settings file names seamless's entry. The answer
// is read-only, and a malformed or missing file is simply not wired.
export async function detectWiring(home:string):Promise<WiringState>{
 const [claude,opencode,cursor,antigravity,grok]=await Promise.all([
  readJson(join(home,'.claude.json')),
  readJson(join(home,'.config','opencode','opencode.json')),
  readJson(join(home,'.cursor','hooks.json')),
  readJson(join(home,'.gemini','antigravity-cli','settings.json')),
  readFile(join(home,'.grok','config.toml'),'utf8').catch(()=>null),
 ]);
 const claudeWired=isRecord(claude)&&isRecord(claude.mcpServers)&&isRecord(claude.mcpServers.seamless);
 const opencodeWired=isRecord(opencode)&&Array.isArray(opencode.plugin)&&opencode.plugin.some(item=>typeof item==='string'&&matchesEntry(item,'',OPENCODE_PLUGIN_SUFFIX,OPENCODE_DIR_SUFFIX));
 const hookTableWired=(value:unknown,abs:string,suffix:string):boolean=>{
  if(!isRecord(value)||!isRecord(value.hooks))return false;
  for(const groups of Object.values(value.hooks)){
   if(!Array.isArray(groups))continue;
   for(const group of groups){
    if(isRecord(group)&&Array.isArray(group.hooks)){
     if(group.hooks.some(item=>{const command=hookCommand(item);return command!==null&&matchesEntry(command,abs,suffix);}))return true;
    }else{
     const command=hookCommand(group);
     if(command!==null&&matchesEntry(command,abs,suffix))return true;
    }
   }
  }
  return false;
 };
 const grokWired=typeof grok==='string'&&tomlBlocks(grok).some(block=>{
  if(!isStopHeader(block.header))return false;
  const command=blockCommand(block);
  return command!==null&&matchesEntry(command,'',GROK_HOOK_SUFFIX);
 });
 return {
  'claude-code':claudeWired,
  opencode:opencodeWired,
  cursor:hookTableWired(cursor,'',CURSOR_HOOK_SUFFIX),
  antigravity:hookTableWired(antigravity,'',ANTIGRAVITY_HOOK_SUFFIX),
  grok:grokWired,
 };
}

export async function runSetup(options:SetupOptions={}):Promise<SetupResult>{
 const home=options.home??homedir(),dryRun=options.dryRun===true,remove=options.remove===true,env=options.env??process.env,now=options.now??Date.now;
 const root=options.root??defaultRootPath();
 const {agents,destinations}=await detectAgents(home,env);
 const plans=await loadWiringPlans(home,root);
 const antigravity=await findAntigravity(home,env);
 const antigravityMarker=await exists(join(home,'.gemini','antigravity-cli'));
 const file=join(home,'.claude.json'),entry=mcpRegistration(options.nodePath??process.execPath,options.cliPath??defaultCliPath());
 const base={dryRun,file,agents,destinations};
 const changes:SetupChange[]=[];
 const backups:string[]=[];
 const finish=(status:'ok'|'config_unusable'|'write_failed'):SetupResult=>({status,...base,changes,backup:backups[0]??null,backups});
 const before=await readSettings(file);
 if(before.status==='unusable')return finish('config_unusable');
 const current=before.status==='ok'?before.value:{};
 const servers=current.mcpServers;
 if(servers!==undefined&&(!servers||typeof servers!=='object'||Array.isArray(servers)))return finish('config_unusable');
 const existing=(servers as Record<string,unknown>|undefined)?.seamless;
 const action:SetupChangeAction=remove
  ?(existing===undefined?'unchanged':dryRun?'would_remove':'removed')
  :(sameRegistration(existing,entry)?'unchanged':existing===undefined?(dryRun?'would_add':'added'):(dryRun?'would_update':'updated'));
 changes.push({file,kind:'mcp_registration',name:'seamless',action,product:'claude-code'});
 if(action!=='unchanged'&&!dryRun){
  try{
   if(before.status==='ok')backups.push(await writeBackup(home,before.bytes,now(),backupBase(file)));
   const nextServers={...(servers as Record<string,unknown>|undefined??{})};
   if(remove)delete nextServers.seamless;
   else nextServers.seamless=entry;
   await writeSettings(file,JSON.stringify({...current,mcpServers:nextServers},null,2)+'\n');
  }catch{return finish('write_failed');}
 }
 for(const plan of plans){
  const installed=plan.product==='antigravity'
   ?!!antigravity.binary
   :agents.find(agent=>agent.product===plan.product)?.installed===true;
  if(!remove&&!installed){
   // A phase 2 Antigravity install without its executable is visible but cannot run a hook: report that rather than
   // leaving a silent gap. Other absent products are not this home's business.
   if(plan.product==='antigravity'&&antigravityMarker)changes.push({file:plan.file,kind:plan.changeKind,name:'seamless',action:'skipped',product:plan.product,reason:'binary_not_found'});
   continue;
  }
  const raw=await readRaw(plan.file);
  if(raw.status==='unusable'){
   changes.push({file:plan.file,kind:plan.changeKind,name:'seamless',action:'skipped',product:plan.product,reason:'config_unusable'});
   continue;
  }
  let settings:Record<string,unknown>={};
  if(raw.status==='ok'&&plan.kind!=='grok_toml'){
   try{
    const value:unknown=JSON.parse(raw.bytes.toString('utf8'));
    if(!isRecord(value))throw new Error('config_unusable');
    settings=value;
   }catch{
    changes.push({file:plan.file,kind:plan.changeKind,name:'seamless',action:'skipped',product:plan.product,reason:'config_unusable'});
    continue;
   }
  }
  let text:string,changed:boolean;
  try{
   if(plan.kind==='grok_toml'){
    const edited=editToml(raw.status==='ok'?raw.bytes.toString('utf8'):'',plan.entry,remove);
    text=edited.text;changed=edited.changed;
   }else{
    const edited=editJson(plan.kind,settings,plan.entry,plan.events,remove);
    text=JSON.stringify(edited.value,null,2)+'\n';changed=edited.changed;
   }
  }catch{
   changes.push({file:plan.file,kind:plan.changeKind,name:'seamless',action:'skipped',product:plan.product,reason:'config_unusable'});
   continue;
  }
  if(!changed){
   changes.push({file:plan.file,kind:plan.changeKind,name:'seamless',action:'unchanged',product:plan.product});
   continue;
  }
  const nextAction:SetupChangeAction=remove?(dryRun?'would_remove':'removed'):raw.status==='ok'?(dryRun?'would_update':'updated'):(dryRun?'would_add':'added');
  changes.push({file:plan.file,kind:plan.changeKind,name:'seamless',action:nextAction,product:plan.product});
  if(dryRun)continue;
  try{
   if(raw.status==='ok')backups.push(await writeBackup(home,raw.bytes,now(),backupBase(plan.file)));
   await writeSettings(plan.file,text);
  }catch{return finish('write_failed');}
 }
 return finish('ok');
}
