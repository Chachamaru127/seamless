import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ContractError } from '../protocol.ts';

// One manifest says everything the core needs to register a product: how it is found, how its identity is built, how a
// request is handed over, which records prove the stages, which product states map to the three listing states, what the
// adapter may do, and how it is installed. The core never names a product; src/manifests/*.json is the whole list.
//
// The manifest cannot widen permissions. In particular, the human-approval mark is not a property a manifest may choose:
// the only value accepted is `limits.markUnapproved`, which means the mark is still read from ~/.seamless/limits.json on
// every send (spec.md invariant 3, Plans.md 1.7). A manifest that tries to fix, always add or drop the mark is invalid.
export const MANIFEST_SCHEMA_VERSION = 1;
export const MAX_MANIFEST_BYTES = 65_536;
export const MANIFEST_DIR = fileURLToPath(new URL('../manifests', import.meta.url));
export const MANIFEST_APPROVAL_MARK = 'limits.markUnapproved' as const;

export const MANIFEST_PROVIDERS = ['claude', 'codex', 'grok', 'grok-bot', 'opencode'] as const;
export const MANIFEST_IDENTITY_KINDS = ['pid_session', 'thread', 'roster'] as const;
export const MANIFEST_DISCOVERY_KINDS = ['sessions_json', 'rollout', 'desktop_ipc', 'roster', 'plugin', 'hook'] as const;
export const MANIFEST_WRITE_CHANNELS = ['unix_socket', 'command', 'desktop_ipc', 'https_webhook', 'inbox_file', 'plugin_api'] as const;
export const MANIFEST_EVIDENCE_STAGES = ['reached', 'processing', 'replied'] as const;
export const MANIFEST_STATES = ['ready', 'next_turn', 'wake_needed', 'unreachable'] as const;
export const MANIFEST_OPERATIONS = ['read', 'send'] as const;

export type ManifestProvider = (typeof MANIFEST_PROVIDERS)[number];
export type ManifestIdentityKind = (typeof MANIFEST_IDENTITY_KINDS)[number];
export type ManifestDiscoveryKind = (typeof MANIFEST_DISCOVERY_KINDS)[number];
export type ManifestWriteChannel = (typeof MANIFEST_WRITE_CHANNELS)[number];
export type ManifestEvidenceStage = (typeof MANIFEST_EVIDENCE_STAGES)[number];
export type ManifestState = (typeof MANIFEST_STATES)[number];
export type ManifestOperation = (typeof MANIFEST_OPERATIONS)[number];

export type ManifestIdentity = { kind: ManifestIdentityKind; id: string; generation: string; record: string };
export type ManifestDiscovery = { kind: ManifestDiscoveryKind; source: string; fields: string[] };
export type ManifestWrite = { channel: ManifestWriteChannel; target: string };
export type ManifestEvidence = { source: string; stages: ManifestEvidenceStage[] };
export type ManifestPermissions = { operations: ManifestOperation[]; approvalMark: typeof MANIFEST_APPROVAL_MARK };
export type ManifestInstall = { hook: string | null; steps: string[] };
export type ManifestLimits = { maxText: number };
// The adapter may expose the three ports the core drives: discovery (`list`), writing (`send`) and evidence (`evidence`).
// A manifest that names none is listed and written through the core's channel handlers, as the v1 products are.
export type ManifestExports = { list?: string; send?: string; evidence?: string };

export type ProductManifest = {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  product: string;
  provider: ManifestProvider;
  displayName: string;
  adapter: string;
  identity: ManifestIdentity;
  discovery: ManifestDiscovery;
  write: ManifestWrite;
  evidence: ManifestEvidence;
  states: Record<string, ManifestState>;
  permissions: ManifestPermissions;
  install: ManifestInstall;
  limits?: ManifestLimits;
  exports?: ManifestExports;
};

export type ManifestPeer = {
  id: string;
  provider: ManifestProvider;
  displayName: string;
  discovery: ManifestDiscoveryKind;
  write: ManifestWriteChannel;
};

const PRODUCT = /^[a-z][a-z0-9-]{0,63}$/;
const CONDITION = /^[a-z][a-z0-9_]{0,63}$/;
const MODULE = /^(?:\.\/|\.\.\/)(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:ts|js)$/;

