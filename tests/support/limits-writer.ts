import {readLimits,writeLimits} from '../../src/limits.ts';
if(process.argv[3]==='exit')process.exit(0);
const path=process.argv[2],snapshot=await readLimits(path);
if(snapshot.status==='unusable')throw new Error('fixture unusable');
process.on('message',async message=>{
 if(message!=='go')return;
 const result=await writeLimits({version:1,exclude:[],scope:null,operations:null},snapshot.hash,path);
 process.send!(result,()=>process.disconnect());
});
process.send!({status:'ready',hash:snapshot.hash});
