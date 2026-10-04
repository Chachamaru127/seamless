export type CompatibilityEntry={product:'claude-code'|'codex';version:string;connection:'desktop'|'cli';status:'verified'|'checking'|'fix_required';checkedAt:string|null;checks:readonly string[]};
export const COMPATIBILITY:readonly CompatibilityEntry[]=[
 {product:'claude-code',version:'2.1.284',connection:'desktop',status:'verified',checkedAt:'2026-10-02',checks:['identity','read','send','reply']},
 {product:'claude-code',version:'2.1.286',connection:'desktop',status:'verified',checkedAt:'2026-10-03',checks:['identity','read','send','reply']},
 {product:'claude-code',version:'2.1.287',connection:'desktop',status:'checking',checkedAt:null,checks:[]},
 {product:'codex',version:'26.928.31416+12553',connection:'desktop',status:'verified',checkedAt:'2026-10-01',checks:['owner','read','send','reply']},
 {product:'codex',version:'26.928.40906+12694',connection:'desktop',status:'verified',checkedAt:'2026-10-02',checks:['owner','read','send','reply']},
 {product:'codex',version:'26.930.31730+12947',connection:'desktop',status:'verified',checkedAt:'2026-10-04',checks:['owner','read','full-history','send']},
];
export type CompatibilityOptions={compatibility?:readonly CompatibilityEntry[];allowChecking?:boolean};
export function isVersionAllowed(product:CompatibilityEntry['product'],version:string,options:CompatibilityOptions={},connection:CompatibilityEntry['connection']='desktop'):boolean{
 const entries=(options.compatibility??COMPATIBILITY).filter(e=>e.product===product&&e.version===version&&e.connection===connection);
 return entries.length===1&&(entries[0].status==='verified'||options.allowChecking===true&&entries[0].status==='checking');
}
export const CLAUDE_COMPATIBILITY=COMPATIBILITY.filter(e=>e.product==='claude-code');
export function isClaudeVersionAllowed(version:string,options:CompatibilityOptions={}):boolean{return isVersionAllowed('claude-code',version,options);}
export function compatibilityMarkdown():string{
 return '# 対応の組\n\n生成元: `src/compat.ts`。更新: `node src/cli.ts compat-md`。\n\n通常利用は verified の組だけです。表にない組は未確認です。checking の試験合格は通常利用の承認になりません。更新後の動作は保証しません。\n\n| product | version | connection | status | checkedAt | checks |\n|---|---|---|---|---|---|\n'+COMPATIBILITY.map(e=>`| ${e.product} | ${e.version} | ${e.connection} | ${e.status} | ${e.checkedAt??'未確認'} | ${e.checks.join(', ')||'未確認'} |`).join('\n')+'\n';
}
