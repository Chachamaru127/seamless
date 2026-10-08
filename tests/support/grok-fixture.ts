import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {GrokRow} from '../../src/adapters/grok.ts';
export const ids={live:'01a11a6c-23b4-7af0-b5c4-c9893437b301',stale:'01a11a6c-23b4-7af0-b5c4-c9893437b302',outside:'01a11a6c-23b4-7af0-b5c4-c9893437b303',stopped:'01a11a6c-23b4-7af0-b5c4-c9893437b304',headless:'01a11a6c-23b4-7af0-b5c4-c9893437b305',stoppedOutside:'01a11a6c-23b4-7af0-b5c4-c9893437b306'};
export const OPENED='2026-10-08T07:30:57.414144Z';
// A home with Grok's ledger and conversation folders laid out as Grok CLI 1.0.46 writes them (observed 2026-10-08).
export async function grokHome(t:{after:(fn:()=>Promise<void>)=>void}){
 const home=await realpath(await mkdtemp(join(tmpdir(),'seamless-grok-')));t.after(()=>rm(home,{recursive:true,force:true}));
 const work=join(home,'work'),other=join(home,'other');await mkdir(work);await mkdir(other);
 const rows:GrokRow[]=[{session_id:ids.live,pid:501,cwd:work,opened_at:OPENED},{session_id:ids.stale,pid:502,cwd:work,opened_at:OPENED},{session_id:ids.outside,pid:503,cwd:other,opened_at:OPENED}];
 await mkdir(join(home,'.grok','sessions'),{recursive:true});
 const ledger=async(value:unknown)=>writeFile(join(home,'.grok','active_sessions.json'),typeof value==='string'?value:JSON.stringify(value));
 await ledger(rows);
 const summary=async(cwd:string,id:string,kind?:string)=>{const dir=join(home,'.grok','sessions',encodeURIComponent(cwd),id);await mkdir(dir,{recursive:true});await writeFile(join(dir,'summary.json'),JSON.stringify({info:{id,cwd},created_at:OPENED,updated_at:OPENED,last_active_at:OPENED,...(kind?{session_kind:kind}:{})}));return dir;};
 for(const id of [ids.live,ids.stale,ids.stopped])await summary(work,id);
 await summary(work,ids.headless,'headless');await summary(other,ids.outside);await summary(other,ids.stoppedOutside);
 // pid 501 and 503 started 0.3s before their rows; 502 is gone.
 const started=Date.parse(OPENED)-300;
 const processStart=async(pid:number)=>pid===501||pid===503?started:pid===502?started-3600_000:null;
 return {home,work,other,rows,ledger,summary,processStart,grok:{processStart,grokVersion:async()=>'1.0.46'}};
}
