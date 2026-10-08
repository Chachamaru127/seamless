import type { GitContext } from './git-context.ts';
export const TTL_MS=60_000;
export const MAX_INPUT_BYTES=65_536;
export type Operation='read'|'send';
export type Scope='current_work'|'same_repository'|'any_registered';
export type Grant={peer:string;operation:Operation;direction:'inbound'|'outbound'};
export type Registration={id:string;provider:'codex'|'claude'|'grok';nativeId:string;generation:string;host:string;displayName:string;role?:string;workspace:string;operations:Operation[];grants:Grant[]};
export type Observation={nativeId:string;generation:string;status:'online'|'offline'|'unknown';observedAt:number;contextObservedAt:number;source:string;gitSource?:string;cwd:string;context:GitContext};
export type Query={operation:Operation;scope:Scope;role?:string;target?:string};
export class ContractError extends Error { constructor(code='invalid_params'){super(code);this.name='ContractError';} }
export function object(value:unknown,keys:string[],code='invalid_params'):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ContractError(code);
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!keys.includes(k)))throw new ContractError(code);
 return v;
}
function text(v:unknown):v is string{return typeof v==='string'&&v.length>0&&v.length<=4096;}
function operation(v:unknown):v is Operation{return v==='read'||v==='send';}
export function parseQuery(value:unknown):Query {
 const v=object(value,['operation','scope','role','target']);
 if(!operation(v.operation)||v.scope!==undefined&&!['current_work','same_repository','any_registered'].includes(v.scope as string)||v.role!==undefined&&!text(v.role)||v.target!==undefined&&!text(v.target))throw new ContractError();
 return {operation:v.operation,scope:(v.scope??'current_work') as Scope,...(v.role===undefined?{}:{role:v.role as string}),...(v.target===undefined?{}:{target:v.target as string})};
}
export function parseBootstrap(value:unknown):Registration[]{
 const code='bootstrap_invalid',v=object(value,['sessions'],code);
 if(!Array.isArray(v.sessions)||v.sessions.length>1000)throw new ContractError(code);
 const ids=new Set<string>(),natives=new Set<string>();
 return v.sessions.map(value=>{
  const s=object(value,['id','provider','nativeId','generation','host','displayName','role','workspace','operations','grants'],code);
  for(const k of ['id','nativeId','generation','host','displayName','workspace'])if(!text(s[k]))throw new ContractError(code);
  if(!['codex','claude'].includes(s.provider as string)||s.role!==undefined&&!text(s.role)||!Array.isArray(s.operations)||s.operations.some(x=>!operation(x))||new Set(s.operations).size!==s.operations.length||!Array.isArray(s.grants)||s.grants.length>4000)throw new ContractError(code);
  const native=JSON.stringify([s.provider,s.host,s.nativeId]);if(ids.has(s.id as string)||natives.has(native))throw new ContractError(code);ids.add(s.id as string);natives.add(native);
  const grants=s.grants.map(g=>{const x=object(g,['peer','operation','direction'],code);if(!text(x.peer)||x.peer===s.id||!operation(x.operation)||!['inbound','outbound'].includes(x.direction as string))throw new ContractError(code);return x as Grant;});
  return {...s,grants} as Registration;
 });
}
export function safeParseJSON(line:string,code='invalid_request'):unknown {
 if(Buffer.byteLength(line)>MAX_INPUT_BYTES)throw new ContractError(code);
 try{return JSON.parse(line);}catch{throw new ContractError(code);}
}
