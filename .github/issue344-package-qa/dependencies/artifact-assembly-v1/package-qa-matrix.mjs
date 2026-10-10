// Reviewable proposal: reversible leaf-only negatives inside ONE disposable
// installed Windows QA slot. Never invoke on managed/live package paths.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hash, ownedContext, sdkResolution, verifyInputClosure, within } from './package-qa-probe.mjs';

const [slot] = process.argv.slice(2);
assert(slot, 'slot_required');
const owned = ownedContext(slot);
verifyInputClosure(owned);
const c = await sdkResolution(slot); // Does NOT import the native SDK/addon.
const script = fileURLToPath(new URL('./package-qa-probe.mjs', import.meta.url));
const pending = path.join(c.root, '.package-qa-matrix-pending.json');
const receipt = path.join(c.root, 'package-qa-matrix-receipt.json');
assert(!fs.existsSync(pending), 'prior_negative_requires_reconciliation');
assert(!fs.existsSync(receipt), 'matrix_replay_forbidden');
const results = [];

function fresh(expected) {
  const child = spawnSync(process.execPath, [script, 'doctor', c.root, expected], { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
  assert.equal(child.status, 0, 'fresh_production_verifier_failed');
  const result = JSON.parse(child.stdout.trim());
  assert.equal(result.productionVerifier, true);
  assert.equal(result.expected, expected);
  return result;
}
function durableJournal(value) {
  // Exclusive initial journal is persisted BEFORE the first leaf mutation.
  const fd = fs.openSync(pending, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}
function negative(label, file, expected, mutation) {
  within(c.root, file);
  assert(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink());
  const preimage = hash(file);
  const backup = file + '.owned-package-qa-original-' + randomUUID();
  assert(!fs.existsSync(backup));
  const relativeLeaf = path.relative(c.root, file).split(path.sep).join('/');
  const relativeBackup = path.relative(c.root, backup).split(path.sep).join('/');
  durableJournal({ schemaVersion: 1, purpose: 'disposable_negative_only', label, originalLeaf: relativeLeaf, originalBackup: relativeBackup, originalSha256: preimage, state: 'pending_before_rename', automaticReplayAllowed: false });
  let renamed = false; let created = false; let primary;
  try {
    fs.renameSync(file, backup); renamed = true;
    if (mutation !== 'missing') {
      if (mutation === 'symlink') fs.symlinkSync(backup, file, 'file');
      else {
        fs.copyFileSync(backup, file, fs.constants.COPYFILE_EXCL);
        created = true;
        if (mutation === 'tamper') {
          const fd = fs.openSync(file, 'r+');
          try {
            const byte = Buffer.alloc(1); assert.equal(fs.readSync(fd, byte, 0, 1, 0), 1);
            byte[0] ^= 1; assert.equal(fs.writeSync(fd, byte, 0, 1, 0), 1); fs.fsyncSync(fd);
          } finally { fs.closeSync(fd); }
        } else {
          assert.equal(mutation, 'version');
          const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
          assert.equal(manifest.version, '0.28.2'); manifest.version = '0.28.3';
          fs.writeFileSync(file, JSON.stringify(manifest) + '\n');
        }
      }
      created = true;
    }
    const observed = fresh(expected);
    results.push({ label, expected, observed: observed.observed, freshProcess: true });
  } catch (error) { primary = error; }
  finally {
    // Only our exact known leaf/backup is restored. Never delete/merge a tree.
    // Any uncertain/unexpected state leaves the durable journal for its owner.
    if (renamed) {
      assert.equal(hash(backup), preimage, 'negative_backup_changed');
      if (created) {
        const s = fs.lstatSync(file);
        assert(s.isFile() || s.isSymbolicLink(), 'negative_leaf_identity_changed');
        fs.unlinkSync(file);
      } else assert(!fs.existsSync(file), 'unknown_leaf_at_restore');
      fs.renameSync(backup, file);
    }
    assert.equal(hash(file), preimage, 'negative_restore_mismatch');
    fs.unlinkSync(pending);
  }
  if (primary) throw primary;
  fresh('pass'); // Prove exact restored generation before the next negative.
}

results.push({ label: 'positive', ...fresh('pass'), freshProcess: true });
for (const leaf of ['cua_driver_sdk.dll', 'cua_driver_node_runtime.node']) {
  const file = path.join(c.nativeDir, leaf);
  negative('missing_' + leaf, file, 'COMPUTER_DRIVER_PACKAGE_MISSING', 'missing');
  negative('tamper_' + leaf, file, 'COMPUTER_DRIVER_DIGEST_MISMATCH', 'tamper');
  // Windows privileges must permit a REAL file symlink. Refusal is a blocked
  // matrix, never a skipped/pass case or lstat/mock substitute.
  negative('symlink_' + leaf, file, 'COMPUTER_DRIVER_DIGEST_MISMATCH', 'symlink');
}
negative('sdk_version', c.sdkManifest, 'COMPUTER_DRIVER_VERSION_MISMATCH', 'version');
negative('native_version', c.nativeManifest, 'COMPUTER_DRIVER_VERSION_MISMATCH', 'version');
verifyInputClosure(owned);
assert.equal(results.length, 9);
fs.writeFileSync(receipt, JSON.stringify({ schemaVersion: 1, releaseBindingsSha256: hash(owned.bindingFile), actualProductionVerifier: true, freshCandidateProcessEachCheck: true, nativeInput: false, negatives: 8, results, restored: true }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ actualProductionVerifier: true, positive: 1, negatives: 8, originalLeavesRestored: true, freshProcessEachCheck: true }));
