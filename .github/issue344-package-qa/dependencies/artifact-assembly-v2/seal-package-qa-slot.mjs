// Inventory and close only the parent's explicitly owned disposable QA root.
// The release owner decides eligibility; hashes alone are not a CI acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hash, ownedContext, sdkResolution, verifyInputClosure, within } from '../artifact-assembly-v1/package-qa-probe.mjs';
const [slot, out] = process.argv.slice(2);
assert(slot && out, 'required_arguments_missing');
const c = ownedContext(slot); verifyInputClosure(c);
const output = path.resolve(out);
assert(!fs.existsSync(output), 'seal_overwrite_forbidden');
assert(!output.toLowerCase().startsWith(c.root.toLowerCase() + path.sep), 'seal_must_be_outside_inventory');
assert(!fs.existsSync(path.join(c.root, '.package-qa-matrix-pending.json')), 'negative_pending');
const matrixFile = within(c.root, path.join(c.root, 'package-qa-matrix-receipt.json'));
const matrix = JSON.parse(fs.readFileSync(matrixFile, 'utf8'));
assert.equal(matrix.releaseBindingsSha256, hash(c.bindingFile));
assert.equal(matrix.actualProductionVerifier, true); assert.equal(matrix.restored, true);
assert.equal(matrix.negatives, 8); assert.equal(matrix.results.length, 9);
const lock = JSON.parse(fs.readFileSync(within(c.root, path.join(c.root, 'package-lock.json')), 'utf8'));
assert.equal(lock.lockfileVersion, 3);
const dependencies = { openclaw: 'file:artifacts/openclaw.tgz', '@trycua/cua-driver': 'file:artifacts/cua-sdk.tgz', '@trycua/cua-driver-win32-x64-msvc': 'file:artifacts/cua-win.tgz' };
assert.deepEqual(lock.packages[''].dependencies, dependencies);
const identities = { '@trycua/cua-driver': [], '@trycua/cua-driver-win32-x64-msvc': [] };
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory).sort()) {
    assert(entry !== '.git' && !entry.includes('.owned-package-qa-original-'), 'build_or_unreconciled_backup_inside_slot');
    const file = path.join(directory, entry);
    const s = fs.lstatSync(file);
    assert(!s.isSymbolicLink(), 'slot_contains_reparse');
    if (s.isDirectory()) walk(file);
    else {
      assert(s.isFile(), 'slot_contains_nonregular'); within(c.root, file);
      const relative = path.relative(c.root, file).split(path.sep).join('/');
      files.push({ path: relative, bytes: s.size, sha256: hash(file) });
      if (entry === 'package.json' && /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(relative)) {
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Object.hasOwn(identities, manifest.name)) identities[manifest.name].push(relative);
      }
    }
  }
}
walk(c.root);
for (const name of Object.keys(identities)) assert.equal(identities[name].length, 1, 'duplicate_sdk_or_native_package');
const selected = await sdkResolution(c.root);
assert.equal(identities['@trycua/cua-driver'][0], path.relative(c.root, selected.sdkManifest).split(path.sep).join('/'));
assert.equal(identities['@trycua/cua-driver-win32-x64-msvc'][0], path.relative(c.root, selected.nativeManifest).split(path.sep).join('/'));
assert.equal(hash(path.join(selected.nativeDir, 'cua_driver_sdk.dll')), c.binding.finalDllSha256);
assert.equal(hash(path.join(selected.nativeDir, 'cua_driver_node_runtime.node')), c.binding.officialAddonSha256);
fs.writeFileSync(output, JSON.stringify({ schema: 1, expandedRootOnly: true, liveActivation: false, releaseBindingsSha256: hash(c.bindingFile), packageLockSha256: hash(path.join(c.root, 'package-lock.json')), matrixReceiptSha256: hash(matrixFile), selectedSdkManifest: identities['@trycua/cua-driver'][0], selectedNativeManifest: identities['@trycua/cua-driver-win32-x64-msvc'][0], files }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ regularFilesInventoried: files.length, sdkCopies: 1, nativeCopies: 1, reparseAccepted: false, inventoryPlatform: process.platform, activationAccepted: false }));
