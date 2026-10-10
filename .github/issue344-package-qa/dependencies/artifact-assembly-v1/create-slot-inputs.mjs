// Creates a NEW disposable package-QA root, not any managed/production slot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hash, requiredDigest, requiredCommit, physicalFile } from './package-qa-probe.mjs';
const [inputsFile, destination] = process.argv.slice(2);
assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64'); assert.equal(process.version, 'v24.19.0');
assert(inputsFile && destination);
const root = path.resolve(destination);
assert(!root.toLowerCase().includes('\\programdata\\forone\\kanoncomputer'), 'production_target_forbidden');
assert(!fs.existsSync(root), 'new_owned_directory_required');
const inputs = JSON.parse(fs.readFileSync(inputsFile, 'utf8'));
for (const key of ['finalOpenclawSourceCommit', 'cuaSourceCommit']) requiredCommit(inputs[key]);
requiredDigest(inputs.finalDllSha256);
assert.equal(inputs.officialAddonSha256, '93f220e8a5cbf25aff23321f20a868368a204f1026b8dce45c5a4f84290de09f');
const artifacts = [['openclawTar', 'openclaw.tgz'], ['sourceSdkTar', 'cua-sdk.tgz'], ['nativeTar', 'cua-win.tgz']];
const proofs = ['nativeQaReceipt', 'officialAddonProvenanceReceipt', 'sourceSdkBuildReceipt', 'sourceRebakeReceipt'];
for (const key of [...artifacts.map(x => x[0]), ...proofs]) {
  const item = inputs[key]; assert(item && item.path);
  assert.equal(hash(physicalFile(item.path)), requiredDigest(item.sha256), 'input_digest_mismatch');
}
fs.mkdirSync(root); fs.mkdirSync(path.join(root, 'artifacts')); fs.mkdirSync(path.join(root, 'provenance'));
for (const [key, name] of artifacts) fs.copyFileSync(inputs[key].path, path.join(root, 'artifacts', name), fs.constants.COPYFILE_EXCL);
for (const key of proofs) fs.copyFileSync(inputs[key].path, path.join(root, 'provenance', key + '.json'), fs.constants.COPYFILE_EXCL);
const bindings = { schemaVersion: 1, finalOpenclawSourceCommit: inputs.finalOpenclawSourceCommit, cuaSourceCommit: inputs.cuaSourceCommit, finalDllSha256: inputs.finalDllSha256, officialAddonSha256: inputs.officialAddonSha256, openclawTarSha256: inputs.openclawTar.sha256, sourceSdkTarSha256: inputs.sourceSdkTar.sha256, nativeTarSha256: inputs.nativeTar.sha256, officialAddonProvenanceReceiptSha256: inputs.officialAddonProvenanceReceipt.sha256, proofHashes: Object.fromEntries(proofs.map(key => [key, inputs[key].sha256])) };
fs.writeFileSync(path.join(root, 'release-bindings.json'), JSON.stringify(bindings, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(root, '.forone-owned-package-qa.json'), JSON.stringify({ schemaVersion: 1, purpose: 'owned_disposable_package_qa_only', releaseBindingsSha256: hash(path.join(root, 'release-bindings.json')), liveActivation: false }) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'forone-kanon-issue344-node-slot', version: '0.0.0', private: true, dependencies: { openclaw: 'file:artifacts/openclaw.tgz', '@trycua/cua-driver': 'file:artifacts/cua-sdk.tgz', '@trycua/cua-driver-win32-x64-msvc': 'file:artifacts/cua-win.tgz' }, overrides: { '@trycua/cua-driver': '$@trycua/cua-driver', '@trycua/cua-driver-win32-x64-msvc': '$@trycua/cua-driver-win32-x64-msvc' } }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ newOwnedQaRootCreated: true, inputTarballs: 3, provenanceReceipts: proofs.length, inputsOnly: true, installStarted: false }));
