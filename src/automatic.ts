import {isVersionAllowed,versionStatus,productOf} from './compat.ts';
import {requests,DAY} from './request-store.ts';
import {verifyInbound} from './inbound.ts';
import {createStatus,type StatusClock} from './status.ts';
import {observeGit} from './git-context.ts';
import {desktopVersion} from './adapters/codex.ts';
import {observeSeen} from './seen.ts';
import {realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {identifyCaller,type CallerOptions,type CallerResult,type Caller} from './caller.ts';
import {scanSessions,codexIdentity,wakeCodexThread,inScope,type SessionIdentity, type ScanOptions} from './sessions-scan.ts';
import {createNativeRuntime,createCodexOwnerLookup,findClaudeIdentity,type NativeIdentity} from './native-runtime.ts';
import {readLimits,writeLimits,clearLimits,unrestricted,validLimits,type Limits,type AutoScope} from './limits.ts';
import {ContractError,object,type Registration,type Operation} from './protocol.ts';
import {Registry,loadRegistry} from './registry.ts';
import {Delivery,type NativeAdapter} from './delivery.ts';
export type CallContext={kind:'cli'|'mcp';meta?:unknown};
export type AutomaticOptions={clock?:StatusClock;compatTest?:boolean;compatTarget?:string;testLimitsHash?:string;home?:string;callerOptions?:CallerOptions;scanOptions?:ScanOptions;caller?:(context:CallContext)=>Promise<CallerResult>;scan?:(cwd:string,scope:AutoScope)=>ReturnType<typeof scanSessions>;inspect?:(session:SessionIdentity)=>Promise<NativeIdentity|null>;wake?:(nativeId:string)=>Promise<string|null>;adapter?:NativeAdapter;limitsPath?:string;reservationDir?:string};
export type Ticket={provider:'codex'|'claude'|'grok';nativeId:string;generation:string;cwd:string;branch?:string|null};
const idOf=(n:Pick<Ticket,'provider'|'nativeId'>)=>`${n.provider}:${n.nativeId}`;
export function issueTicket(n:Ticket):string{return Buffer.from(JSON.stringify({provider:n.provider,nativeId:n.nativeId,generation:n.generation,cwd:n.cwd,branch:n.branch??null})).toString('base64url');}
export function parseTicket(value:unknown):Ticket{
 if(typeof value!=='string'||value.length>16384)throw new ContractError('invalid_ticket');
 try{const n=object(JSON.parse(Buffer.from(value,'base64url').toString('utf8')),['provider','nativeId','generation','cwd','branch']);if(!['codex','claude','grok'].includes(n.provider as string)||!['nativeId','generation','cwd'].every(k=>typeof n[k]==='string'&&n[k]))throw Error();if(n.branch!==null&&typeof n.branch!=='string')throw Error();return n as Ticket;}catch{throw new ContractError('invalid_ticket');}
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
 const home=options.home??homedir();
 const limitsPath=options.limitsPath??join(home,'.seamless','limits.json');
 return async(method:string,input:unknown,context:CallContext={kind:'cli'}):Promise<any>=>{
  const loaded=await readLimits(limitsPath);
  // limits reads and writes only seamless's own file, so strict never locks an updated caller out of turning strict off.
  const strictVersions=method!=='limits'&&(options.compatTest===true||loaded.status==='ok'&&loaded.value.strictVersions===true);
  // One call observes each workspace's git state and the Desktop version once: the scope check and the ticket
  // branch run per candidate, and Codex can hold a hundred threads in one repository (measured 2026-10-07: 1512 git runs, 25s).
  // The key is the resolved path: Codex records a workspace by the path it was opened with (a symlink such as the
  // repository's former name), the scan resolves it, and both spellings must share one observation.
  const gitOnce=new Map<string,ReturnType<typeof observeGit>>(),baseGit=options.scanOptions?.git??observeGit;
  const git=async(cwd:string)=>{const key=await realpath(cwd).catch(()=>cwd);let v=gitOnce.get(key);if(!v){v=baseGit(cwd);gitOnce.set(key,v);}return v;};
  let versionOnce:Promise<string|null>|undefined;const baseVersion=options.scanOptions?.version??desktopVersion;
  const version=()=>versionOnce??=baseVersion();
  const scanOptions={includeUnavailable:!options.compatTest,...options.scanOptions,git,version,home,strictVersions,claude:{...options.scanOptions?.claude,strictVersions}};
  const ownerLookup=method==='band'&&!options.scanOptions?.owner?createCodexOwnerLookup(home,scanOptions.version,scanOptions):undefined;
  const ownerCache=new Map<string,Promise<string|null>>();
  const bandOwner=method==='band'?(id:string)=>{let value=ownerCache.get(id);if(!value){value=(scanOptions.owner??ownerLookup!.owner)(id);ownerCache.set(id,value);}return value;}:undefined;
  try{
  // Within one call the caller is identified in full once; later checks confirm the same process cheaply (see stillCaller).
  let identified:Caller|undefined;
  const caller=async(ctx:CallContext)=>{if(options.caller)return options.caller(ctx);const r=await identifyCaller(ctx,{...scanOptions,...options.callerOptions,home,strictVersions,claude:{...scanOptions.claude,...options.callerOptions?.claude,strictVersions},previous:identified});identified=r.status==='ok'?r.caller:undefined;return r;};
  const scan=options.scan??((cwd:string,s:AutoScope)=>scanSessions(cwd,s,scanOptions));
  const inspect=options.inspect??(async(n:SessionIdentity)=>n.provider==='codex'?codexIdentity(n.nativeId,bandOwner?{...scanOptions,owner:bandOwner}:scanOptions):n.provider==='grok'?(await import('./adapters/grok.ts')).grokIdentity(n.nativeId,{...scanOptions,...scanOptions.grok},n.generation||undefined):findClaudeIdentity(n.nativeId,home,{...scanOptions,...scanOptions.claude}));
  const wake=options.wake??((id:string)=>wakeCodexThread(id,scanOptions));
  // Unusable limits are rejected by the delivery's own re-check, which keeps the reservation retryable.
  const runtime=createNativeRuntime({...scanOptions,codexOwner:bandOwner,markUnapproved:async()=>{const current=await readLimits(limitsPath);return current.status==='ok'&&current.value.markUnapproved===true;},desktopVersion:scanOptions.version,home,codexIdentity:id=>codexIdentity(id,scanOptions)});
  const baseAdapter=options.adapter??runtime.adapter;
  const structures=new Map<string,ReturnType<NonNullable<NativeAdapter['structure']>>>();
  const adapter:NativeAdapter=method==='band'&&baseAdapter.structure?{...baseAdapter,structure:target=>{
   const key=JSON.stringify([target.provider,target.nativeId,target.generation,target.workspace]);
   let value=structures.get(key);if(!value){value=baseAdapter.structure!(target);structures.set(key,value);}return value;
  }}:baseAdapter;
  const branch=async(cwd:string,observe=scanOptions.git)=>{const git=await observe(cwd);return git.state==='git'?git.branch:git.state==='no_git'?null:undefined;};
  const ticketFor=async(n:SessionIdentity)=>{const observed=await branch(n.cwd);return observed===undefined?null:issueTicket({...n,branch:observed});};
  const policy=async(n:Ticket,c:Caller,l:Limits,op:Operation,s:AutoScope)=>{
   if(l.operations?.[op]===false)return 'operation_not_permitted';
   if(await excluded(n,l))return 'target_excluded';
   if(!await inScope(n.cwd,c.cwd,s,scanOptions.git)||l.scope!==null&&!await inScope(n.cwd,c.cwd,l.scope,scanOptions.git))return 'scope_conflict';
   return null;
  };
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
  if(loaded.status==='unusable')return {status:'limits_unusable'};
  if(options.compatTest&&(loaded.status!=='ok'||loaded.hash!==options.testLimitsHash))return {status:'compat_check_limits_changed'};
  const l=loaded.status==='ok'?loaded.value:unrestricted;
  const compatibilityFor=(n:Pick<SessionIdentity,'provider'>,limits:Limits)=>({...scanOptions,...(n.provider==='claude'?scanOptions.claude:{}),strictVersions:options.compatTest===true||limits.strictVersions===true});
  const rejectedVersion=(n:Pick<SessionIdentity,'provider'|'version'>,limits:Limits)=>isVersionAllowed(productOf(n.provider),n.version,compatibilityFor(n,limits))?null:{status:'unsupported_version',reason:n.version??'unknown',version:n.version??'unknown'};
  const bandIdentities=new Map<string,SessionIdentity>([[idOf(c),c]]);
  const targetCompatibility=async(n:Pick<SessionIdentity,'provider'|'nativeId'|'version'>,limits:Limits)=>{
   const compatibility=compatibilityFor(n,limits);
   if(method==='band'&&options.adapter){const current=bandIdentities.get(idOf(n));return !current||current.status==='unknown'?{status:'unsupported_version',version:current?.version??'unknown'}:rejectedVersion(current,limits);}
   if(!options.adapter||!options.scan)return runtime.checkCompatibility(n,compatibility);
   if(!compatibility.strictVersions)return null;
   if(Object.hasOwn(n,'version'))return rejectedVersion(n,limits);
   const candidate=(await scan(c.cwd,'any')).sessions.find(candidate=>idOf(candidate)===idOf(n));
   return rejectedVersion(candidate??{...n,version:null},limits);
  };
  const callerVersion=rejectedVersion(c,l);if(callerVersion)return callerVersion;
  // Both sides of a request are read together, as the band already does; each read still re-observes the caller.
  const status=createStatus({parallelReads:true,dir:options.reservationDir??join(home,'.seamless','reservations'),adapter,caller:{...c,id:idOf(c)},clock:options.clock,canRead:async n=>{const current=await caller(context);if(current.status!=='ok'||idOf(current.caller)!==idOf(c)||current.caller.generation!==c.generation)return false;const limits=await readLimits(limitsPath);if(limits.status==='unusable')return false;const currentLimits=limits.status==='ok'?limits.value:unrestricted;return !rejectedVersion(current.caller,currentLimits)&&!await policy(n,c,currentLimits,'read','any')&&!await targetCompatibility(n,currentLimits);}});
  if(method==='send'&&input&&typeof input==='object'&&'track' in input){const p=object(input,['track','waitSeconds','scope']);scope(p.scope);return status.track(p.track,p.waitSeconds);}
  const keys=method==='sessions'?['operation','scope','target','includeOffline','peek']:method==='select'?['operation','scope','target']:method==='read'?['target','scope','cursor','limit']:method==='send'?['ticket','id','text','replyTo','scope']:method==='revalidate'?['ticket','operation','scope']:[];
  if(!keys.length&&method!=='band')throw new ContractError('unknown_method');
  const p=object(method==='band'?input:input??{},keys),s=method==='band'?'any':scope(p.scope);
  if(p.peek!==undefined&&typeof p.peek!=='boolean')throw new ContractError();
  if(p.includeOffline!==undefined&&typeof p.includeOffline!=='boolean')throw new ContractError();
  const op:Operation=method==='band'||method==='read'||(method==='sessions'||method==='select')&&p.operation===undefined?'read':(p.operation??'send') as Operation;
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
    const currentLimits=limits.status==='ok'?limits.value:unrestricted;
    const unsupportedCaller=rejectedVersion(now.caller,currentLimits);if(unsupportedCaller){unsupportedVersion=unsupportedCaller.version;return unsupportedCaller.status;}
    if(!options.adapter&&target.provider==='claude'&&await (await import('./adapters/claude.ts')).findClaudeSession(target.nativeId,{home})===null)return 'not_found';
    const unsupported=await targetCompatibility(target,currentLimits);if(unsupported){unsupportedVersion=unsupported.version;return unsupported.status;}
    let n=await inspect(target);if(!n&&target.provider==='codex'&&await wake(target.nativeId))n=await inspect(target);if(!n)return 'target_offline';
    if(n.nativeId!==ticket.nativeId||n.generation!==ticket.generation)return 'generation_mismatch';
    // The branch is observed afresh here: a ticket issued earlier in this same call must not vouch for itself.
    if(n.cwd!==ticket.cwd||await branch(n.cwd,baseGit)!==ticket.branch)return 'workspace_changed';return null;
   };
   const denied=await validate();if(denied)return {status:denied,...(unsupportedVersion!==undefined?{reason:unsupportedVersion,version:unsupportedVersion}:{})};
   if(method==='revalidate')return {status:'validated',target:idOf(ticket)};
   // A Grok CLI envelope is handed over whole as additionalContext (Grok clips at 10,000 characters), so a longer text is
   // refused before anything is reserved rather than cut short (D7).
   if(target.provider==='grok'&&typeof p.text==='string'&&[...p.text].length>8000)return {status:'text_too_long'};
   const records=registrations([c,target]),registry=new Registry(records);
   const delivery=new Delivery(registry,idOf(c),adapter,{tracking:{keyPath:join(home,'.seamless','key'),now:options.clock?.now},fixedTarget:records[1],validate,reservationDir:options.reservationDir??join(home,'.seamless','reservations')});
   const result=await delivery.send({target:idOf(ticket),id:p.id,text:p.text,replyTo:p.replyTo,scope:'any_registered'});
   return unsupportedVersion!==undefined?{...result as object,reason:unsupportedVersion,version:unsupportedVersion}:result;
  }
  // Apply the tightest scope before owner lookups; an explicit wider query never widens limits.
  const scopes:AutoScope[]=['current_work','same_repository','any'];
  const effective=l.scope===null?s:scopes[Math.min(scopes.indexOf(s),scopes.indexOf(l.scope))];
  let bandReceived:Awaited<ReturnType<NonNullable<NativeAdapter['received']>>>=[];
  const related=async():ReturnType<typeof scanSessions>=>{
   const peers=new Map<string,SessionIdentity>(),now=options.clock?.now()??Date.now();
   for(const r of await requests(options.reservationDir??join(home,'.seamless','reservations'))){
    if(r.sender.provider===c.provider&&r.sender.nativeId===c.nativeId&&r.sender.generation===c.generation&&r.at<=now&&now-r.at<=DAY)peers.set(idOf(r.recipient),{...r.recipient,socket:''});
   }
   try{bandReceived=await adapter.received?.(registrations([c])[0])??[];}catch{}
   for(const r of bandReceived){
    const provider=r.sender.id.split(':')[0];
    if((provider==='claude'||provider==='codex'||provider==='grok')&&r.sender.id===provider+':'+r.sender.nativeId&&!peers.has(r.sender.id))peers.set(r.sender.id,{provider,nativeId:r.sender.nativeId,generation:r.sender.generation,cwd:'',socket:''});
   }
   peers.delete(idOf(c));
   const identities=await Promise.all([...peers].map(async([id,peer])=>{
    const current=await inspect(peer).catch(()=>null);
    const n:SessionIdentity=current&&current.nativeId===peer.nativeId?{...current,provider:peer.provider}:{...peer,version:null,status:'unknown',reason:'unreachable'};
    if(rejectedVersion(n,l)){n.status='unknown';n.reason='unsupported_version';}
    return [id,n] as const;
   }));
   for(const [id,n] of identities)bandIdentities.set(id,n);
   return {sessions:[...bandIdentities.values()],codexWorkspace:'unknown' as const};
  };
  const found=method==='band'?await related():options.compatTest&&!options.scan?await scanSessions(c.cwd,effective,{...scanOptions,expectedPairCaller:idOf(c),include:async n=>!await excluded(n,l)&&(!options.compatTarget||idOf(n)===options.compatTarget||idOf(n)===idOf(c))}):await scan(c.cwd,effective),visible:SessionIdentity[]=[];
  if(options.compatTest){if(found.codexWorkspace!=='observed'||found.codexTruncated)return {status:'compat_check_pair_required'};const pair=[];for(const n of found.sessions)if(!await policy(n,c,l,'read',s))pair.push(n);if(pair.length!==2||!pair.some(n=>idOf(n)===idOf(c)))return {status:'compat_check_pair_required'};}
  for(const foundSession of found.sessions){const n:SessionIdentity=rejectedVersion(foundSession,l)?{...foundSession,status:'unknown',reason:'unsupported_version'}:foundSession;if(idOf(n)!==idOf(c)&&!await policy(n,c,l,op,s)&&(!p.target||idOf(n)===p.target))visible.push(n);}
  // A Codex conversation the caller names but Desktop has not loaded is opened, then observed again.
  if(p.target&&method!=='band'&&visible.length===1&&visible[0].provider==='codex'&&visible[0].reason==='unreachable'&&await wake(visible[0].nativeId)){const current=await inspect(visible[0]);if(current)visible[0]={...current,provider:'codex'};}
  if(method==='sessions'||method==='band'){
   const seen=options.compatTest||p.peek===true||method==='band'?{disappeared:[],changes:new Map()}:await observeSeen(join(home,'.seamless','seen.json'),found.sessions.filter(n=>!(n.provider==='grok'&&n.generation==='none')),options.clock?.now()??Date.now());
   const expired:string[]=[];
   for(const old of seen.disappeared){if(await excluded(old,{...l,exclude:l.exclude.filter(e=>e.nativeId!==undefined)})&&visible.some(n=>n.provider===old.provider&&n.cwd===old.cwd&&seen.changes.get(idOf(n))?.change==='new'))expired.push(old.nativeId);}
   const excludeExpired=[...new Set(expired)];
   const inboundPromise=(async()=>{
   let inbound:Awaited<ReturnType<typeof verifyInbound>>=[];
   if(!options.compatTest&&l.operations?.read!==false&&adapter.received){
    try{const records=registrations([c,...found.sessions.filter(n=>idOf(n)!==idOf(c))]);
     inbound=await verifyInbound({parallel:true,caller:records[0],received:method==='band'?bandReceived:await adapter.received(records[0]),targets:records.slice(1),now:options.clock?.now()??Date.now(),sentIds:adapter.sentIds,canRead:async target=>{
      const current=await caller(context),limits=await readLimits(limitsPath);
      return current.status==='ok'&&idOf(current.caller)===idOf(c)&&current.caller.generation===c.generation&&limits.status!=='unusable'&&!await policy({provider:target.provider,nativeId:target.nativeId,generation:target.generation,cwd:target.workspace},c,limits.status==='ok'?limits.value:unrestricted,'read',s)&&!await targetCompatibility(target,limits.status==='ok'?limits.value:unrestricted);
     }});
    }catch{}
   }
   return inbound;})();
   if(method!=='band')await inboundPromise;
   const candidates=await Promise.all(visible.map(async n=>({id:idOf(n),provider:n.provider,host:'local',nativeId:n.nativeId,generation:n.generation,cwd:n.cwd,version:n.version||null,versionStatus:versionStatus(productOf(n.provider),n.version,compatibilityFor(n,l)),...(p.peek===true||method==='band'?{change:'unknown'}:seen.changes.get(idOf(n))),status:n.status??(seen.changes.get(idOf(n))?.change==='generation_changed'?'unknown':'online'),reason:n.reason??(seen.changes.get(idOf(n))?.change==='generation_changed'?'generation_changed':null),requests:options.compatTest?[]:await status.recent({...n,id:idOf(n)}),operations:{read:l.operations?.read??true,send:l.operations?.send??true},ticket:method==='band'?null:n.status&&n.status!=='online'?null:await ticketFor(n)})));
   const inbound=await inboundPromise;
   // Hide only sessions the scan saw as not running; a changed generation is still reachable.
   const listed=method==='band'||p.includeOffline===true?candidates:candidates.filter((_,i)=>(visible[i].status??'online')==='online');
   return {status:'ok',inbound,caller:{provider:c.provider,nativeId:c.nativeId,generation:c.generation,cwd:c.cwd,source:c.source,version:c.version||null,versionStatus:versionStatus(productOf(c.provider),c.version,compatibilityFor(c,l))},codexWorkspace:found.codexWorkspace,...(found.codexTruncated?{codexTruncated:found.codexTruncated}:{}),excludeExpired,offlineHidden:candidates.length-listed.length,candidates:listed};
  }
  if(visible.length!==1)return {status:visible.length?'ambiguous':'target_unavailable'};
  const n=visible[0];
  const unsupported=rejectedVersion(n,l);if(unsupported)return unsupported;
  if(method==='select')return {status:'selected',target:idOf(n),ticket:n.status&&n.status!=='online'?null:await ticketFor(n)};
  if(p.cursor!==undefined&&typeof p.cursor!=='string'||p.limit!==undefined&&(!Number.isInteger(p.limit)||Number(p.limit)<1||Number(p.limit)>100))throw new ContractError();
  const current=await inspect(n);if(!current||current.generation!==n.generation)return {status:'generation_mismatch'};if(current.cwd!==n.cwd)return {status:'workspace_changed'};
  const latest=await readLimits(limitsPath);if(latest.status==='unusable')return {status:'limits_unusable'};
  if(options.compatTest&&(latest.status!=='ok'||latest.hash!==options.testLimitsHash))return {status:'compat_check_limits_changed'};
  const denied=await policy(n,c,latest.status==='ok'?latest.value:unrestricted,'read',s);if(denied)return {status:denied};
  const changedCompatibility=await targetCompatibility(n,latest.status==='ok'?latest.value:unrestricted);if(changedCompatibility)return changedCompatibility;
  return adapter.read(registrations([c,n])[1],{cursor:p.cursor as string|undefined,limit:p.limit as number|undefined});
  }finally{await ownerLookup?.close();}
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
