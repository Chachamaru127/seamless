import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Registry, permitted } from './registry.ts';
import { TTL_MS, parseQuery } from './protocol.ts';
import type { Observation, Registration, Query } from './protocol.ts';
import type { GitContext } from './git-context.ts';
import { findClaudeInbox } from './adapters/claude.ts';
import type { ClaudeInboxState } from './adapters/claude.ts';
import { homedir } from 'node:os';
import { loadAdapterPort, loadManifestRegistry } from './core/manifest.ts';
import type { ManifestAdapterPeer, ManifestRegistry, ManifestState, ManifestProvider, ProductManifest } from './core/manifest.ts';

type Result={status:string;target?:string;binding?:string;candidates?:Candidate[]};
type Candidate={id:string;provider:string;nativeId:string;generation:string;host:string;displayName:string;role?:string;declaredWorkspace:string;operations:{read:boolean;send:boolean};observation:{status:string;reason:string;at:number|null;context:GitContext|null};rank:number|null;inScope:boolean;reason:string};
type Seen={record:Registration;observation:Observation|null;reason:string;rank:number|null;inScope:boolean};
type Binding={id:string;state:'issued'|'checking'|'consumed'|'expired'|'superseded'|'invalid';created:number;query:Query;caller:Registration;target:Registration;callerContext:GitContext;targetContext:GitContext};
// The three states of Plans.md 3 章. unreachable carries the one reason that says why nothing can be handed over.
export type WhoState='ready'|'next_turn'|'wake_needed'|'unreachable';
export type WhoVerdict={state:WhoState;reason?:string};
// A phase 2 product (Antigravity, S5) is listed as unverified; it is not a v1 manifest provider yet.
export type WhoProvider=ManifestProvider|'antigravity';
// What who has to go on: the scan's own words where they exist, the Claude sessions JSON, and the compatibility table.
export type WhoPeer={id?:string;product?:string;provider:WhoProvider;nativeId:string;displayName?:string;status?:string|null;reason?:string|null;versionStatus?:string|null;inbox?:ClaudeInboxState|null};
export type WhoRow={id:string;provider:WhoProvider;nativeId:string;displayName?:string;state:WhoState;reason?:string;versionStatus:string|null};
// `manifests` is the registration the listing is built from. Without it the v1 manifests are read from src/manifests:
// a product whose manifest is gone is not listed, whether or not the scan still reports it.
export type WhoOptions={home?:string;inbox?:(nativeId:string)=>Promise<ClaudeInboxState>;manifests?:ManifestRegistry};
// The registration is per product, not per provider: one provider may carry two products (a CLI and a Desktop sharing a
// thread store). A scan may name the product itself; otherwise the provider must be claimed by exactly one manifest, or the
// conversation cannot be attributed to an adapter and is not listed (never silently merged into the first product).
export function manifestProduct(manifests:readonly Pick<ProductManifest,'product'|'provider'>[],provider:string,declared?:string|null):string|undefined{
 if(declared)return manifests.some(manifest=>manifest.provider===provider&&manifest.product===declared)?declared:undefined;
 const matches=manifests.filter(manifest=>manifest.provider===provider);
 return matches.length===1?matches[0].product:undefined;
}
// ready         = the write port is open and the peer said it is idle (Claude sessions JSON `status`).
// next_turn     = the peer is working, or its product takes the request at its next turn (hooks, Codex queue).
// wake_needed   = the peer is stopped or unloaded and is woken before it can take anything (Grok Bot, an unloaded Codex thread).
// unreachable   = no write port, or the compatibility table says it waits for a fix. The reason is never guessed from a product name.
// `states` is the product's own state table from its manifest: a native word (idle, busy, revoked, unverified) maps to one
// listing state without the core knowing the product. A word the table does not name falls through to the rules below.
export function whoVerdict(p:WhoPeer,states?:Record<string,ManifestState>):WhoVerdict{
 const unreachable=(reason:string):WhoVerdict=>({state:'unreachable',reason});
 if(p.versionStatus==='fix_required')return unreachable('fix_required');
 if(p.versionStatus==='unverified_desktop')return unreachable('desktop_unavailable');
 const mapped=states&&typeof p.status==='string'?states[p.status]:undefined;
 if(mapped)return {state:mapped,...(mapped==='unreachable'?{reason:p.reason??p.status??'unreachable'}:{})};
 if(p.provider==='claude'){
  // A stopped conversation keeps its last sessions JSON (socket and status), so the process state decides before the record does.
  if(p.status==='offline'||p.reason==='process_exited')return {state:'wake_needed'};
  if(p.inbox?.status==='unreachable')return unreachable(p.inbox.reason);
  if(p.inbox?.status==='reachable')return {state:p.inbox.claudeStatus==='idle'?'ready':'next_turn'};
  return unreachable('no_inbox_socket');
 }
 if(p.provider==='codex'){
  if(p.reason==='unsupported_version')return unreachable('unsupported_version');
  if(p.status==='offline'||p.reason==='process_exited')return {state:'wake_needed'};
  // A changed generation is still a live conversation; the next listing issues a ticket for it.
  if(p.reason==='generation_changed')return {state:'next_turn'};
  // A thread Desktop has not loaded is opened by its link first (sessions-scan wakeCodexThread).
  if(p.reason==='unreachable'||p.status==='unknown')return {state:'wake_needed'};
  // Turn activity is not observed here. The queue write lands at the next turn, so who never claims `ready` for Codex.
  return {state:'next_turn'};
 }
 if(p.provider==='grok'){
  if(p.status==='offline'||p.reason==='process_exited')return {state:'wake_needed'};
  // Two live processes on one conversation (or an unusable version) leave no single place to hand a request to.
  if(p.reason==='unreachable'||p.reason==='unsupported_version')return unreachable(p.reason);
  // A running TUI takes the request at its next turn through its Stop hook.
  return {state:'next_turn'};
 }
 // A revoked registration, or one whose scope its owner left unset, cannot be reached at all.
 if(p.status==='revoked'||p.status==='scope_unset')return unreachable(p.status);
 // A registered Grok Bot has no process or awake marker on this Mac; it is reached by a webhook that wakes it.
 return {state:'wake_needed'};
}
// Rows a manifest's own discovery port answers. The manifest names the export, so the core never knows a product.
async function listedPeers(manifests:ManifestRegistry,home:string):Promise<WhoPeer[]>{
 const out:WhoPeer[]=[];
 for(const manifest of manifests.list()){
  if(!manifest.exports?.list)continue;
  try{
   const port=await loadAdapterPort(manifest,manifests.directory);
   const value=await port.list?.({home});
   const rows=Array.isArray(value)?value:(value&&typeof value==='object'&&Array.isArray((value as {peers?:unknown}).peers)?(value as {peers:unknown[]}).peers:[]);
   for(const item of rows){
    if(!item||typeof item!=='object')continue;
    const row=item as ManifestAdapterPeer&Record<string,unknown>;
    const provider=typeof row.provider==='string'?row.provider:manifest.provider;
    // The manifest's identity field names the product's own spelling of the conversation id (`sessionId`, `id`, ...).
    const identity=row[manifest.identity.id];
    const nativeId=typeof row.nativeId==='string'?row.nativeId:typeof identity==='string'?identity:null;
    if(!nativeId)continue;
    const label=typeof row.displayName==='string'?row.displayName:typeof row.title==='string'?row.title:undefined;
    out.push({id:typeof row.id==='string'?row.id:`${provider}:${nativeId}`,product:manifest.product,provider:provider as WhoProvider,nativeId,...(label?{displayName:label}:{}),status:row.state??row.status??null,reason:row.reason??null,versionStatus:row.versionStatus??null});
   }
  }catch{}
 }
 return out;
}
// The phase 2 declaration stays outside the core manifest set: its provider is not a v1 provider. Who lists it as
// `unverified` only when the product's executable is actually present (S5); doctor answers the same question for setup.
async function phase2Peers(home:string):Promise<{peers:WhoPeer[];states:Record<string,Record<string,ManifestState>>}>{
 try{
  const [{readAntigravityManifest,listAntigravity},{findAntigravity}]=await Promise.all([import('./adapters/antigravity.ts'),import('./setup.ts')]);
  const manifest=await readAntigravityManifest(),found=await findAntigravity(home);
  const peers:WhoPeer[]=listAntigravity({binary:found.binary,hooks:false},manifest).map(row=>({id:row.id,product:'antigravity',provider:'antigravity',nativeId:row.id,displayName:row.displayName,status:row.status,versionStatus:row.versionStatus}));
  return {peers,states:{antigravity:{unverified:'unreachable',absent:'unreachable'}}};
 }catch{return {peers:[],states:{}};}
}
export async function classifyPeers(peers:WhoPeer[],options:WhoOptions={}):Promise<WhoRow[]>{
 // The registry is the list, not the scan: a product whose manifest is gone is not shown, and a product whose manifest
 // names a discovery port is shown even when the scan does not know it. Its own state table gives the listing state.
 const manifests=options.manifests??await loadManifestRegistry(),home=options.home??homedir(),entries=manifests.list();
 const states=new Map<string,Record<string,ManifestState>>();
 for(const manifest of entries)states.set(manifest.product,manifest.states);
 const phase=await phase2Peers(home);
 for(const [product,table] of Object.entries(phase.states))states.set(product,table);
 // A row is kept by its product, not by its provider: one provider can hold two products.
 const known=(p:WhoPeer)=>{const product=p.product??manifestProduct(entries,p.provider);return product!==undefined&&states.has(product)?product:undefined;};
 const rows=new Map<string,WhoPeer>();
 for(const p of peers){const product=known(p);if(product!==undefined)rows.set(p.id??`${p.provider}:${p.nativeId}`,{...p,product});}
 for(const p of [...await listedPeers(manifests,home),...phase.peers]){
  const id=p.id??`${p.provider}:${p.nativeId}`,product=known(p);
  if(product!==undefined&&!rows.has(id))rows.set(id,{...p,product});
 }
 const read=options.inbox??((nativeId:string)=>findClaudeInbox(nativeId,{home:options.home}));
 return Promise.all([...rows.values()].map(async p=>{
  const inbox=p.provider==='claude'?await read(p.nativeId).catch(()=>null):null,verdict=whoVerdict({...p,inbox},states.get(p.product!));
  return {id:p.id??`${p.provider}:${p.nativeId}`,provider:p.provider,nativeId:p.nativeId,...(p.displayName?{displayName:p.displayName}:{}),versionStatus:p.versionStatus??null,...verdict};
 }));
}
type Options={wallNow?:()=>number;monoNow?:()=>number;refresh?:()=>Promise<void>;home?:string;inbox?:(nativeId:string)=>Promise<ClaudeInboxState>};
function identity(r:Registration){return JSON.stringify([r.id,r.provider,r.nativeId,r.generation,r.host]);}
function registration(r:Registration){return JSON.stringify([identity(r),r.role??null,r.workspace,[...r.operations].sort(),r.grants.map(g=>JSON.stringify(g)).sort()]);}
function projectedContext(c:GitContext|null):GitContext|null {
 if(!c)return null;
 if(c.state==='git')return {state:'git',workspace:c.workspace,worktree:c.worktree,repository:c.repository,headState:c.headState,branch:c.branch,head:c.head,dirty:c.dirty};
 if(c.state==='no_git')return {state:'no_git',workspace:c.workspace};
 return {state:'unknown',workspace:c.workspace,reason:c.reason};
}
function contextIdentity(c:GitContext){const p=projectedContext(c)!;if(p.state==='git'){const {dirty,...rest}=p;return JSON.stringify(rest);}return JSON.stringify(p);}
function rank(a:GitContext,b:GitContext,positionOnly=false):number|null {
 if(a.state==='unknown'||b.state==='unknown')return null;
 if(a.state==='no_git'||b.state==='no_git')return a.state==='no_git'&&b.state==='no_git'&&a.workspace===b.workspace?1:3;
 if(a.workspace===b.workspace&&a.worktree===b.worktree&&(positionOnly||a.headState===b.headState&&a.branch===b.branch&&a.head===b.head))return 1;
 return a.repository===b.repository?2:3;
}
function within(rank:number|null,q:Query){return rank!==null&&rank<=({current_work:1,same_repository:2,any_registered:3}[q.scope]);}
export class Discovery {
 private bindings=new Map<string,Binding>();
 private callerIdentity:string;
 private wallNow:()=>number;private monoNow:()=>number;private refreshHook:()=>Promise<void>;
 private registry:Registry;private callerId:string;
 private home:string|undefined;private inbox:WhoOptions['inbox'];
 constructor(registry:Registry,callerId:string,options:Options={}){
  this.registry=registry;this.callerId=callerId;
  const caller=registry.get(callerId);if(!caller)throw new Error('caller_unavailable');this.callerIdentity=identity(caller);
  this.wallNow=options.wallNow??Date.now;this.monoNow=options.monoNow??(()=>performance.now());this.refreshHook=options.refresh??(async()=>{});
  this.home=options.home;this.inbox=options.inbox;
 }
 private async refresh(){try{await this.refreshHook();}catch{return 'registry_unavailable';}const c=this.registry.get(this.callerId);return !c||identity(c)!==this.callerIdentity?'caller_unavailable':null;}
 private reason(record:Registration,o:Observation|null):string {
  if(!o||!o.source)return 'unknown';const now=this.wallNow();
  if(!Number.isFinite(o.observedAt)||o.observedAt>now)return 'invalid_observation';
  if(now-o.observedAt>TTL_MS)return 'stale';
  const matches=o.nativeId===record.nativeId&&o.generation===record.generation;
  if(matches&&o.status==='offline')return 'offline';
  if(!Number.isFinite(o.contextObservedAt)||o.contextObservedAt>now)return 'invalid_observation';
  if(now-o.contextObservedAt>TTL_MS)return 'stale';
  if(!matches)return 'generation_mismatch';
  if(o.status!=='online'||!o.cwd||!o.context||o.context.state==='unknown')return 'unknown';
  return 'ready';
 }
 private opaque(reason:string){return ['unknown','stale','invalid_observation'].includes(reason);}
 private async collect(q:Query,selection=false){
  const error=await this.refresh();if(error)return {error};
  const caller=this.registry.get(this.callerId)!;
  const records=this.registry.list().filter(t=>t.id!==caller.id&&t.host===caller.host&&(permitted(caller,t,'read')||permitted(caller,t,'send'))&&(!q.target||t.id===q.target)&&(!q.role||t.role===q.role)&&(!selection||permitted(caller,t,q.operation)));
  const callerObservation=await this.registry.observe(caller),callerReason=this.reason(caller,callerObservation);
  const seen:Seen[]=[];
  for(const record of records){
   const o=await this.registry.observe(record),reason=this.reason(record,o);
   const r=callerReason==='ready'&&reason!=='offline'&&!this.opaque(reason)&&o?.context&&callerObservation?.context?rank(callerObservation.context,o.context,reason==='generation_mismatch'):null;
   seen.push({record,observation:o,reason,rank:r,inScope:within(r,q)});
  }
  return {caller,callerObservation,callerReason,seen};
 }
 private project(caller:Registration,s:Seen):Candidate {
  const r=s.record,o=s.observation;
  return {id:r.id,provider:r.provider,nativeId:r.nativeId,generation:r.generation,host:r.host,displayName:r.displayName,...(r.role?{role:r.role}:{}),declaredWorkspace:r.workspace,operations:{read:permitted(caller,r,'read'),send:permitted(caller,r,'send')},observation:{status:s.reason==='ready'?'online':s.reason==='offline'?'offline':'unknown',reason:s.reason,at:o&&Number.isFinite(o.observedAt)?o.observedAt:null,context:this.opaque(s.reason)||s.reason==='offline'?null:projectedContext(o?.context??null)},rank:s.rank,inScope:s.inScope,reason:s.reason!=='ready'?s.reason:s.inScope?'ready':'scope_conflict'};
 }
 async sessions(input:unknown):Promise<{status:string;candidates:Candidate[]}>{
  const q=parseQuery(input),c=await this.collect(q);if(c.error)return {status:c.error,candidates:[]};
  const error=await this.refresh();if(error)return {status:error,candidates:[]};
  const latestCaller=this.registry.get(this.callerId)!;
  const visible=this.visible(q,c.seen!,latestCaller);
  return {status:'ok',candidates:visible.map(s=>this.project(latestCaller,s))};
 }
 // who lists the same peers sessions lists and says how each one can take a request. It is read-only: no binding, no write.
 async who(input:unknown):Promise<{status:string;peers:WhoRow[]}>{
  const q=parseQuery(input),c=await this.collect(q);if(c.error)return {status:c.error,peers:[]};
  const error=await this.refresh();if(error)return {status:error,peers:[]};
  const latestCaller=this.registry.get(this.callerId)!;
  const visible=this.visible(q,c.seen!,latestCaller);
  const peers=await classifyPeers(visible.map(s=>({id:s.record.id,provider:s.record.provider,nativeId:s.record.nativeId,displayName:s.record.displayName,status:s.reason==='ready'?'online':s.reason==='offline'?'offline':'unknown',reason:s.reason})),{home:this.home,inbox:this.inbox});
  return {status:'ok',peers};
 }
 // A registration seen at the start is listed only while it is still the same registration and this caller may still reach it.
 private visible(q:Query,seen:Seen[],latestCaller:Registration):Seen[]{
  return seen.filter(s=>{const latest=this.registry.get(s.record.id);return latest&&registration(latest)===registration(s.record)&&(!q.role||latest.role===q.role)&&(permitted(latestCaller,latest,'read')||permitted(latestCaller,latest,'send'));});
 }
 async select(input:unknown):Promise<Result>{
  const q=parseQuery(input);
  const initialError=await this.refresh();if(initialError)return {status:initialError};
  if(q.target===this.callerId)return {status:'self_target'};
  if(q.target){const caller=this.registry.get(this.callerId)!,target=this.registry.get(q.target);
   if(!target||target.host!==caller.host||!(permitted(caller,target,'read')||permitted(caller,target,'send')))return {status:'target_unavailable'};
   if(q.role&&target.role!==q.role)return {status:'role_mismatch'};
   if(!permitted(caller,target,q.operation))return {status:'operation_not_permitted'};
  }
  const c=await this.collect(q,true);if(c.error)return {status:c.error};
  let seen=c.seen!;const participants=seen;const caller=c.caller!;
  if(q.target&&!seen.length)return {status:'target_unavailable'};
  if(q.target&&q.role&&seen[0].record.role!==q.role)return {status:'role_mismatch'};
  if(q.target&&!permitted(caller,seen[0].record,q.operation))return {status:'operation_not_permitted'};
  seen=seen.filter(s=>permitted(caller,s.record,q.operation)&&(!q.role||s.record.role===q.role));
  if(!seen.length)return {status:'no_candidates'};
  if(c.callerReason!=='ready')return {status:'caller_unobserved'};
  if(q.target&&seen[0]?.reason==='offline')return {status:'offline'};
  seen=seen.filter(s=>s.reason!=='offline');
  if(seen.some(s=>this.opaque(s.reason)||s.rank===null))return {status:'blocked_unobserved'};
  if(q.target&&seen.length&& !seen[0].inScope)return {status:'scope_conflict'};
  seen=seen.filter(s=>s.inScope);
  if(!seen.length)return {status:'no_candidates'};
  const best=Math.min(...seen.map(s=>s.rank!)),top=seen.filter(s=>s.rank===best);
  if(top.some(s=>s.reason!=='ready'))return {status:'blocked_unobserved'};
  if(top.length!==1)return {status:'ambiguous'};
  const target=top[0],error=await this.refresh();if(error)return {status:error};
  const latestCaller=this.registry.get(caller.id),latestTarget=this.registry.get(target.record.id);
  if(!latestCaller||!latestTarget||registration(latestCaller)!==registration(caller)||registration(latestTarget)!==registration(target.record)||!permitted(latestCaller,latestTarget,q.operation))return {status:'registration_changed'};
  const latestParticipants=this.registry.list().filter(t=>t.id!==latestCaller.id&&t.host===latestCaller.host&&permitted(latestCaller,t,q.operation)&&(!q.target||t.id===q.target)&&(!q.role||t.role===q.role));
  if(latestParticipants.length!==participants.length||participants.some(s=>{const latest=latestParticipants.find(t=>t.id===s.record.id);return !latest||registration(latest)!==registration(s.record);}))return {status:'registration_changed'};
  if(this.reason(caller,c.callerObservation!)!=='ready'||participants.some(s=>this.opaque(this.reason(s.record,s.observation)))||this.reason(target.record,target.observation)!=='ready')return {status:'blocked_unobserved'};
  for(const [id,b] of this.bindings){if(this.monoNow()-b.created>TTL_MS)this.bindings.delete(id);else if(b.target.id===target.record.id&&(b.state==='issued'||b.state==='checking'))b.state='superseded';}
  const id=randomUUID();this.bindings.set(id,{id,state:'issued',created:this.monoNow(),query:q,caller,target:target.record,callerContext:structuredClone(c.callerObservation!.context),targetContext:structuredClone(target.observation!.context)});
  return {status:'selected',target:target.record.id,binding:id};
 }
 async revalidate(id:string):Promise<Result>{
  const b=this.bindings.get(id);if(!b)return {status:'invalid_binding'};if(b.state!=='issued')return {status:b.state};if(this.monoNow()-b.created>TTL_MS){b.state='expired';return {status:'expired'};}
  b.state='checking';
  const reject=(status='invalid')=>{if(b.state==='checking')b.state=status==='expired'?'expired':'invalid';return {status:b.state==='invalid'?status:b.state};};
  let error=await this.refresh();if(error)return reject(error);
  let caller=this.registry.get(b.caller.id),target=this.registry.get(b.target.id);
  const valid=()=>!!caller&&!!target&&registration(caller)===registration(b.caller)&&registration(target)===registration(b.target)&&permitted(caller,target,b.query.operation);
  if(!valid())return reject();
  const co=await this.registry.observe(caller!),to=await this.registry.observe(target!);
  error=await this.refresh();if(error)return reject(error);
  caller=this.registry.get(b.caller.id);target=this.registry.get(b.target.id);
  if(b.state!=='checking')return {status:b.state};
  if(this.monoNow()-b.created>TTL_MS)return reject('expired');
  if(!valid()||this.reason(caller!,co)!=='ready'||this.reason(target!,to)!=='ready'||contextIdentity(co!.context)!==contextIdentity(b.callerContext)||contextIdentity(to!.context)!==contextIdentity(b.targetContext))return reject();
  b.state='consumed';return {status:'validated',target:b.target.id};
 }
}
