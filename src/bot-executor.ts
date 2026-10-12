import {execFile} from 'node:child_process';
import {createHash,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {processInfo,type Ancestor} from './caller.ts';
import {processFiles} from './native-runtime.ts';
import type {Peer} from './peers.ts';
import {reservationOf,DAY} from './request-store.ts';

// specs/202610-more-peers, 立花さんの判断 1 (2026-10-12): `bot-send|bot-sessions <registration>` sign only for the Bot itself.
// The Bot is told apart by fixed identities, never by a display name (measured in M3, evidence.md):
//  1. an ancestor of this process is the Grok Bot app or its helper, by the code signature on the executable lsof shows (team
//     DCNK4UB866 and one of the two identifiers; argv[0] and process names are never trusted). A Claude, Codex or Grok CLI
//     conversation fails this, and so does Cursor (team VDXQ22DGB9; checked on this Mac 2026-10-12, as was the app passing).
//  2. the conversation UUID the app hands the command (CURSOR_CONVERSATION_ID; for a Grok Bot it is the Bot's own UUID) is one the
//     roster lists for the registration (botIds). Other Bots run commands through the same app; this tells them apart.
//  2'. a reply from the Bot's routine instead carries the word this Mac sent with the request it answers (src/webhook-send.ts): the
//     routine runs under a new id every time (sand-subagent-<UUID>, M3-4), and only the Bot's own address received the word.
// Left open until the Bot signs on its own side (Plans.md, deferred): another Bot of the same app can set the variable on purpose.
export const GROK_BOT_TEAM='DCNK4UB866';
export const GROK_BOT_IDS=['com.anysphere.sand','com.anysphere.sand.electron-helper'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_STEPS=8;
export type AppVerifier=(path:string)=>Promise<boolean>;
type Run=(file:string,args:string[],options:{timeout:number})=>Promise<unknown>;
export function createAppVerifier(run:Run=promisify(execFile)):AppVerifier{
 const requirement=`anchor apple generic and certificate leaf[subject.OU] = "${GROK_BOT_TEAM}" and (${GROK_BOT_IDS.map(id=>`identifier "${id}"`).join(' or ')})`;
 return async path=>{try{await run('/usr/bin/codesign',['--verify','--strict',`-R=${requirement}`,path],{timeout:15000});return true;}catch{return false;}};
}
export type ExecutorOptions={pid?:number;env?:NodeJS.ProcessEnv;process?:(pid:number)=>Promise<Ancestor|null>;executable?:(pid:number)=>Promise<string|null>;verify?:AppVerifier;reservationDir?:string;now?:()=>number};
// What a reply names: the request it answers, the conversation it goes to (provider:nativeId:generation) and the word it gives back.
// A word answers its request for a day, as often as the Bot replies (a start and a result are two replies); it is not used up.
export type ReplyProof={replyTo?:string;recipient?:string;replyToken?:string};
// null when the Bot itself runs the command; otherwise why not. Nothing about the process is looked at before the id or the word matches.
export type ExecutorCheck=(peer:Peer,reply?:ReplyProof)=>Promise<string|null>;
const WORD=/^[A-Za-z0-9_-]{32}$/;
export function createExecutorCheck(o:ExecutorOptions={}):ExecutorCheck{
 return async(peer,reply)=>{
  if(reply?.replyToken!==undefined){
   if(!await wordMatches(o,peer,reply))return 'reply_token_mismatch';
   return await fromBotApp(o)?null:'not_from_bot_app';
  }
  if(!peer.botIds?.length)return 'bot_id_unset';
  const raw=(o.env??process.env).CURSOR_CONVERSATION_ID,id=typeof raw==='string'?raw.toLowerCase():'';
  if(!UUID.test(id))return 'bot_id_missing';
  if(!peer.botIds.includes(id))return 'bot_id_mismatch';
  return await fromBotApp(o)?null:'not_from_bot_app';
 };
}
// The request answered was made to this Bot, by the conversation the reply goes to (the same run of it), within a day, and was
// sent with this word. Only the word's hash is on disk; the comparison takes the same time whatever it holds.
async function wordMatches(o:ExecutorOptions,peer:Peer,reply:ReplyProof):Promise<boolean>{
 const word=reply.replyToken,m=/^(claude|codex|grok):([^:]+):(.+)$/.exec(reply.recipient??'');
 if(!o.reservationDir||!reply.replyTo||typeof word!=='string'||!WORD.test(word)||!m)return false;
 const asked=await reservationOf(o.reservationDir,m[1],'local',m[2],reply.replyTo).catch(()=>null);
 if(!asked||asked.recipient.id!==`grok-bot:${peer.name}`||asked.sender.id!==`${m[1]}:${m[2]}`||asked.sender.generation!==m[3])return false;
 const age=(o.now??Date.now)()-asked.at;if(!(age>=0&&age<=DAY))return false;
 if(typeof asked.replyTokenSha256!=='string'||!/^[0-9a-f]{64}$/.test(asked.replyTokenSha256))return false;
 return timingSafeEqual(Buffer.from(asked.replyTokenSha256,'hex'),createHash('sha256').update(word).digest());
}
async function fromBotApp(o:ExecutorOptions):Promise<boolean>{
 const inspect=o.process??processInfo,executable=o.executable??(async(pid:number)=>(await processFiles(pid)).executable),verify=o.verify??createAppVerifier();
 let current=await inspect(o.pid??process.pid);const seen=new Set<number>();
 for(let i=0;i<MAX_STEPS&&current&&current.ppid>1;i++){
  if(seen.has(current.ppid))break;seen.add(current.ppid);
  current=await inspect(current.ppid);if(!current)break;
  const path=await executable(current.pid).catch(()=>null);
  // Only an executable inside an app bundle can carry the app's signature; anything else is passed over, never trusted.
  if(path&&/\.app\/Contents\//.test(path)&&await verify(path))return true;
 }
 return false;
}
