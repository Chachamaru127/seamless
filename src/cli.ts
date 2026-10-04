import {compatibilityCheck} from './compat-check.ts';
import {compatibilityMarkdown} from './compat.ts';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createAutomatic,migrateRegistry,type Automatic} from './automatic.ts';
import { createNativeRuntime } from './native-runtime.ts';
import { Registry, loadRegistry } from './registry.ts';
import { Discovery } from './discovery.ts';
import { observeGit } from './git-context.ts';
import { createServe } from './serve.ts';
import { createMcp } from './mcp.ts';
import { runLines } from './io.ts';
import { ContractError } from './protocol.ts';
export async function runCli(argv:string[],automatic:Automatic=createAutomatic(),limitsPath?:string):Promise<void>{
 const [mode,...rawArgs]=argv;
 if(mode==='status'){if(!(rawArgs.length===1||rawArgs.length===3&&rawArgs[1]==='--wait'))throw new ContractError('invalid_arguments');const waitSeconds=rawArgs.length===3?Number(rawArgs[2]):0;if(!Number.isFinite(waitSeconds)||waitSeconds<0||waitSeconds>600)throw new ContractError('invalid_arguments');console.log(JSON.stringify(await automatic('send',{track:rawArgs[0],waitSeconds})));return;}
 if(mode==='compat-check'){const ok=rawArgs[0]==='--limits'&&(rawArgs.length===2||rawArgs.length===4&&rawArgs[2]==='--target'&&/^(claude|codex):[A-Za-z0-9-]{1,128}$/.test(rawArgs[3]));if(!ok)throw new ContractError('invalid_arguments');console.log(JSON.stringify(await compatibilityCheck(rawArgs[1],{},{kind:'cli'},rawArgs[3])));return;}
 if(mode==='compat-md'){if(rawArgs.length)throw new ContractError('invalid_arguments');await writeFile(new URL('../specs/202610-everyday-use/compat.md',import.meta.url),compatibilityMarkdown());return;}
 if(mode==='migrate'){if(rawArgs.length!==2&&rawArgs.length!==3||rawArgs[0]!=='--registry'||rawArgs.length===3&&rawArgs[2]!=='--write')throw new ContractError('invalid_arguments');console.log(JSON.stringify(await migrateRegistry(rawArgs[1],rawArgs[2]==='--write',limitsPath)));return;}
 const native=rawArgs.includes('--native');const args=rawArgs.filter(a=>a!=='--native');
 if(rawArgs.filter(a=>a==='--native').length>1)throw new ContractError('invalid_arguments');
 if(mode==='context'&&!native&&args.length===1){console.log(JSON.stringify(await observeGit(args[0])));return;}
 if(!args.includes('--registry')){
  if(args.includes('--caller'))throw new ContractError('invalid_arguments');
  if(mode==='mcp'&&args.length===0){await runLines(createMcp({automatic}),()=>({jsonrpc:'2.0',id:null,error:{code:-32700,message:'parse_error'}}));return;}
  if(mode==='serve'&&args.length===0){await runLines(createServe({automatic}));return;}
  if(mode==='limits'){const [action,file,...rest]=args;if(rest.length||!['get','set','clear'].includes(action)||(action==='set'?!file:!!file))throw new ContractError('invalid_arguments');const input=action==='set'?{action,value:JSON.parse(await readFile(file,'utf8'))}:{action};console.log(JSON.stringify(await automatic('limits',input)));return;}
  if(['sessions','read','send','select','revalidate'].includes(mode)&&args.length<=1){const input=args.length?JSON.parse(args[0]):{};console.log(JSON.stringify(await automatic(mode,input)));return;}
  throw new ContractError('invalid_arguments');
 }
 if(!['sessions','serve','mcp'].includes(mode)||args.length!==4)throw new ContractError('invalid_arguments');
 const flags=new Map<string,string>();for(let i=0;i<args.length;i+=2){if(!['--registry','--caller'].includes(args[i])||flags.has(args[i]))throw new ContractError('invalid_arguments');flags.set(args[i],args[i+1]);}
 const path=flags.get('--registry'),caller=flags.get('--caller');if(!path||!caller)throw new ContractError('invalid_arguments');
 const runtime=native?createNativeRuntime():undefined;
 const registry=new Registry(await loadRegistry(path),runtime?.observer);
 if(!registry.get(caller))throw new ContractError('caller_unavailable');
 const refresh=async()=>{registry.replace(await loadRegistry(path));};
 if(mode==='sessions'){console.log(JSON.stringify(await new Discovery(registry,caller,{refresh}).sessions({operation:'send'})));return;}
 if(mode==='serve')await runLines(createServe({registry,caller,refresh,adapter:runtime?.adapter}));
 else await runLines(createMcp({registry,caller,refresh,adapter:runtime?.adapter}),()=>({jsonrpc:'2.0',id:null,error:{code:-32700,message:'parse_error'}}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runCli(process.argv.slice(2)).catch(e=>{process.stderr.write(JSON.stringify({error:{code:e instanceof ContractError?e.message:'startup_failed'}})+'\n');process.exitCode=1;});
