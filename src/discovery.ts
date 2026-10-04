import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Registry, permitted } from './registry.ts';
import { TTL_MS, parseQuery } from './protocol.ts';
import type { Observation, Registration, Query } from './protocol.ts';
import type { GitContext } from './git-context.ts';

type Result={status:string;target?:string;binding?:string;candidates?:Candidate[]};
type Candidate={id:string;provider:string;nativeId:string;generation:string;host:string;displayName:string;role?:string;declaredWorkspace:string;operations:{read:boolean;send:boolean};observation:{status:string;reason:string;at:number|null;context:GitContext|null};rank:number|null;inScope:boolean;reason:string};
type Seen={record:Registration;observation:Observation|null;reason:string;rank:number|null;inScope:boolean};
type Binding={id:string;state:'issued'|'checking'|'consumed'|'expired'|'superseded'|'invalid';created:number;query:Query;caller:Registration;target:Registration;callerContext:GitContext;targetContext:GitContext};
type Options={wallNow?:()=>number;monoNow?:()=>number;refresh?:()=>Promise<void>};
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
 constructor(registry:Registry,callerId:string,options:Options={}){
  this.registry=registry;this.callerId=callerId;
  const caller=registry.get(callerId);if(!caller)throw new Error('caller_unavailable');this.callerIdentity=identity(caller);
  this.wallNow=options.wallNow??Date.now;this.monoNow=options.monoNow??(()=>performance.now());this.refreshHook=options.refresh??(async()=>{});
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
  const visible=c.seen!.filter(s=>{const latest=this.registry.get(s.record.id);return latest&&registration(latest)===registration(s.record)&&(!q.role||latest.role===q.role)&&(permitted(latestCaller,latest,'read')||permitted(latestCaller,latest,'send'));});
  return {status:'ok',candidates:visible.map(s=>this.project(latestCaller,s))};
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
