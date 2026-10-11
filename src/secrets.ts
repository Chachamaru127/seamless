import {execFile} from 'node:child_process';

// Where the values behind a registration's variable names (peers.json holds only the names) come from: the process environment when
// it holds a non-empty value, otherwise the macOS Keychain (a generic password, service "seamless", account = the variable's name).
// Every reader of an address or a key goes through here, so the order is decided in one place. A failed lookup is "no value": no
// reader ever throws, and no value, part of a value or system message leaves this file except as the returned value itself.
export type SecretReader=(name:string)=>Promise<string|undefined>;
export type KeychainReader=(name:string)=>Promise<string|null>;
export type RunForStdout=(file:string,args:string[],timeoutMs:number)=>Promise<string>;
export const SECURITY_PATH='/usr/bin/security';
export const KEYCHAIN_SERVICE='seamless';
export const KEYCHAIN_TIMEOUT_MS=5000;
const NAME=/^[A-Z_][A-Z0-9_]{0,127}$/;
export const noKeychain:KeychainReader=async()=>null;
// Runs a command and resolves with its standard output only. The error carries no output, command line or system message, so a
// failed lookup cannot print what it was looking for. Standard input is closed at once so the command never waits on it.
export const runForStdout:RunForStdout=(file,args,timeoutMs)=>new Promise((resolve,reject)=>{
 try{
  const child=execFile(file,args,{timeout:timeoutMs,killSignal:'SIGKILL',maxBuffer:65536,encoding:'utf8',windowsHide:true},(error,stdout)=>error?reject(new Error('command_failed')):resolve(stdout));
  child.stdin?.end();
 }catch{reject(new Error('command_failed'));}
});
// `security find-generic-password -s seamless -a <name> -w` prints the value and one line break on standard output. The name goes in
// the arguments, the value never does. The binary is fixed (not looked up on PATH) and the run function is a parameter so a test
// never reaches the real Keychain.
export function securityKeychain(run:RunForStdout=runForStdout):KeychainReader{
 return async name=>{
  if(!NAME.test(name))return null;
  let out:string;
  try{out=await run(SECURITY_PATH,['find-generic-password','-s',KEYCHAIN_SERVICE,'-a',name,'-w'],KEYCHAIN_TIMEOUT_MS);}catch{return null;}
  const value=out.endsWith('\n')?out.slice(0,-1):out;
  return value===''?null:value;
 };
}
// Only the name that is asked for is looked at, in the environment and in the Keychain. The environment is read afresh at every look; a
// Keychain lookup is kept for the life of the reader, which is one call of the tool, so one send runs one lookup per name instead of
// one per look (each is a process start) and a lookup that failed stays failed for that call.
export function secretReader(env:NodeJS.ProcessEnv,keychain:KeychainReader):SecretReader{
 const looked=new Map<string,Promise<string|undefined>>();
 const fromKeychain=(name:string)=>{
  let value=looked.get(name);
  if(!value){value=(async()=>{try{const v=await keychain(name);return typeof v==='string'&&v!==''?v:undefined;}catch{return undefined;}})();looked.set(name,value);}
  return value;
 };
 return async name=>{
  const fromEnv=env[name];
  return typeof fromEnv==='string'&&fromEnv!==''?fromEnv:fromKeychain(name);
 };
}
