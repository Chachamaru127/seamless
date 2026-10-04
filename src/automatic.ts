import {verifyInbound} from './inbound.ts';
import {createStatus,type StatusClock} from './status.ts';
import {observeGit} from './git-context.ts';
import {observeSeen} from './seen.ts';
import {realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {identifyCaller,type CallerOptions,type CallerResult,type Caller} from './caller.ts';
import {scanSessions,codexIdentity,inScope,type SessionIdentity, type ScanOptions} from './sessions-scan.ts';
import {createNativeRuntime,findClaudeIdentity,type NativeIdentity} from './native-runtime.ts';
import {readLimits,writeLimits,clearLimits,unrestricted,validLimits,type Limits,type AutoScope} from './limits.ts';
import {ContractError,object,type Registration,type Operation} from './protocol.ts';
import {Registry,loadRegistry} from './registry.ts';
import {Delivery,type NativeAdapter} from './delivery.ts';
export type CallContext={kind:'cli'|'mcp';meta?:unknown};
export type AutomaticOptions={clock?:StatusClock;compatTest?:boolean;compatTarget?:string;testLimitsHash?:string;home?:string;callerOptions?:CallerOptions;scanOptions?:ScanOptions;caller?:(context:CallContext)=>Promise<CallerResult>;scan?:(cwd:string,scope:AutoScope)=>ReturnType<typeof scanSessions>;inspect?:(session:SessionIdentity)=>Promise<NativeIdentity|null>;adapter?:NativeAdapter;limitsPath?:string;reservationDir?:string};
export type Ticket={provider:'codex'|'claude';nativeId:string;generation:string;cwd:string;branch?:string|null};
const idOf=(n:Pick<Ticket,'provider'|'nativeId'>)=>`${n.provider}:${n.nativeId}`;
export function issueTicket(n:Ticket):string{return Buffer.from(JSON.stringify({provider:n.provider,nativeId:n.nativeId,generation:n.generation,cwd:n.cwd,branch:n.branch??null})).toString('base64url');}
export function parseTicket(value:unknown):Ticket{
 if(typeof value!=='string'||value.length>16384)throw new ContractError('invalid_ticket');
 try{const n=object(JSON.parse(Buffer.from(value,'base64url').toString('utf8')),['provider','nativeId','generation','cwd','branch']);if(!['codex','claude'].includes(n.provider as string)||!['nativeId','generation','cwd'].every(k=>typeof n[k]==='string'&&n[k]))throw Error();if(n.branch!==null&&typeof n.branch!=='string')throw Error();return n as Ticket;}catch{throw new ContractError('invalid_ticket');}
}
function scope(value:unknown):AutoScope{if(value===undefined)return 'current_work';if(!['current_work','same_repository','any'].includes(value as string))throw new ContractError();return value as AutoScope;}
async function excluded(n:Ticket,limits:Limits){
 for(const e of limits.exclude){
  if(e.provider!==undefined&&e.provider!==n.provider||e.nativeId!==undefined&&e.nativeId!==n.nativeId)continue;
  if(e.workspace===undefined)return true;
  const workspace=await realpath(e.workspace).catch(()=>e.workspace!);
  if(n.cwd===workspace||n.cwd.startsWith(workspace.endsWith('/')?workspace:workspace+'/'))return true;
 }
 return false;
}
function registrations(sessions:SessionIdentity[]):Registration[]{
 return sessions.map(n=>({id:idOf(n),provider:n.provider,nativeId:n.nativeId,generation:n.generation,host:'local',displayName:idOf(n),workspace:n.cwd,operations:['read','send'],grants:sessions.filter(p=>idOf(p)!==idOf(n)).flatMap(p=>(['read','send'] as const).flatMap(operation=>(['inbound','outbound'] as const).map(direction=>({peer:idOf(p),operation,direction}))))}));
}
export function createAutomatic(options:AutomaticOptions={}){
 const home=options.home??homedir(),scanOptions={includeUnavailable:!options.compatTest,...options.scanOptions,home};
 const limitsPath=options.limitsPath??join(home,'.seamless','limits.json');
 const caller=(ctx:CallContext)=>options.caller?options.caller(ctx):identifyCaller(ctx,{...scanOptions,...options.callerOptions,home});
 const scan=options.scan??((cwd:string,s:AutoScope)=>scanSessions(cwd,s,scanOptions));
 const inspect=options.inspect??(async(n:SessionIdentity)=>n.provider==='codex'?codexIdentity(n.nativeId,scanOptions):findClaudeIdentity(n.nativeId,home,{...scanOptions,...scanOptions.claude}));
 const runtime=createNativeRuntime({...scanOptions,desktopVersion:scanOptions.version,home,codexIdentity:id=>codexIdentity(id,scanOptions)});
 const adapter=options.adapter??runtime.adapter;
 const branch=async(cwd:string)=>{const git=await (scanOptions.git??observeGit)(cwd);return git.state==='git'?git.branch:git.state==='no_git'?null:undefined;};
 const ticketFor=async(n:SessionIdentity)=>{const observed=await branch(n.cwd);return observed===undefined?null:issueTicket({...n,branch:observed});};
 const policy=async(n:Ticket,c:Caller,l:Limits,op:Operation,s:AutoScope)=>{
  if(l.operations?.[op]===false)return 'operation_not_permitted';
  if(await excluded(n,l))return 'target_excluded';
  if(!await inScope(n.cwd,c.cwd,s,scanOptions.git)||l.scope!==null&&!await inScope(n.cwd,c.cwd,l.scope,scanOptions.git))return 'scope_conflict';
  return null;
 };
 return async(method:string,input:unknown,context:CallContext={kind:'cli'}):Promise<any>=>{
  const observed=await caller(context);if(observed.status!=='ok')return observed;
  const c=observed.caller;
  if(options.compatTest&&!['sessions','read'].includes(method))return {status:'compat_check_read_only'};
  if(method==='limits'){
   const p=object(input,['action','value']);if(!['get','set','clear'].includes(p.action as string)||p.action!=='set'&&p.value!==undefined)throw new ContractError();
   const current=await readLimits(limitsPath);if(p.action==='get')return current;
   if(p.action==='clear')return clearLimits(current.status==='unusable'?null:current.hash,limitsPath);
   if(current.status==='unusable')return {status:'limits_unusable'};
   if(!validLimits(p.value))return {status:'limits_unusable'};
   return writeLimits(p.value,current.hash,limitsPath);
  }
  const loaded=await readLimits(limitsPath);if(loaded.status==='unusable')return {status:'limits_unusable'};
  if(options.compatTest&&(loaded.status!=='ok'||loaded.hash!==options.testLimitsHash))return {status:'compat_check_limits_changed'};
  const l=loaded.status==='ok'?loaded.value:unrestricted;
  const status=createStatus({dir:options.reservationDir??join(home,'.seamless','reservations'),adapter,caller:{...c,id:idOf(c)},clock:options.clock,canRead:async n=>{const current=await caller(context);if(current.status!=='ok'||idOf(current.caller)!==idOf(c)||current.caller.generation!==c.generation)return false;const limits=await readLimits(limitsPath);return limits.status!=='unusable'&&!await policy(n,c,limits.status==='ok'?limits.value:unrestricted,'read','any');}});
  if(method==='send'&&input&&typeof input==='object'&&'track' in input){const p=object(input,['track','waitSeconds']);return status.track(p.track,p.waitSeconds);}
  const keys=method==='sessions'?['operation','scope','target','includeOffline']:method==='select'?['operation','scope','target']:method==='read'?['target','scope','cursor','limit']:method==='send'?['ticket','id','text','replyTo','scope']:method==='revalidate'?['ticket','operation','scope']:[];
  if(!keys.length)throw new ContractError('unknown_method');
  const p=object(input??{},keys),s=scope(p.scope);
  if(p.includeOffline!==undefined&&typeof p.includeOffline!=='boolean')throw new ContractError();
  const op:Operation=method==='read'||(method==='sessions'||method==='select')&&p.operation===undefined?'read':(p.operation??'send') as Operation;
  if(!['read','send'].includes(op)||p.target!==undefined&&typeof p.target!=='string')throw new ContractError();
  if(l.operations?.[op]===false)return {status:'operation_not_permitted'};
  if(method==='read'&&typeof p.target==='string'&&!options.adapter){const [provider,...id]=p.target.split(':');if(provider==='claude'||provider==='codex'){if(l.exclude.some(e=>e.workspace===undefined&&(e.provider===undefined||e.provider===provider)&&(e.nativeId===undefined||e.nativeId===id.join(':'))))return {status:'not_found'};if(provider==='claude'&&await (await import('./adapters/claude.ts')).findClaudeSession(id.join(':'),{home})===null)return {status:'not_found'};const unsupported=await runtime.checkCompatibility({provider,nativeId:id.join(':')});if(unsupported)return unsupported;}}
  if(method==='send'||method==='revalidate'){
   const ticket=parseTicket(p.ticket);if(idOf(ticket)===idOf(c))return {status:'self_target'};
   const target:SessionIdentity={...ticket,socket:''};
   let unsupportedVersion:string|undefined;
   const validate=async()=>{
    const now=await caller(context);if(now.status!=='ok'||idOf(now.caller)!==idOf(c)||now.caller.generation!==c.generation||now.caller.cwd!==c.cwd)return 'caller_unobserved';
    const limits=await readLimits(limitsPath);if(limits.status==='unusable')return 'limits_unusable';
    const denied=await policy(ticket,c,limits.status==='ok'?limits.value:unrestricted,op,s);if(denied)return denied;
    if(!options.adapter){if(target.provider==='claude'&&await (await import('./adapters/claude.ts')).findClaudeSession(target.nativeId,{home})===null)return 'not_found';const unsupported=await runtime.checkCompatibility(target);if(unsupported){unsupportedVersion=unsupported.version;return unsupported.status;}}
    const n=await inspect(target);if(!n)return 'target_offline';
    if(n.nativeId!==ticket.nativeId||n.generation!==ticket.generation)return 'generation_mismatch';
    if(n.cwd!==ticket.cwd||await branch(n.cwd)!==ticket.branch)return 'workspace_changed';return null;
   };
   const denied=await validate();if(denied)return {status:denied,...(unsupportedVersion?{version:unsupportedVersion}:{})};
   if(method==='revalidate')return {status:'validated',target:idOf(ticket)};
   const records=registrations([c,target]),registry=new Registry(records);
   const delivery=new Delivery(registry,idOf(c),adapter,{tracking:{keyPath:join(home,'.seamless','key'),now:options.clock?.now},fixedTarget:records[1],validate,reservationDir:options.reservationDir??join(home,'.seamless','reservations')});
   const result=await delivery.send({target:idOf(ticket),id:p.id,text:p.text,replyTo:p.replyTo,scope:'any_registered'});
   return unsupportedVersion?{...result as object,version:unsupportedVersion}:result;
  }
  // Apply the tightest scope before owner lookups; an explicit wider query never widens limits.
  const scopes:AutoScope[]=['current_work','same_repository','any'];
  const effective=l.scope===null?s:scopes[Math.min(scopes.indexOf(s),scopes.indexOf(l.scope))];
  const found=options.compatTest&&!options.scan?await scanSessions(c.cwd,effective,{...scanOptions,expectedPairCaller:idOf(c),include:async n=>!await excluded(n,l)&&(!options.compatTarget||idOf(n)===options.compatTarget||idOf(n)===idOf(c))}):await scan(c.cwd,effective),visible:SessionIdentity[]=[];
  if(options.compatTest){if(found.codexWorkspace!=='observed'||found.codexTruncated)return {status:'compat_check_pair_required'};const pair=[];for(const n of found.sessions)if(!await policy(n,c,l,'read',s))pair.push(n);if(pair.length!==2||!pair.some(n=>idOf(n)===idOf(c)))return {status:'compat_check_pair_required'};}
  for(const n of found.sessions){if(idOf(n)!==idOf(c)&&!await policy(n,c,l,op,s)&&(!p.target||idOf(n)===p.target))visible.push(n);}
  if(method==='sessions'){
   const seen=options.compatTest?{disappeared:[],changes:new Map()}:await observeSeen(join(home,'.seamless','seen.json'),found.sessions,options.clock?.now()??Date.now());
   const expired:string[]=[];
   for(const old of seen.disappeared){if(await excluded(old,{...l,exclude:l.exclude.filter(e=>e.nativeId!==undefined)})&&visible.some(n=>n.provider===old.provider&&n.cwd===old.cwd&&seen.changes.get(idOf(n))?.change==='new'))expired.push(old.nativeId);}
   const excludeExpired=[...new Set(expired)];
   let inbound:Awaited<ReturnType<typeof verifyInbound>>=[];
   if(!options.compatTest&&l.operations?.read!==false&&adapter.received){
    try{const records=registrations([c,...found.sessions.filter(n=>idOf(n)!==idOf(c))]);
     inbound=await verifyInbound({caller:records[0],received:await adapter.received(records[0]),targets:records.slice(1),now:options.clock?.now()??Date.now(),sentIds:adapter.sentIds,canRead:async target=>{
      const current=await caller(context),limits=await readLimits(limitsPath);
      return current.status==='ok'&&idOf(current.caller)===idOf(c)&&current.caller.generation===c.generation&&limits.status!=='unusable'&&!await policy({provider:target.provider,nativeId:target.nativeId,generation:target.generation,cwd:target.workspace},c,limits.status==='ok'?limits.value:unrestricted,'read',s);
     }});
    }catch{}
   }
   const candidates=await Promise.all(visible.map(async n=>({id:idOf(n),provider:n.provider,nativeId:n.nativeId,generation:n.generation,cwd:n.cwd,...seen.changes.get(idOf(n)),status:n.status??(seen.changes.get(idOf(n))?.change==='generation_changed'?'unknown':'online'),reason:n.reason??(seen.changes.get(idOf(n))?.change==='generation_changed'?'generation_changed':null),requests:options.compatTest?[]:await status.recent({...n,id:idOf(n)}),operations:{read:l.operations?.read??true,send:l.operations?.send??true},ticket:n.status&&n.status!=='online'?null:await ticketFor(n)})));
   const listed=p.includeOffline===true?candidates:candidates.filter(n=>n.status==='online');
   return {status:'ok',inbound,caller:{provider:c.provider,nativeId:c.nativeId,generation:c.generation,cwd:c.cwd,source:c.source},codexWorkspace:found.codexWorkspace,...(found.codexTruncated?{codexTruncated:found.codexTruncated}:{}),excludeExpired,offlineHidden:candidates.length-listed.length,candidates:listed};
  }
  if(visible.length!==1)return {status:visible.length?'ambiguous':'target_unavailable'};
  const n=visible[0];
  if(method==='select')return {status:'selected',target:idOf(n),ticket:n.status&&n.status!=='online'?null:await ticketFor(n)};
  if(p.cursor!==undefined&&typeof p.cursor!=='string'||p.limit!==undefined&&(!Number.isInteger(p.limit)||Number(p.limit)<1||Number(p.limit)>100))throw new ContractError();
  const current=await inspect(n);if(!current||current.generation!==n.generation)return {status:'generation_mismatch'};if(current.cwd!==n.cwd)return {status:'workspace_changed'};
  const latest=await readLimits(limitsPath);if(latest.status==='unusable')return {status:'limits_unusable'};
  if(options.compatTest&&(latest.status!=='ok'||latest.hash!==options.testLimitsHash))return {status:'compat_check_limits_changed'};
  const denied=await policy(n,c,latest.status==='ok'?latest.value:unrestricted,'read',s);if(denied)return {status:denied};
  return adapter.read(registrations([c,n])[1],{cursor:p.cursor as string|undefined,limit:p.limit as number|undefined});
 };
}
export type Automatic=ReturnType<typeof createAutomatic>;
export async function migrateRegistry(path:string,write=false,limitsPath?:string){
 const records=await loadRegistry(path),proposal:Limits={version:1,exclude:[],scope:'current_work',operations:null};
 const notes={notice:'新方式では名簿になかった相手も同じ作業場所なら対象になります。片方向や一部の操作だけを許可していた場合、名簿では止めていた操作も許可されます',pairs:records.map(r=>({id:r.id,provider:r.provider,operations:r.operations,grants:r.grants.map(g=>({peer:g.peer,operation:g.operation,direction:g.direction}))}))};
 if(!write)return {status:'ok',proposal,notes};
 const current=await readLimits(limitsPath);if(current.status==='unusable')return {status:'limits_unusable',proposal,notes};
 return {...await writeLimits(proposal,current.hash,limitsPath),proposal,notes};
}
