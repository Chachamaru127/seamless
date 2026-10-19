import { readFileSync } from 'node:fs';
import { peersOf, companiesOf, companyName, latest } from './status-exchanges.ts';
import { logoSvg } from '../mods/seamless-band/hooks/appearance.ts';
import { printable } from '../mods/seamless-band/hooks/text.ts';

export const statusResource = {uri:'ui://seamless/status',name:'seamless-status',mimeType:'text/html;profile=mcp-app'};
export const statusPanelTool = {
 name:'status_panel',title:'seamless の状態',
 description:'Codex の会話の右パネルに、seamless のやりとりの状態を出す（読み取りだけ）',
 inputSchema:{type:'object',properties:{},additionalProperties:false},
 annotations:{readOnlyHint:true,openWorldHint:false},
 _meta:{ui:{resourceUri:statusResource.uri,visibility:['app']},'ui/resourceUri':statusResource.uri,'openai/ui':{entrypoints:[{type:'thread'}]}}
};
export const statusHtml = readFileSync(new URL('./status-panel.html',import.meta.url),'utf8')
 .replace('<!-- CODEX -->',logoSvg('codex','currentColor').replace(/ xmlns="[^"]*"/,''))
 .replace('<!-- CLAUDE -->',logoSvg('claude','currentColor').replace(/ xmlns="[^"]*"/,''));

export function summarizeStatus(data:Record<string,any>) {
 const observedAt=new Date().toISOString();
 if(data.status!=='ok')return {status:data.status,reason:data.reason??data.status,caller:null,companies:[],peers:[],observedAt};
 const peers=peersOf(JSON.stringify(data));
 return {
  status:data.status,
  caller:{provider:data.caller.provider,nativeIdShort:data.caller.nativeId.slice(0,8),source:data.caller.source,version:data.caller.version,versionStatus:data.caller.versionStatus},
  companies:companiesOf(peers).map(c=>({name:companyName(c.provider),count:c.count,color:c.color})),
  peers:peers.map(p=>{
   const state=latest(p.exchanges);
   const candidate=data.candidates.find((c:Record<string,unknown>)=>c.provider===p.provider&&c.nativeId===p.nativeId);
   return {provider:p.provider,nativeIdShort:p.nativeId.slice(0,8),folder:printable(p.cwd,10000).split(/[\\/]/).filter(Boolean).pop()??'',status:candidate?.status??'unknown',latest:{label:state.label,color:state.color}};
  }),observedAt
 };
}

// Injected into createMcp by the internal entry (scripts/mcp-panel.ts), so the published src/mcp.ts has no import of this file.
export const statusPanel = { tool: statusPanelTool, resource: statusResource, html: statusHtml, summarize: summarizeStatus };
