export type CompatibilityEntry={product:'claude-code'|'codex';version:string;connection:'desktop'|'cli';status:'verified'|'checking'|'fix_required';checkedAt:string|null;checks:readonly string[]};
export const COMPATIBILITY:readonly CompatibilityEntry[]=[
 {product:'claude-code',version:'2.1.284',connection:'desktop',status:'verified',checkedAt:'2026-10-02',checks:['identity','read','send','reply']},
 {product:'claude-code',version:'2.1.286',connection:'desktop',status:'verified',checkedAt:'2026-10-03',checks:['identity','read','send','reply']},
 {product:'claude-code',version:'2.1.287',connection:'desktop',status:'checking',checkedAt:null,checks:[]},
 {product:'codex',version:'26.928.31416+12553',connection:'desktop',status:'verified',checkedAt:'2026-10-01',checks:['owner','read','send','reply']},
 {product:'codex',version:'26.928.40906+12694',connection:'desktop',status:'verified',checkedAt:'2026-10-02',checks:['owner','read','send','reply']},
 {product:'codex',version:'26.930.31730+12947',connection:'desktop',status:'verified',checkedAt:'2026-10-04',checks:['owner','read','full-history','send']},
];
export type CompatibilityOptions={compatibility?:readonly CompatibilityEntry[];allowChecking?:boolean;strictVersions?:boolean};
export type VersionStatus='verified'|'checking'|'fix_required'|'unverified'|'invalid';
export function versionStatus(product:CompatibilityEntry['product'],version:string|null|undefined,options:CompatibilityOptions={},connection:CompatibilityEntry['connection']='desktop'):VersionStatus{
 if(!version)return 'unverified';
 const entries=(options.compatibility??COMPATIBILITY).filter(e=>e.product===product&&e.version===version&&e.connection===connection);
 if(!entries.length)return 'unverified';
 if(entries.length!==1)return 'invalid';
 const status=entries[0].status;
 return status==='verified'||status==='checking'||status==='fix_required'?status:'invalid';
}
export function isVersionAllowed(product:CompatibilityEntry['product'],version:string|null|undefined,options:CompatibilityOptions={},connection:CompatibilityEntry['connection']='desktop'):boolean{
 const status=versionStatus(product,version,options,connection);
 return status==='verified'||status==='checking'&&(options.strictVersions!==true||options.allowChecking===true)||status==='unverified'&&options.strictVersions!==true;
}
export const CLAUDE_COMPATIBILITY=COMPATIBILITY.filter(e=>e.product==='claude-code');
export function isClaudeVersionAllowed(version:string|null|undefined,options:CompatibilityOptions={}):boolean{return isVersionAllowed('claude-code',version,options);}
export function compatibilityMarkdown():string{
 return '# 対応の組\n\n生成元: `src/compat.ts`。更新: `node src/cli.ts compat-md`。\n\n表にない版も既定で使い、未確認と表示します。checking と版が読めない場合も同様です。strictVersions:true のときだけ verified に限ります（compat-check は checking も試験できます）。fix_required と未知の状態は常に止めます。更新後の動作は保証しません。\n\n| product | version | connection | status | checkedAt | checks |\n|---|---|---|---|---|---|\n'+COMPATIBILITY.map(e=>`| ${e.product} | ${e.version} | ${e.connection} | ${e.status} | ${e.checkedAt??'未確認'} | ${e.checks.join(', ')||'未確認'} |`).join('\n')+'\n';
}
