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
import { ContractError, object } from './protocol.ts';
import {securityKeychain} from './secrets.ts';
// The signed request of `--as` comes on standard input, whole. Neither it nor a key is ever an argument (arguments are recorded
// in process listings and in the conversation that ran the command).
const MAX_STDIN_BYTES=262144;
async function readStdin():Promise<string>{
 if(process.stdin.isTTY)throw new ContractError('invalid_arguments');
 const chunks:Buffer[]=[];let size=0;
 for await(const raw of process.stdin){const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);size+=chunk.length;if(size>MAX_STDIN_BYTES)throw new ContractError('invalid_arguments');chunks.push(chunk);}
 return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
}
// The command line is the one entry that reads the real Keychain (src/secrets.ts); every other way of building an automatic is given a reader or none.
export async function runCli(argv:string[],automatic:Automatic=createAutomatic({keychain:securityKeychain()}),limitsPath?:string,stdin:()=>Promise<string>=readStdin):Promise<void>{
 const [mode,...rawArgs]=argv;
 if(mode==='status'){if(!(rawArgs.length===1||rawArgs.length===3&&rawArgs[1]==='--wait'))throw new ContractError('invalid_arguments');const waitSeconds=rawArgs.length===3?Number(rawArgs[2]):0;if(!Number.isFinite(waitSeconds)||waitSeconds<0||waitSeconds>600)throw new ContractError('invalid_arguments');console.log(JSON.stringify(await automatic('send',{track:rawArgs[0],waitSeconds})));return;}
 if(mode==='compat-check'){const ok=rawArgs[0]==='--limits'&&(rawArgs.length===2||rawArgs.length===4&&rawArgs[2]==='--target'&&/^(claude|codex):[A-Za-z0-9-]{1,128}$/.test(rawArgs[3]));if(!ok)throw new ContractError('invalid_arguments');console.log(JSON.stringify(await compatibilityCheck(rawArgs[1],{},{kind:'cli'},rawArgs[3])));return;}
 if(mode==='compat-md'){if(rawArgs.length)throw new ContractError('invalid_arguments');await writeFile(new URL('../specs/202610-everyday-use/compat.md',import.meta.url),compatibilityMarkdown());return;}
 if(mode==='migrate'){if(rawArgs.length!==2&&rawArgs.length!==3||rawArgs[0]!=='--registry'||rawArgs.length===3&&rawArgs[2]!=='--write')throw new ContractError('invalid_arguments');console.log(JSON.stringify(await migrateRegistry(rawArgs[1],rawArgs[2]==='--write',limitsPath)));return;}
 // `bot-send|bot-sessions <registration>`: MVP stand-in for the Bot's own signing (src/bot-sign.ts). The unsigned request comes on
 // standard input (send) and is signed on this Mac, then goes the way `send|sessions --as` goes. There is no bot-read: a Mac conversation is never read for an outside sender.
 // Only the Bot runs these (through its own approved path to this Mac). A Claude, Codex or Grok CLI conversation must not: the result arrives under the Bot's name.
 if(mode==='bot-send'||mode==='bot-sessions'){
  if(rawArgs.length!==1||!/^[a-z0-9-]{1,63}$/.test(rawArgs[0]))throw new ContractError('invalid_arguments');
  const method=mode==='bot-send'?'send':'sessions';
  let input:unknown=null;
  try{if(method==='send')input=JSON.parse(await stdin());}catch{console.log(JSON.stringify({status:'envelope_invalid',reason:'json'}));return;}
  console.log(JSON.stringify(await automatic(method,input,{kind:'cli',external:{name:rawArgs[0],sign:true}})));return;
 }
 // `sessions|read|send --as <registration>`: a registered outside sender (Grok Bot) acts with an envelope it signed.
 if(rawArgs.includes('--as')){
  if(!['sessions','read','send'].includes(mode)||rawArgs.length!==2||rawArgs[0]!=='--as'||!/^[a-z0-9-]{1,63}$/.test(rawArgs[1]))throw new ContractError('invalid_arguments');
  // Reading a Mac conversation is never offered to an outside sender, so `read` needs no request to refuse.
  let input:unknown=null;
  try{if(mode!=='read')input=JSON.parse(await stdin());}catch{console.log(JSON.stringify({status:'envelope_invalid',reason:'json'}));return;}
  console.log(JSON.stringify(await automatic(mode,input,{kind:'cli',external:{name:rawArgs[1]}})));return;
 }
 const native=rawArgs.includes('--native');const args=rawArgs.filter(a=>a!=='--native');
 if(rawArgs.filter(a=>a==='--native').length>1)throw new ContractError('invalid_arguments');
 if(mode==='context'&&!native&&args.length===1){console.log(JSON.stringify(await observeGit(args[0])));return;}
 const includeOffline=mode==='sessions'&&args.includes('--include-offline');
 if(includeOffline){if(args.filter(a=>a==='--include-offline').length!==1||args.includes('--registry'))throw new ContractError('invalid_arguments');args.splice(args.indexOf('--include-offline'),1);}
 if(!args.includes('--registry')){
  if(args.includes('--caller'))throw new ContractError('invalid_arguments');
  if(mode==='mcp'&&(args.length===0||args.length===1&&args[0]==='--panel-only')){await runLines(createMcp({automatic,panelOnly:args.length===1}),()=>({jsonrpc:'2.0',id:null,error:{code:-32700,message:'parse_error'}}));return;}
  if(mode==='serve'&&args.length===0){await runLines(createServe({automatic}));return;}
  if(mode==='limits'){const [action,file,...rest]=args;if(rest.length||!['get','set','clear'].includes(action)||(action==='set'?!file:!!file))throw new ContractError('invalid_arguments');const input=action==='set'?{action,value:JSON.parse(await readFile(file,'utf8'))}:{action};console.log(JSON.stringify(await automatic('limits',input)));return;}
  if(['band','sessions','read','send','select','revalidate'].includes(mode)&&args.length<=1){const input=args.length?JSON.parse(args[0]):{};console.log(JSON.stringify(await automatic(mode,includeOffline?{...object(input,['operation','scope','target','includeOffline','peek']),includeOffline:true}:input)));return;}
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
