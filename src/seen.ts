import {readPrivateJson,writePrivateJson} from './limits.ts';
export type Seen={provider:'claude'|'codex';nativeId:string;generation:string;cwd:string;at:number};
export type Change={change:'none'|'generation_changed'|'new'|'unknown';possible_restart_of?:string};
const day=24*60*60*1000;
const key=(n:Pick<Seen,'provider'|'nativeId'>)=>`${n.provider}:${n.nativeId}`;
function valid(value:unknown):value is Seen[]{
 return Array.isArray(value)&&value.every(n=>n&&typeof n==='object'&&Object.keys(n).sort().join(',')==='at,cwd,generation,nativeId,provider'&&['claude','codex'].includes(n.provider)&&['nativeId','generation','cwd'].every(k=>typeof n[k]==='string'&&n[k])&&Number.isFinite(n.at));
}
export async function observeSeen(path:string,sessions:Omit<Seen,'at'>[],now=Date.now()):Promise<{changes:Map<string,Change>;disappeared:Seen[]}>{
 const unknown=()=>({changes:new Map(sessions.map(n=>[key(n),{change:'unknown' as const}])),disappeared:[]});
 for(let attempt=0;attempt<4;attempt++){
  const read=await readPrivateJson(path,valid);if(read.status==='unusable')return unknown();
  const previous=read.status==='ok'?read.value.filter(n=>now-n.at<=day&&n.at<=now):[];
  const active=new Set(sessions.map(key)),changes=new Map<string,Change>();
  const disappeared=previous.filter(n=>!active.has(key(n))&&sessions.some(s=>s.provider===n.provider&&s.cwd===n.cwd));
  for(const n of sessions){
   const old=previous.find(p=>key(p)===key(n));
   const peers=previous.filter(p=>p.provider===n.provider&&p.cwd===n.cwd);
   const missing=disappeared.filter(p=>p.provider===n.provider&&p.cwd===n.cwd);
   changes.set(key(n),old?{change:old.cwd!==n.cwd?'unknown':old.generation===n.generation?'none':'generation_changed'}:{change:peers.length?'new':'unknown',...(missing.length===1?{possible_restart_of:missing[0].nativeId}:{})});
  }
  const next=[...previous.filter(n=>!active.has(key(n))),...sessions.map(n=>({provider:n.provider,nativeId:n.nativeId,generation:n.generation,cwd:n.cwd,at:now}))];
  const written=await writePrivateJson(next,read.hash,path,valid);
  if(written.status==='ok')return {changes,disappeared};
  if(written.status!=='conflict')return unknown();
 }
 return unknown();
}