function invalid(): never {
  throw new ContractError('manifest_invalid');
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
// Unknown keys are refused rather than ignored: a typo must not silently drop a rule.
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isRecord(value)) invalid();
  for (const key of required) if (!Object.hasOwn(value, key)) invalid();
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) invalid();
  return value;
}
function text(value: unknown, max = 256, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value.length || value.length > max || value.trim() !== value) invalid();
  if (pattern && !pattern.test(value)) invalid();
  return value;
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid();
  return value as T;
}
function uniqueTexts(value: unknown, min: number, max: number, eachMax = 128, pattern?: RegExp): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid();
  const out = value.map((item) => text(item, eachMax, pattern));
  if (new Set(out).size !== out.length) invalid();
  return out;
}
// The adapter is a module next to the manifests or one folder up (../adapters/*.ts). A path may not climb out of src/.
function modulePath(value: unknown): string {
  const path = text(value, 256, MODULE);
  if (path.split('/').slice(1).some((part) => part === '.' || part === '..')) invalid();
  return path;
}
function identity(value: unknown): ManifestIdentity {
  const v = exact(value, ['kind', 'id', 'generation', 'record']);
  return {
    kind: choice(v.kind, MANIFEST_IDENTITY_KINDS),
    id: text(v.id, 128),
    generation: text(v.generation, 128),
    record: text(v.record, 256),
  };
}
function discovery(value: unknown): ManifestDiscovery {
  const v = exact(value, ['kind', 'source', 'fields']);
  return {
    kind: choice(v.kind, MANIFEST_DISCOVERY_KINDS),
    source: text(v.source, 256),
    fields: uniqueTexts(v.fields, 1, 16, 64, /^[A-Za-z0-9._-]+$/),
  };
}
function write(value: unknown): ManifestWrite {
  const v = exact(value, ['channel', 'target']);
  return { channel: choice(v.channel, MANIFEST_WRITE_CHANNELS), target: text(v.target, 256) };
}
function evidence(value: unknown): ManifestEvidence {
  const v = exact(value, ['source', 'stages']);
  const stages = uniqueTexts(v.stages, 1, MANIFEST_EVIDENCE_STAGES.length, 32).map((stage) => choice(stage, MANIFEST_EVIDENCE_STAGES));
  // `accepted` is not evidence: it is the local reservation, and a writer must never turn it into a reached stage.
  return { source: text(v.source, 256), stages };
}
function states(value: unknown): Record<string, ManifestState> {
  if (!isRecord(value) || !Object.keys(value).length || Object.keys(value).length > 16) invalid();
  const out: Record<string, ManifestState> = {};
  for (const [condition, state] of Object.entries(value)) {
    if (!CONDITION.test(condition)) invalid();
    out[condition] = choice(state, MANIFEST_STATES);
  }
  return out;
}
function permissions(value: unknown): ManifestPermissions {
  const v = exact(value, ['operations', 'approvalMark']);
  const operations = uniqueTexts(v.operations, 1, MANIFEST_OPERATIONS.length, 16).map((operation) => choice(operation, MANIFEST_OPERATIONS));
  return { operations, approvalMark: choice(v.approvalMark, [MANIFEST_APPROVAL_MARK]) };
}
function install(value: unknown): ManifestInstall {
  const v = exact(value, ['hook', 'steps']);
  const hook = v.hook === null ? null : text(v.hook, 256);
  return { hook, steps: uniqueTexts(v.steps, 1, 8, 256) };
}
function limits(value: unknown): ManifestLimits {
  const v = exact(value, ['maxText']);
  if (!Number.isSafeInteger(v.maxText) || (v.maxText as number) < 1) invalid();
  return { maxText: v.maxText as number };
}
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
function exportsField(value: unknown): ManifestExports {
  const v = exact(value, [], ['list', 'send', 'evidence']);
  const out: ManifestExports = {};
  for (const key of ['list', 'send', 'evidence'] as const) {
    if (v[key] === undefined) continue;
    out[key] = text(v[key], 64, IDENTIFIER);
  }
  if (!Object.keys(out).length) invalid();
  return out;
}

export function parseManifest(value: unknown): ProductManifest {
  const top = exact(
    value,
    ['schemaVersion', 'product', 'provider', 'displayName', 'adapter', 'identity', 'discovery', 'write', 'evidence', 'states', 'permissions', 'install'],
    ['limits', 'exports'],
  );
  if (top.schemaVersion !== MANIFEST_SCHEMA_VERSION) invalid();
  const manifest: ProductManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    product: text(top.product, 64, PRODUCT),
    provider: choice(top.provider, MANIFEST_PROVIDERS),
    displayName: text(top.displayName, 80),
    adapter: modulePath(top.adapter),
    identity: identity(top.identity),
    discovery: discovery(top.discovery),
    write: write(top.write),
    evidence: evidence(top.evidence),
    states: states(top.states),
    permissions: permissions(top.permissions),
    install: install(top.install),
    ...(top.limits === undefined ? {} : { limits: limits(top.limits) }),
    ...(top.exports === undefined ? {} : { exports: exportsField(top.exports) }),
  };
  return structuredClone(manifest);
}

// The adapter module a manifest names, resolved next to that manifest. Reading the manifest is all the core does; the
// product's own file is loaded only when its adapter is actually used.
export function adapterModule(manifest: ProductManifest, directory = MANIFEST_DIR): string {
  return fileURLToPath(new URL(manifest.adapter, pathToFileURL(join(directory, 'manifest.json'))));
}

