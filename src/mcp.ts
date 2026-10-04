import { statusPanelTool, statusResource, summarizeStatus, statusHtml } from './status-panel.ts';
import {createAutomatic,type AutomaticOptions,type Automatic} from './automatic.ts';
import { Delivery } from './delivery.ts';
import type { NativeAdapter } from './delivery.ts';
import { Discovery } from './discovery.ts';
import { Registry } from './registry.ts';
import { ContractError, object } from './protocol.ts';
const schema={type:'object',properties:{operation:{type:'string',enum:['read','send']},scope:{type:'string',enum:['current_work','same_repository','any_registered']},role:{type:'string'},target:{type:'string'}},required:['operation'],additionalProperties:false};
// MCP 2025-06-18 PaginatedRequest: cursor is a string, _meta an object whose progressToken is a string or number.
function listParams(value:unknown):void{
 const p=object(value,['cursor','_meta']);
 if(p.cursor!==undefined&&typeof p.cursor!=='string')throw new ContractError();
 if(p._meta===undefined)return;
 if(!p._meta||typeof p._meta!=='object'||Array.isArray(p._meta))throw new ContractError();
 const token=(p._meta as Record<string,unknown>).progressToken;
 if(token!==undefined&&typeof token!=='string'&&typeof token!=='number')throw new ContractError();
}
export function createMcp(options:{registry?:Registry;caller?:string;refresh?:()=>Promise<void>;adapter?:NativeAdapter;automatic?:Automatic;autoOptions?:AutomaticOptions}={}){
 const legacy=options.registry&&options.caller;const automatic=legacy?null:options.automatic??createAutomatic(options.autoOptions);
 const discovery=legacy?new Discovery(options.registry!,options.caller!,{refresh:options.refresh}):null;const delivery=legacy&&options.adapter?new Delivery(options.registry!,options.caller!,options.adapter,{refresh:options.refresh}):null;let initialized=false,ready=false;
 return async(input:unknown):Promise<unknown|undefined>=>{
  let id:string|number|null=null,notification=false;
  const error=(code:number,message:string)=>({jsonrpc:'2.0',id,error:{code,message}});
  try{
   const r=object(input,['jsonrpc','id','method','params'],'invalid_request');
   if(r.jsonrpc!=='2.0'||typeof r.method!=='string'||r.id!==undefined&&r.id!==null&&typeof r.id!=='string'&&typeof r.id!=='number')return error(-32600,'invalid_request');
   notification=r.id===undefined;id=(r.id??null) as string|number|null;
   if(r.method==='notifications/initialized'){if(!notification)return error(-32600,'invalid_request');if(r.params!==undefined)object(r.params,['_meta']);if(initialized)ready=true;return undefined;}
   if(notification)return undefined;
   let result:unknown;
   if(r.method==='initialize'){
    const p=object(r.params,['protocolVersion','capabilities','clientInfo','_meta']);if(typeof p.protocolVersion!=='string')throw new ContractError();
    initialized=true;ready=false;result={protocolVersion:'2025-06-18',capabilities:{tools:{},...(automatic?{resources:{}}:{})},serverInfo:{name:'seamless',version:'0.1.0'}};
   }else if(!ready)return error(-32000,'not_initialized');
   else if(r.method==='ping')result={};
   else if(r.method==='resources/list'&&automatic){if(r.params!==undefined)listParams(r.params);result={resources:[statusResource]};}
   else if(r.method==='resources/read'&&automatic){const p=object(r.params,['uri','_meta']);if(typeof p.uri!=='string')throw new ContractError();if(p.uri!==statusResource.uri)return error(-32002,'resource_not_found');result={contents:[{uri:statusResource.uri,mimeType:statusResource.mimeType,text:statusHtml}]};}
   else if(r.method==='resources/templates/list'&&automatic){if(r.params!==undefined)listParams(r.params);result={resourceTemplates:[]};}
   else if(r.method==='tools/list'&&automatic){if(r.params!==undefined)listParams(r.params);result={tools:[...automaticTools,statusPanelTool]};}
   else if(r.method==='tools/list'){if(r.params!==undefined)listParams(r.params);result={tools:[{name:'sessions',annotations:{readOnlyHint:true,destructiveHint:false},description:'List explicitly registered and mutually permitted sessions. Selection reflects registered native observations and mutual permissions.',inputSchema:schema},...(delivery?['read','send'].map(name=>({name,annotations:{readOnlyHint:name==='read',destructiveHint:false},description:name==='read'?'Read permitted native visible conversation.':'Send peer-origin request to the selected existing conversation.',inputSchema:{type:'object',properties:{target:{type:'string'},scope:{type:'string',enum:['current_work','same_repository','any_registered']},...(name==='read'?{cursor:{type:'string'},limit:{type:'integer',minimum:1,maximum:100}}:{id:{type:'string'},text:{type:'string'},replyTo:{type:'string'}})},required:name==='send'?['id','text']:[],additionalProperties:false}})):[])]};}
   else if(r.method==='tools/call'){
    const p=object(r.params,['name','arguments','_meta']);if(automatic&&p.name==='status_panel'){object(p.arguments===undefined?{}:p.arguments,[]);const value=await automatic('sessions',{scope:'any',peek:true},{kind:'mcp',meta:p._meta});result={content:[],structuredContent:summarizeStatus(value)};}else if(automatic){if(!['sessions','read','send','limits'].includes(p.name as string))return error(-32602,'unknown_tool');const value=await automatic(p.name as string,p.arguments,{kind:'mcp',meta:p._meta});result={content:[{type:'text',text:JSON.stringify(value)}],isError:!['ok','absent','empty','submitted','wait_limit'].includes(value.status)};}else if(p.name==='sessions'){const sessions=await discovery!.sessions(p.arguments);result={content:[{type:'text',text:JSON.stringify(sessions)}],isError:sessions.status!=='ok'};}else if(delivery&&(p.name==='read'||p.name==='send')){const value=p.name==='read'?await delivery.read(p.arguments):await delivery.send(p.arguments);const status=(value as {status?:string})?.status;result={content:[{type:'text',text:JSON.stringify(value)}],isError:!['ok','empty','submitted'].includes(status??'')};}else return error(-32602,'unknown_tool');
   }else return error(-32601,'unknown_method');
   return {jsonrpc:'2.0',id,result};
  }catch(e){if(notification)return undefined;return error(e instanceof ContractError?-32602:-32603,e instanceof ContractError?'invalid_params':'request_failed');}
 };
}

const scopeSchema={type:'string',enum:['current_work','same_repository','any']};
const automaticTools=['sessions','read','send','limits'].map(name=>({name,description:({sessions:'List active sessions without reading conversation bodies.',read:'Read a discovered conversation.',send:'Send to the exact session selected by its ticket.',limits:'Get, replace or clear optional restrictions.'} as Record<string,string>)[name],inputSchema:{type:'object',additionalProperties:false,properties:name==='limits'?{action:{type:'string',enum:['get','set','clear']},value:{type:'object'}}:name==='send'?{track:{type:'string'},waitSeconds:{type:'number',minimum:0,maximum:600},ticket:{type:'string'},id:{type:'string'},text:{type:'string'},replyTo:{type:'string'},scope:scopeSchema}:name==='read'?{target:{type:'string'},cursor:{type:'string'},limit:{type:'integer',minimum:1,maximum:100},scope:scopeSchema}:{includeOffline:{type:'boolean'},operation:{type:'string',enum:['read','send']},target:{type:'string'},scope:scopeSchema},required:name==='limits'?['action']:[]}}));
