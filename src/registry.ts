import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { Registration, Observation, Operation } from './protocol.ts';
import { ContractError, MAX_INPUT_BYTES, parseBootstrap, safeParseJSON } from './protocol.ts';
export type Observer=(registration:Registration)=>Promise<Observation|null>;
export class Registry {
 private records=new Map<string,Registration>();
 observer:Observer;
 constructor(records:Registration[],observer:Observer=async()=>null){this.observer=observer;this.replace(records);}
 replace(records:Registration[]){this.records=new Map(records.map(s=>[s.id,structuredClone(s)]));}
 get(id:string){const r=this.records.get(id);return r?structuredClone(r):undefined;}
 list(){return [...this.records.values()].map(r=>structuredClone(r));}
 async observe(record:Registration){try{return await this.observer(structuredClone(record));}catch{return null;}}
}
export function permitted(caller:Registration,target:Registration,operation:Operation):boolean {
 return caller.operations.includes(operation)&&target.operations.includes(operation)&&caller.grants.some(g=>g.peer===target.id&&g.operation===operation&&g.direction==='outbound')&&target.grants.some(g=>g.peer===caller.id&&g.operation===operation&&g.direction==='inbound');
}
export async function loadRegistry(path:string):Promise<Registration[]>{
 let file;
 try{
  file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=await file.stat();
  if(!stat.isFile()||(stat.mode&0o777)!==0o600||stat.size>MAX_INPUT_BYTES)throw new ContractError('bootstrap_invalid');
  const buffer=Buffer.alloc(MAX_INPUT_BYTES+1);let used=0;
  while(used<buffer.length){const {bytesRead}=await file.read(buffer,used,buffer.length-used,null);if(!bytesRead)break;used+=bytesRead;}
  if(used>MAX_INPUT_BYTES)throw new ContractError('bootstrap_invalid');
  return parseBootstrap(safeParseJSON(buffer.subarray(0,used).toString('utf8'),'bootstrap_invalid'));
 }catch{throw new ContractError('bootstrap_invalid');}finally{await file?.close();}
}