export async function loadManifest(path: string): Promise<ProductManifest> {
  let bytes: Buffer;
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_MANIFEST_BYTES) invalid();
    bytes = await readFile(path);
  } catch (error) {
    if (error instanceof ContractError) throw error;
    invalid();
  }
  // The file can grow between the two reads; the second check is the one that bounds memory.
  if (bytes.length > MAX_MANIFEST_BYTES) invalid();
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    invalid();
  }
  return parseManifest(value);
}

export async function loadManifests(directory = MANIFEST_DIR): Promise<ProductManifest[]> {
  let names: string[];
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    names = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name).sort();
  } catch {
    invalid();
  }
  const manifests = await Promise.all(names.map((name) => loadManifest(join(directory, name))));
  const products = new Set<string>();
  for (const manifest of manifests) {
    if (products.has(manifest.product)) throw new ContractError('manifest_duplicate');
    products.add(manifest.product);
  }
  return manifests;
}

// The ports a manifest may name in its adapter module. They are deliberately shaped like the existing product adapters:
// a list port answers peer rows, a send port takes one envelope, and an evidence port answers the records the product wrote.
// `unknown` here is the same meaning as elsewhere: the write happened but its outcome cannot be proven.
export type ManifestAdapterPeer = {
  id?: string;
  provider?: string;
  nativeId: string;
  generation?: string;
  displayName?: string;
  title?: string;
  status?: string | null;
  state?: string | null;
  reason?: string | null;
  versionStatus?: string | null;
};
export type ManifestAdapterReceipt = { status: 'submitted' | 'unknown' | 'rejected'; nativeMessageId?: string; reason?: string; version?: string };
export type ManifestAdapterPort = {
  list?: (options: { home: string }) => Promise<unknown>;
  send?: (envelope: Record<string, unknown>, options: { home: string }) => Promise<ManifestAdapterReceipt>;
  evidence?: (target: Record<string, unknown>, options: { home: string }) => Promise<unknown>;
};

// Registration is per product and per manifest: adding a product is dropping one file in src/manifests and nothing else.
export class ManifestRegistry {
  private byProduct = new Map<string, ProductManifest>();
  readonly directory: string;
  constructor(manifests: readonly unknown[] = [], directory = MANIFEST_DIR) {
    this.directory = directory;
    for (const manifest of manifests) this.register(manifest);
  }
  register(value: unknown): ProductManifest {
    const manifest = parseManifest(value);
    if (this.byProduct.has(manifest.product)) throw new ContractError('manifest_duplicate');
    this.byProduct.set(manifest.product, manifest);
    return structuredClone(manifest);
  }
  get(product: string): ProductManifest | undefined {
    const manifest = this.byProduct.get(product);
    return manifest ? structuredClone(manifest) : undefined;
  }
  list(): ProductManifest[] {
    return [...this.byProduct.values()].sort((a, b) => a.product.localeCompare(b.product)).map((manifest) => structuredClone(manifest));
  }
  peers(): ManifestPeer[] {
    return this.list().map((manifest) => ({
      id: manifest.product,
      provider: manifest.provider,
      displayName: manifest.displayName,
      discovery: manifest.discovery.kind,
      write: manifest.write.channel,
    }));
  }
  adapter(product: string): string | undefined {
    const manifest = this.get(product);
    return manifest ? adapterModule(manifest, this.directory) : undefined;
  }
  adapters(): Array<{ product: string; module: string }> {
    return this.list().map((manifest) => ({ product: manifest.product, module: adapterModule(manifest, this.directory) }));
  }
}

export async function loadManifestRegistry(directory = MANIFEST_DIR): Promise<ManifestRegistry> {
  return new ManifestRegistry(await loadManifests(directory), directory);
}

// The core never imports a product by name: it imports the module the manifest names and calls the ports the manifest
// declares. A port the manifest does not declare, or that its module does not export, is absent rather than guessed.
const ports = new Map<string, Promise<ManifestAdapterPort>>();
export function loadAdapterPort(manifest: ProductManifest, directory = MANIFEST_DIR): Promise<ManifestAdapterPort> {
  const module = adapterModule(manifest, directory);
  const cached = ports.get(module);
  if (cached) return cached;
  const loading = (async () => {
    const loaded = (await import(pathToFileURL(module).href)) as Record<string, unknown>;
    const pick = <T>(name: string | undefined): T | undefined =>
      name !== undefined && typeof loaded[name] === 'function' ? (loaded[name] as T) : undefined;
    return {
      list: pick<NonNullable<ManifestAdapterPort['list']>>(manifest.exports?.list),
      send: pick<NonNullable<ManifestAdapterPort['send']>>(manifest.exports?.send),
      evidence: pick<NonNullable<ManifestAdapterPort['evidence']>>(manifest.exports?.evidence),
    };
  })().catch((error) => {
    // A module that could not be loaded or evaluated is not cached: a later call may see a fixed file.
    ports.delete(module);
    throw error;
  });
  ports.set(module, loading);
  return loading;
}
