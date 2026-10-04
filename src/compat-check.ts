import {realpath,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {readLimits} from './limits.ts';
import {createAutomatic,type AutomaticOptions,type CallContext} from './automatic.ts';
// This entry can only list and read. Its candidate count is checked again on every read.
// target narrows the test pair to the caller and one named conversation, so no other conversation is contacted under an unverified version.
export async function compatibilityCheck(path:string,options:AutomaticOptions={},context:CallContext={kind:'cli'},target?:string){
 const home=options.home??homedir(),canonical=async(p:string)=>realpath(p).catch(()=>resolve(p));
 const defaultPath=join(home,'.seamless','limits.json'),[actual,standard]=await Promise.all([stat(path).catch(()=>null),stat(defaultPath).catch(()=>null)]);
 if(actual&&standard&&actual.dev===standard.dev&&actual.ino===standard.ino)return {status:'compat_check_requires_test_limits'};
 if(await canonical(path)===await canonical(join(home,'.seamless','limits.json')))return {status:'compat_check_requires_test_limits'};
 const limits=await readLimits(path);
 if(limits.status!=='ok'||limits.value.exclude.length===0||limits.value.operations?.read===false)return {status:'compat_check_requires_test_limits'};
 const automatic=createAutomatic({...options,limitsPath:path,compatTest:true,compatTarget:target,testLimitsHash:limits.hash,scanOptions:{...options.scanOptions,allowChecking:true,claude:{...options.scanOptions?.claude,allowChecking:true}}});
 const scope=limits.value.scope??'current_work';
 const list=await automatic('sessions',{scope},context);
 if(list.status!=='ok'||list.candidates.length!==1)return {status:'compat_check_failed',result:list};
 const current=await readLimits(path);if(current.status!=='ok'||current.hash!==limits.hash)return {status:'compat_check_limits_changed'};
 const result=await automatic('read',{scope,target:list.candidates[0].id,limit:1},context);
 const passed=['ok','empty'].includes(result.status);
 return {status:passed?'compat_check_passed':'compat_check_failed',pair:[`${list.caller.provider}:${list.caller.nativeId}`,list.candidates[0].id],readStatus:result.status};
}
