import {createAutomatic,type AutomaticOptions,type Automatic} from './automatic.ts';
import { Delivery } from './delivery.ts';
import type { NativeAdapter } from './delivery.ts';
import { Discovery } from './discovery.ts';
import { Registry } from './registry.ts';
import { ContractError, object } from './protocol.ts';
export type Response={id:string|number|null;result?:unknown;error?:{code:string}};
export function createServe(options:{registry?:Registry;caller?:string;automatic?:Automatic;autoOptions?:AutomaticOptions;clock?:{wallNow:()=>number;monoNow:()=>number};refresh?:()=>Promise<void>;adapter?:NativeAdapter}={}) {
 const legacy=options.registry&&options.caller;const automatic=legacy?null:options.automatic??createAutomatic(options.autoOptions);
 const discovery=legacy?new Discovery(options.registry!,options.caller!,{...options.clock,refresh:options.refresh}):null;
 const delivery=legacy&&options.adapter?new Delivery(options.registry!,options.caller!,options.adapter,{refresh:options.refresh}):null;
 return async (input:unknown):Promise<Response>=>{
  let id:string|number|null=null;
  try{
   const r=object(input,['id','method','params'],'invalid_request');
   if((typeof r.id!=='string'&&typeof r.id!=='number')||typeof r.method!=='string')throw new ContractError('invalid_request');id=r.id;
   const respond=(result:{status:string})=>['registry_unavailable','caller_unavailable'].includes(result.status)?{id,error:{code:result.status}}:{id,result};
   if(automatic)return respond(await automatic(r.method,r.params));
   if(delivery&&r.method==='read')return respond(await delivery.read(r.params) as {status:string});
   if(delivery&&r.method==='send')return respond(await delivery.send(r.params) as {status:string});
   if(r.method==='sessions')return respond(await discovery!.sessions(r.params));
   if(r.method==='select')return respond(await discovery!.select(r.params));
   if(r.method==='revalidate'){const p=object(r.params,['binding']);if(typeof p.binding!=='string'||!p.binding)throw new ContractError();return respond(await discovery!.revalidate(p.binding));}
   throw new ContractError('unknown_method');
  }catch(error){return {id,error:{code:error instanceof ContractError?error.message:'request_failed'}};}
 };
}
