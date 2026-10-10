// Source-only proposal. Run only on the parent's owned Windows package-QA seat.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

export function hash(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
export function requiredDigest(value) {
  assert(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && value !== '0'.repeat(64), 'missing_final_digest');
  return value;
}
export function requiredCommit(value) {
  assert(typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && value !== '0'.repeat(40), 'missing_final_source_commit');
  return value;
}
export function physicalFile(file) {
  const absolute = path.resolve(file);
  const real = fs.realpathSync(absolute);
  assert.equal(process.platform === 'win32' ? real.toLowerCase() : real, process.platform === 'win32' ? absolute.toLowerCase() : absolute, 'input_path_alias');
  assert(fs.lstatSync(absolute).isFile() && !fs.lstatSync(absolute).isSymbolicLink(), 'input_not_regular');
  return absolute;
}
export function within(root, file) {
  const relative = path.relative(root, file);
  assert(relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative), 'resolution_outside_slot');
  let cursor = root;
  assert(fs.lstatSync(cursor).isDirectory() && !fs.lstatSync(cursor).isSymbolicLink(), 'slot_not_physical_directory');
  for (const piece of relative.split(path.sep)) {
    cursor = path.join(cursor, piece);
    assert(!fs.lstatSync(cursor).isSymbolicLink(), 'slot_reparse_or_symlink');
  }
  return file;
}
export function context(slot) {
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'x64');
  assert.equal(process.version, 'v24.19.0');
  const root = fs.realpathSync(path.resolve(slot));
  assert.equal(root.toLowerCase(), path.resolve(slot).toLowerCase(), 'slot_root_alias');
  const oc = within(root, path.join(root, 'node_modules/openclaw'));
  const pluginApi = within(root, path.join(oc, 'dist/extensions/cua-computer/api.js'));
  assert(fs.lstatSync(pluginApi).isFile());
  return { root, oc, pluginApi };
}
export function ownedContext(slot) {
  const c = context(slot);
  assert(!c.root.toLowerCase().includes('\\programdata\\forone\\kanoncomputer'), 'production_target_forbidden');
  const ownership = JSON.parse(fs.readFileSync(within(c.root, path.join(c.root, '.forone-owned-package-qa.json')), 'utf8'));
  assert.equal(ownership.schemaVersion, 1);
  assert.equal(ownership.purpose, 'owned_disposable_package_qa_only');
  assert.equal(ownership.liveActivation, false);
  const bindingFile = within(c.root, path.join(c.root, 'release-bindings.json'));
  assert.equal(hash(bindingFile), requiredDigest(ownership.releaseBindingsSha256));
  const binding = JSON.parse(fs.readFileSync(bindingFile, 'utf8'));
  requiredCommit(binding.finalOpenclawSourceCommit); requiredCommit(binding.cuaSourceCommit);
  return { ...c, binding, bindingFile };
}
export function verifyInputClosure(c) {
  for (const [filename, digest] of [['openclaw.tgz', c.binding.openclawTarSha256], ['cua-sdk.tgz', c.binding.sourceSdkTarSha256], ['cua-win.tgz', c.binding.nativeTarSha256]]) {
    assert.equal(hash(physicalFile(within(c.root, path.join(c.root, 'artifacts', filename)))), requiredDigest(digest));
  }
  const proofs = ['nativeQaReceipt', 'officialAddonProvenanceReceipt', 'sourceSdkBuildReceipt', 'sourceRebakeReceipt'];
  assert.deepEqual(Object.keys(c.binding.proofHashes).sort(), [...proofs].sort());
  for (const key of proofs) {
    assert.equal(hash(physicalFile(within(c.root, path.join(c.root, 'provenance', key + '.json')))), requiredDigest(c.binding.proofHashes[key]));
  }
  assert.equal(c.binding.officialAddonProvenanceReceiptSha256, c.binding.proofHashes.officialAddonProvenanceReceipt);
}
export async function sdkResolution(slot) {
  const c = context(slot);
  const requireFromOpenclaw = createRequire(path.join(c.oc, 'package.json'));
  const resolverFile = within(c.root, requireFromOpenclaw.resolve('import-meta-resolve'));
  const { resolve } = await import(pathToFileURL(resolverFile).href);
  const sdkEntry = within(c.root, fileURLToPath(resolve('@trycua/cua-driver', pathToFileURL(c.pluginApi).href)));
  let directory = path.dirname(sdkEntry);
  let sdkManifest;
  while (directory !== c.root && directory !== path.dirname(directory)) {
    const candidate = path.join(directory, 'package.json');
    if (fs.existsSync(candidate) && JSON.parse(fs.readFileSync(candidate, 'utf8')).name === '@trycua/cua-driver') {
      sdkManifest = within(c.root, candidate);
      break;
    }
    directory = path.dirname(directory);
  }
  assert(sdkManifest, 'sdk_manifest_missing');
  // This is the exact production verifier's SDK-scoped native resolution seam.
  const nativeManifest = within(c.root, createRequire(sdkManifest).resolve('@trycua/cua-driver-win32-x64-msvc/package.json'));
  return { ...c, sdkEntry, sdkManifest, nativeManifest, nativeDir: path.dirname(nativeManifest) };
}
export async function doctor(slot, expected) {
  const c = context(slot);
  // Do NOT precheck SDK versions/digests here: negative cases must be refused
  // by the actual packed production verifier, not by this QA script.
  const api = await import(pathToFileURL(c.pluginApi).href);
  const checks = [];
  api.registerCuaDriverDoctorChecks({ registerHealthCheck: check => checks.push(check) });
  assert.equal(checks.length, 1);
  assert.equal(checks[0].id, 'cua-computer/driver-artifacts');
  const issues = await checks[0].detect();
  const codes = issues.map(issue => {
    assert.equal(issue.checkId, checks[0].id);
    assert.equal(issue.severity, 'error');
    const match = /^([A-Z_]+):/.exec(issue.message);
    assert(match, 'unexpected_production_diagnostic');
    return match[1];
  });
  assert.deepEqual(codes, expected === 'pass' ? [] : [expected]);
  return { productionVerifier: true, expected, observed: codes, freshProcessRequired: true };
}
export async function abi(slot, bindingFile) {
  const owned = ownedContext(slot);
  assert.equal(path.resolve(bindingFile).toLowerCase(), owned.bindingFile.toLowerCase());
  const binding = owned.binding;
  requiredDigest(binding.finalDllSha256);
  requiredDigest(binding.officialAddonSha256);
  assert.equal(binding.officialAddonSha256, '93f220e8a5cbf25aff23321f20a868368a204f1026b8dce45c5a4f84290de09f');
  requiredDigest(binding.sourceSdkTarSha256);
  requiredDigest(binding.officialAddonProvenanceReceiptSha256);
  const c = await sdkResolution(slot);
  verifyInputClosure(owned);
  const slotManifest = JSON.parse(fs.readFileSync(path.join(c.root, 'package.json'), 'utf8'));
  assert.equal(slotManifest.private, true);
  assert.deepEqual(slotManifest.dependencies, { openclaw: 'file:artifacts/openclaw.tgz', '@trycua/cua-driver': 'file:artifacts/cua-sdk.tgz', '@trycua/cua-driver-win32-x64-msvc': 'file:artifacts/cua-win.tgz' });
  assert.deepEqual(slotManifest.overrides, { '@trycua/cua-driver': '$@trycua/cua-driver', '@trycua/cua-driver-win32-x64-msvc': '$@trycua/cua-driver-win32-x64-msvc' });
  await doctor(slot, 'pass');
  for (const [manifest, name] of [[c.sdkManifest, '@trycua/cua-driver'], [c.nativeManifest, '@trycua/cua-driver-win32-x64-msvc']]) {
    const j = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.equal(j.name, name); assert.equal(j.version, '0.28.2');
  }
  const dll = within(c.root, path.join(c.nativeDir, 'cua_driver_sdk.dll'));
  const addon = within(c.root, path.join(c.nativeDir, 'cua_driver_node_runtime.node'));
  assert.equal(hash(dll), binding.finalDllSha256);
  assert.equal(hash(addon), binding.officialAddonSha256);
  const sdkDir = path.dirname(c.sdkManifest);
  for (const stale of ['cua_driver_sdk.dll', 'libcua_driver_sdk.so', 'libcua_driver_sdk.dylib']) {
    assert(!fs.existsSync(path.join(sdkDir, 'dist/native', stale)), 'stale_colocated_library');
  }
  // The actual generated loader independently resolves from its caller inside
  // this SDK. Prove its DLL path equals the verifier's SDK-manifest resolver.
  const sdkRequire = createRequire(path.join(sdkDir, 'dist/native/node-runtime.js'));
  const runtimeResolver = within(c.root, sdkRequire.resolve('@ubjs/node/typescript/dist/resolve-lib.js'));
  const { resolveLibPath } = await import(pathToFileURL(runtimeResolver).href);
  assert.equal(fs.realpathSync(resolveLibPath({ crateName: 'cua_driver_sdk', callerUrl: pathToFileURL(path.join(sdkDir, 'dist/native/node-runtime.js')).href, npmPackageBase: '@trycua/cua-driver-', tripleStyle: 'node' })), fs.realpathSync(dll));
  const sdk = await import(pathToFileURL(c.sdkEntry).href);
  assert.equal(typeof sdk.CuaDriver, 'function');
  assert.equal(typeof sdk.CuaDriver.createWithClientKind, 'function');
  return { ...c, sdk, receipt: { ffiInitialized: true, sdkAndNativeVersion: '0.28.2', sdkDllSha256: hash(dll), addonSha256: hash(addon), sdkScopedResolverAndGeneratedLoaderAgree: true, node: process.version, abi: process.versions.modules, napi: process.versions.napi, platformRuntimeCreated: false, input: false } };
}
async function register(slot) {
  const c = context(slot);
  const { default: plugin } = await import(pathToFileURL(within(c.root, path.join(c.oc, 'dist/extensions/cua-computer/index.js'))).href);
  const commands = []; const policies = []; const errors = [];
  // Real packed entry and constructor; only host registration is observed.
  // Do not invoke prepare/isAvailable/openExecution or any command handler.
  plugin.register({ id: 'cua-computer', pluginConfig: {}, config: { plugins: { entries: { 'cua-computer': { enabled: true } } } }, logger: { error: text => errors.push(text), info() {}, warn() {}, debug() {} }, registerNodeHostCommand: value => commands.push(value), registerNodeInvokePolicy: value => policies.push(value) });
  assert.deepEqual(errors, []);
  assert.deepEqual(commands.map(x => [x.command, x.cap, x.dangerous]), [['screen.snapshot', 'screen', false], ['computer.act', 'computer', true]]);
  assert.equal(policies.length, 1);
  return { packedPluginRegistration: true, commandsObserved: 2, policiesObserved: 1, handlersInvoked: 0, nativeExecutionCreated: false };
}
async function cliVersion(slot) {
  const c = ownedContext(slot); verifyInputClosure(c);
  const manifest = JSON.parse(fs.readFileSync(within(c.root, path.join(c.oc, 'package.json')), 'utf8'));
  assert.equal(manifest.name, 'openclaw'); assert.equal(manifest.version, '2026.9.6');
  const entry = within(c.root, path.join(c.oc, 'openclaw.mjs'));
  // Version has no node/gateway/session/config mutation. Never run node start.
  const child = spawnSync(process.execPath, [entry, '--version'], { cwd: c.root, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
  assert.equal(child.status, 0, 'packed_cli_version_failed');
  assert(/(?:^|\s)2026\.9\.6(?:\s|$)/.test(child.stdout.trim()), 'packed_cli_version_mismatch');
  return { packedCliVersion: '2026.9.6', cliCompleted: true, runtimeOrTaskStarted: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, slot, arg] = process.argv.slice(2);
    assert(slot, 'slot_required');
    const result = mode === 'doctor' ? await doctor(slot, arg) : mode === 'abi' ? (await abi(slot, arg)).receipt : mode === 'register' ? await register(slot) : mode === 'version' ? await cliVersion(slot) : assert.fail('unknown_probe_mode');
    console.log(JSON.stringify(result));
  } catch (error) {
    // Do not serialize provider, customer or raw environment text.
    console.error(JSON.stringify({ failed: true, code: error?.code ?? 'PACKAGE_QA_FAILED' }));
    process.exitCode = 1;
  }
}
