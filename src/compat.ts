export type CompatibilityProduct='claude-code'|'codex'|'grok'|'opencode'|'cursor'|'antigravity';
export type CompatibilityConnection='desktop'|'cli';
export type CompatibilityEntry={product:CompatibilityProduct;version:string;connection:CompatibilityConnection;status:'verified'|'checking'|'fix_required';checkedAt:string|null;checks:readonly string[]};
// The v1 products are listed as checking: the version was observed on this Mac on 2026-10-19, not measured end to end.
const V1_CHECKED_AT='2026-10-19';
export const COMPATIBILITY:readonly CompatibilityEntry[]=[
 {product:'claude-code',version:'2.1.284',connection:'desktop',status:'verified',checkedAt:'2026-10-02',checks:['identity','read','send','reply']},
 {product:'claude-code',version:'2.1.286',connection:'desktop',status:'verified',checkedAt:'2026-10-03',checks:['identity','read','send','reply']},
 {product:'claude-code',version:'2.1.287',connection:'desktop',status:'checking',checkedAt:null,checks:[]},
 {product:'codex',version:'26.928.31416+12553',connection:'desktop',status:'verified',checkedAt:'2026-10-01',checks:['owner','read','send','reply']},
 {product:'codex',version:'26.928.40906+12694',connection:'desktop',status:'verified',checkedAt:'2026-10-02',checks:['owner','read','send','reply']},
 {product:'codex',version:'26.930.31730+12947',connection:'desktop',status:'verified',checkedAt:'2026-10-04',checks:['owner','read','full-history','send']},
 // Grok Build CLI is a terminal program (connection cli). checking until the P1 judgement of specs/202610-more-peers.
 {product:'grok',version:'1.0.46',connection:'cli',status:'checking',checkedAt:null,checks:[]},
 // v1: Claude 2.1.303, Codex CLI 0.163.0, the installed Codex Desktop, opencode 2.0.32, Cursor CLI 2026.10.17,
 // Antigravity 1.1.1 and Grok CLI 1.0.62. The version was observed; each product's own connection is not measured yet.
 {product:'claude-code',version:'2.1.303',connection:'desktop',status:'checking',checkedAt:V1_CHECKED_AT,checks:[]},
 {product:'codex',version:'0.163.0',connection:'cli',status:'checking',checkedAt:V1_CHECKED_AT,checks:[]},
 {product:'codex',version:'26.1013.40934+20770',connection:'desktop',status:'checking',checkedAt:V1_CHECKED_AT,checks:[]},
 {product:'opencode',version:'2.0.32',connection:'cli',status:'checking',checkedAt:V1_CHECKED_AT,checks:[]},
 {product:'cursor',version:'2026.10.17',connection:'cli',status:'checking',checkedAt:V1_CHECKED_AT,checks:[]},
 {product:'antigravity',version:'1.1.1',connection:'cli',status:'checking',checkedAt:V1_CHECKED_AT,checks:[]},
 {product:'grok',version:'1.0.62',connection:'cli',status:'checking',checkedAt:V1_CHECKED_AT,checks:[]},
];
// desktopConnection is set by the caller that tried the Desktop connection. 'failed' means the connection did not go through,
// so the version cannot be confirmed even when the row exists.
export type CompatibilityOptions={compatibility?:readonly CompatibilityEntry[];allowChecking?:boolean;strictVersions?:boolean;desktopConnection?:'ok'|'failed'};
export type VersionStatus='verified'|'checking'|'fix_required'|'unverified'|'unverified_desktop'|'invalid';
export function defaultConnection(product:CompatibilityProduct):CompatibilityConnection{return product==='claude-code'||product==='codex'?'desktop':'cli';}
export function versionStatus(product:CompatibilityEntry['product'],version:string|null|undefined,options:CompatibilityOptions={},connection:CompatibilityEntry['connection']=defaultConnection(product)):VersionStatus{
 if(connection==='desktop'&&options.desktopConnection==='failed')return 'unverified_desktop';
 if(!version)return 'unverified';
 const entries=(options.compatibility??COMPATIBILITY).filter(e=>e.product===product&&e.version===version&&e.connection===connection);
 if(!entries.length)return 'unverified';
 if(entries.length!==1)return 'invalid';
 const status=entries[0].status;
 return status==='verified'||status==='checking'||status==='fix_required'?status:'invalid';
}
export function isVersionAllowed(product:CompatibilityEntry['product'],version:string|null|undefined,options:CompatibilityOptions={},connection:CompatibilityEntry['connection']=defaultConnection(product)):boolean{
 const status=versionStatus(product,version,options,connection);
 return status==='verified'||status==='checking'&&(options.strictVersions!==true||options.allowChecking===true)||(status==='unverified'||status==='unverified_desktop')&&options.strictVersions!==true;
}
// The compatibility product of a conversation provider.
export function productOf(provider:'claude'|'codex'|'grok'):CompatibilityEntry['product']{return provider==='claude'?'claude-code':provider;}
export const CLAUDE_COMPATIBILITY=COMPATIBILITY.filter(e=>e.product==='claude-code');
export function isClaudeVersionAllowed(version:string|null|undefined,options:CompatibilityOptions={}):boolean{return isVersionAllowed('claude-code',version,options);}
export function compatibilityMarkdown():string{
 return '# 対応の組\n\n生成元: `src/compat.ts`。更新: `node src/cli.ts compat-md`。\n\n表にない版も既定で使い、未確認と表示します。checking と版が読めない場合も同様です。Desktop の接続が通らないときは未確認（Desktop、`unverified_desktop`）と表示します。strictVersions:true のときだけ verified に限ります（compat-check は checking も試験できます）。fix_required と未知の状態は常に止めます。更新後の動作は保証しません。\n\n| product | version | connection | status | checkedAt | checks |\n|---|---|---|---|---|---|\n'+COMPATIBILITY.map(e=>`| ${e.product} | ${e.version} | ${e.connection} | ${e.status} | ${e.checkedAt??'未確認'} | ${e.checks.join(', ')||'未確認'} |`).join('\n')+'\n';
}
