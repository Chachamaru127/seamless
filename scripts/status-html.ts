// Render `node src/cli.ts status --json <id>` as one self-contained HTML page (specs/2026-10-universal-wiring, AC15).
// Only the five stage names, whether each was observed, and the request, target and delivery/state codes are drawn.
// The status record carries no body text; this renderer still copies no unlisted field, so a body added to it later
// cannot leak into a reply that T3 Code renders.
import {pathToFileURL} from 'node:url';
import {STAGE_ORDER,type StageName} from '../src/adapters/read.ts';

// The user-facing names of the five stages (Plans.md 1 章). The internal name stays in data-stage.
const LABELS:Record<StageName,string>={accepted:'受理',reached:'渡った',processing:'処理中',replied:'返事',unknown:'不明'};
// A state is not a stage: it sits beside the five and says why the request is waiting or unusable.
const STATE_LABELS:Record<string,string>={held:'保留中',read_failed:'読取り失敗',refused:'拒否'};

type StatusInput={status?:unknown;id?:unknown;delivery?:unknown;target?:unknown;stages?:unknown;state?:unknown;reason?:unknown};

function escapeHtml(value:string):string{
 return value.replace(/[&<>"']/g,c=>c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c==='"'?'&quot;':'&#39;');
}
// Codes and ids are short. Anything longer, or of another type, is dropped rather than echoed back.
function code(value:unknown,limit=256):string{return typeof value==='string'&&value.length>0&&value.length<=limit?value:'';}
function observed(input:StatusInput):Set<StageName>{
 const found=new Set<StageName>();
 if(!Array.isArray(input.stages))return found;
 for(const item of input.stages){
  if(!item||typeof item!=='object')continue;
  const {stage,status}=item as {stage?:unknown;status?:unknown};
  if(typeof stage!=='string'||!(STAGE_ORDER as readonly string[]).includes(stage))continue;
  if(status==='observed')found.add(stage as StageName);
 }
 return found;
}
// The current stage is the last one the peer's own record confirms. None observed means no current stage,
// not a guess at the first: the output and the display then say the same thing.
function currentStage(found:Set<StageName>):StageName|null{
 let current:StageName|null=null;
 for(const stage of STAGE_ORDER)if(found.has(stage))current=stage;
 return current;
}
function targetLine(target:unknown):string{
 if(!target||typeof target!=='object')return '';
 const t=target as {provider?:unknown;nativeId?:unknown};
 const provider=code(t.provider,32),nativeId=code(t.nativeId);
 if(!provider&&!nativeId)return '';
 return `<p class="meta">宛先 <code>${escapeHtml(provider)}</code>${nativeId?` <code>${escapeHtml(nativeId)}</code>`:''}</p>`;
}
export function renderStatusHtml(input:unknown):string{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('status_json_object');
 const record=input as StatusInput;
 const status=code(record.status,64)||'unknown',id=code(record.id),delivery=code(record.delivery,64);
 const found=observed(record),current=currentStage(found);
 const state=code(record.state,32),reason=code(record.reason,128);
 const stages=STAGE_ORDER.map(stage=>{
  const isCurrent=stage===current,isObserved=found.has(stage);
  return `<li class="stage" data-stage="${stage}" data-current="${isCurrent?'true':'false'}" data-status="${isObserved?'observed':'unobserved'}"${isCurrent?' aria-current="step"':''}>`+
   `<span class="label">${LABELS[stage]}</span><span class="mark">${isObserved?'観測済み':'未観測'}</span></li>`;
 });
 const stateLine=state?`<p class="state" data-state="${escapeHtml(state)}">${escapeHtml(STATE_LABELS[state]??state)}${reason?` <code>${escapeHtml(reason)}</code>`:''}</p>`:'';
 return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>seamless の状態</title>
<style>
:root{color-scheme:light dark}body{margin:0;padding:18px;font:13px -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;line-height:1.7}main{max-width:640px}h1{font-size:16px;font-weight:600;margin:0 0 12px}.meta{margin:2px 0;overflow-wrap:anywhere}code{font-size:12px;overflow-wrap:anywhere}.stages{list-style:none;display:flex;gap:6px;flex-wrap:wrap;padding:0;margin:16px 0}.stage{display:flex;flex-direction:column;gap:2px;min-width:76px;padding:8px 10px;border:1px solid #8d8b85;border-radius:10px}.stage .label{font-weight:600}.stage .mark{font-size:11px;color:#6f6d68}.stage[data-current=true]{border-width:2px;border-color:#2f6f4f}.state{margin:12px 0 0;font-weight:600}
</style></head><body><main>
<h1>seamless の状態</h1>
<p class="meta">依頼 <code>${escapeHtml(id||'不明')}</code> / 受付 <code>${escapeHtml(delivery||'不明')}</code></p>
${targetLine(record.target)}
<ol class="stages">
${stages.join('\n')}
</ol>
${stateLine}
</main></body></html>
`;
}
async function readStdin():Promise<string>{
 const chunks:Buffer[]=[];
 for await(const chunk of process.stdin)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
 return Buffer.concat(chunks).toString('utf8');
}
export async function main(argv:string[]):Promise<number>{
 if(argv.length)throw new Error('invalid_arguments');
 const raw=await readStdin();
 let input:unknown;
 try{input=JSON.parse(raw);}catch{throw new Error('invalid_status_json');}
 process.stdout.write(renderStatusHtml(input));
 return 0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
}
