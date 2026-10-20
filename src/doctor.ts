import {execFile} from 'node:child_process';
import {readFile, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {COMPATIBILITY, versionStatus, type CompatibilityProduct} from './compat.ts';
import {detectWiring, findAntigravity, findOnPath, readClaudeSessionRecords, type SetupProduct} from './setup.ts';

// `doctor --json` explains what this Mac has, without reading the Keychain, writing anything, or going to the network. It
// answers the questions the person needs before a first round trip: Node, each v1 product, Claude inbox sockets, the
// compatibility table, whether Reason Network's hooks are wired into the same products, and where Antigravity lives.
const run=promisify(execFile);
export type DoctorProduct=SetupProduct;
export type DoctorRow={product:DoctorProduct;installed:boolean;binary:string|null;version:string|null;versionStatus:string;wired:boolean};
export type DoctorResult={
 status:'ok';
 node:{version:string;required:string;ok:boolean};
 products:DoctorRow[];
 inbox:{claude:{sessions:number;reachable:number;unreachable:number}};
 compatibility:{entries:number;statuses:{verified:number;checking:number;fix_required:number}};
 reason_network_hooks:boolean;
 antigravity:{binary:string|null;hooks:boolean};
};
export type DoctorOptions={home?:string;env?:NodeJS.ProcessEnv;versionCommand?:(binary:string)=>Promise<string|null>};
const REQUIRED_NODE='22.22.0';
export function nodeSatisfied(version=process.versions.node):boolean{
 const [a,b,c]=version.split('.').map(n=>Number.parseInt(n,10));
 const [x,y,z]=REQUIRED_NODE.split('.').map(n=>Number.parseInt(n,10));
 if(![a,b,c].every(Number.isSafeInteger))return false;
 return a>x||a===x&&(b>y||b===y&&c>=z);
}
async function probeVersion(binary:string):Promise<string|null>{
 try{
  const {stdout,stderr}=await run(binary,['--version'],{timeout:1500,maxBuffer:65536});
  const match=/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?)/.exec(`${stdout}\n${stderr}`);
  return match?match[1]:null;
 }catch{return null;}
}
// Reason Network delivers into products through their hook tables. Only strings inside a hooks table count; a comment or a
// project name that happens to say "reason" is not a wiring. Both JSON products and Codex/Grok TOML are read this way.
const REASON_HOOK=/(reason[-_ ]?network|reasonmachines|(?:^|[\/\s])reason(?:[\s/]+hook|[\s/]+network|[\s/]+listen))/i;
const HOOK_FILES=['.claude/settings.json','.claude/settings.local.json','.codex/config.toml','.grok/config.toml','.cursor/hooks.json','.config/opencode/opencode.json','.gemini/settings.json','.gemini/antigravity-cli/settings.json'];
function reasonInJson(value:unknown,inHooks=false):boolean{
 if(Array.isArray(value))return value.some(v=>reasonInJson(v,inHooks));
 if(!value||typeof value!=='object')return false;
 for(const [key,child] of Object.entries(value as Record<string,unknown>)){
  const hooks=inHooks||/^hooks?$/i.test(key);
  if(typeof child==='string'){if(hooks&&REASON_HOOK.test(child))return true;continue;}
  if(reasonInJson(child,hooks))return true;
 }
 return false;
}
function reasonInToml(text:string):boolean{
 let hooks=false;
 for(const line of text.split('\n')){
  const table=/^\s*\[\[?([^\]]+)\]\]?/.exec(line);
  if(table){hooks=/^hooks(?:\.|$)/i.test(table[1].trim());continue;}
  const body=line.split('#')[0];
  if(hooks&&REASON_HOOK.test(body))return true;
 }
 return false;
}
export async function reasonNetworkHooks(home:string):Promise<boolean>{
 for(const rel of HOOK_FILES){
  const file=join(home,rel);
  let text:string;
  try{text=await readFile(file,'utf8');}catch{continue;}
  if(rel.endsWith('.toml')){if(reasonInToml(text))return true;continue;}
  try{if(reasonInJson(JSON.parse(text)))return true;}catch{}
 }
 return false;
}
async function antigravityHooks(home:string):Promise<boolean>{
 const dir=join(home,'.gemini','antigravity-cli');
 try{
  const value:unknown=JSON.parse(await readFile(join(dir,'settings.json'),'utf8'));
  const hooks=(value as {hooks?:unknown})?.hooks;
  if(hooks&&typeof hooks==='object'&&!Array.isArray(hooks)&&Object.keys(hooks as Record<string,unknown>).length)return true;
 }catch{}
 try{return (await stat(join(dir,'hooks'))).isDirectory();}catch{return false;}
}
function compatProduct(product:DoctorProduct):CompatibilityProduct|null{
 return product==='grok-bot'?null:product;
}
export async function runDoctor(options:DoctorOptions={}):Promise<DoctorResult>{
 const home=options.home??homedir(),env=options.env??process.env,probe=options.versionCommand??probeVersion;
 const [sessions,antigravity,reasonHooks,antigravityHasHooks,wiring,claudeBin,codexBin,opencodeBin,cursorBin,grokBin,peers]=await Promise.all([
  readClaudeSessionRecords(home),
  findAntigravity(home,env),
  reasonNetworkHooks(home),
  antigravityHooks(home),
  detectWiring(home),
  findOnPath('claude',env),
  findOnPath('codex',env),
  findOnPath('opencode',env),
  findOnPath('cursor',env),
  findOnPath('grok',env),
  stat(join(home,'.seamless','peers.json')).then(()=>true).catch(()=>false),
 ]);
 const versions=await Promise.all([claudeBin,codexBin,opencodeBin,cursorBin,grokBin].map(b=>b?probe(b):Promise.resolve(null)));
 const found=[
  {product:'claude-code' as const,binary:claudeBin,version:versions[0]??sessions.find(r=>r.version)?.version??null},
  {product:'codex' as const,binary:codexBin,version:versions[1]},
  {product:'opencode' as const,binary:opencodeBin,version:versions[2]},
  {product:'cursor' as const,binary:cursorBin,version:versions[3]},
  {product:'antigravity' as const,binary:antigravity.binary,version:antigravity.version??(antigravity.binary?await probe(antigravity.binary):null)},
  {product:'grok' as const,binary:grokBin,version:versions[4]},
  {product:'grok-bot' as const,binary:null,version:null},
 ];
 const rows:DoctorRow[]=found.map(row=>{
  const product=compatProduct(row.product);
  const wired=row.product==='opencode'?wiring.opencode
   :row.product==='cursor'?wiring.cursor
   :row.product==='antigravity'?wiring.antigravity
   :row.product==='grok'?wiring.grok
   :row.product==='claude-code'?wiring['claude-code']
   :false;
  return {product:row.product,installed:!!row.binary||(row.product==='grok-bot'&&peers),binary:row.binary,version:row.version,versionStatus:product?versionStatus(product,row.version):'unverified',wired};
 });
 const statuses={verified:0,checking:0,fix_required:0};
 for(const entry of COMPATIBILITY)statuses[entry.status]++;
 const reachable=sessions.filter(s=>s.messagingSocketPath).length;
 return {
  status:'ok',
  node:{version:process.versions.node,required:`>=${REQUIRED_NODE}`,ok:nodeSatisfied()},
  products:rows,
  inbox:{claude:{sessions:sessions.length,reachable,unreachable:sessions.length-reachable}},
  compatibility:{entries:COMPATIBILITY.length,statuses},
  reason_network_hooks:reasonHooks,
  antigravity:{binary:antigravity.binary,hooks:antigravityHasHooks},
 };
}
