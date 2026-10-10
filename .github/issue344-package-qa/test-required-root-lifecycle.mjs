// Actual production read-only gate on own synthetic leaves; never npm/scripts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertRequiredRootLifecycle } from './required-root-lifecycle.mjs';

const lease = fs.mkdtempSync(path.join(os.tmpdir(), 'issue344-lifecycle-gate-'));
let passed = 0;
function fixture(label) {
  const root = path.join(lease, label);
  fs.mkdirSync(path.join(root, 'node_modules', 'openclaw', 'dist'), { recursive: true });
  fs.mkdirSync(path.join(root, 'artifacts'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ private: true, name: 'forone-kanon-issue344-node-slot', dependencies: { openclaw: 'file:artifacts/openclaw.tgz' } }));
  const tar = Buffer.from('owned synthetic lifecycle gate input only');
  fs.writeFileSync(path.join(root, 'artifacts', 'openclaw.tgz'), tar);
  fs.writeFileSync(path.join(root, 'release-bindings.json'), JSON.stringify({ openclawTarSha256: createHash('sha256').update(tar).digest('hex') }));
  fs.writeFileSync(path.join(root, 'node_modules', 'openclaw', 'package.json'), JSON.stringify({ name: 'openclaw' }));
  fs.writeFileSync(path.join(root, 'node_modules', 'openclaw', 'dist', 'entry.js'), '// synthetic fixture, never executed\n');
  return root;
}
function caseOnce(label, run) { run(fixture(label)); passed++; }
try {
  caseOnce('positive', r => { const w = assertRequiredRootLifecycle(r); assert.equal(w.requiredRootLifecycleCompleted, true); assert.equal(w.packageLifecycleExecutions, 0); });
  caseOnce('pending-file', r => { fs.writeFileSync(path.join(r, 'node_modules/openclaw/.openclaw-lifecycle-pending'), ''); assert.throws(() => assertRequiredRootLifecycle(r), /required_root_pending/); });
  caseOnce('legacy-file', r => { fs.writeFileSync(path.join(r, 'node_modules/openclaw/dist/openclaw-install-guard'), ''); assert.throws(() => assertRequiredRootLifecycle(r), /legacy_guard_present/); });
  caseOnce('pending-directory', r => { fs.mkdirSync(path.join(r, 'node_modules/openclaw/.openclaw-lifecycle-pending')); assert.throws(() => assertRequiredRootLifecycle(r), /required_root_pending/); });
  caseOnce('dangling-pending-symlink', r => { fs.symlinkSync(path.join(r, 'does-not-exist'), path.join(r, 'node_modules/openclaw/.openclaw-lifecycle-pending'), 'file'); assert.throws(() => assertRequiredRootLifecycle(r), /required_root_pending/); });
  caseOnce('entry-missing', r => { fs.unlinkSync(path.join(r, 'node_modules/openclaw/dist/entry.js')); assert.throws(() => assertRequiredRootLifecycle(r)); });
  caseOnce('installed-name', r => { fs.writeFileSync(path.join(r, 'node_modules/openclaw/package.json'), '{"name":"not-openclaw"}'); assert.throws(() => assertRequiredRootLifecycle(r), /installed_identity_mismatch/); });
  caseOnce('entry-symlink', r => { const e = path.join(r, 'node_modules/openclaw/dist/entry.js'); fs.renameSync(e, e+'.own'); fs.symlinkSync(e+'.own', e, 'file'); assert.throws(() => assertRequiredRootLifecycle(r), /leaf_not_ordinary/); });
  caseOnce('declared-root-wildcard', r => { fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ private:true, name:'forone-kanon-issue344-node-slot', dependencies:{openclaw:'*'} })); assert.throws(() => assertRequiredRootLifecycle(r), /root_dependency_mismatch/); });
  caseOnce('tar-digest-change', r => { fs.appendFileSync(path.join(r, 'artifacts/openclaw.tgz'), 'changed'); assert.throws(() => assertRequiredRootLifecycle(r), /root_digest_mismatch/); });
  caseOnce('marker-unreadable-not-absent', r => {
    const original = fs.lstatSync;
    const marker = path.join(r, 'node_modules', 'openclaw', '.openclaw-lifecycle-pending');
    try {
      fs.lstatSync = function(p, ...args) { if (p === marker) { const error = new Error('owned fake metadata denial'); error.code = 'EACCES'; throw error; } return original.call(this, p, ...args); };
      assert.throws(() => assertRequiredRootLifecycle(r), /marker_unreadable/);
    } finally { fs.lstatSync = original; }
  });
  caseOnce('one-owned-relocation', r => { const after=r+'-relocated'; fs.renameSync(r,after); assert.equal(assertRequiredRootLifecycle(after).requiredRootLifecycleCompleted,true); });
  assert.equal(passed, 12);
  console.log(JSON.stringify({ schemaVersion:1, passed, failed:0, productionGate:true, actualNode:process.version,
    actualPlatform:process.platform, npmInstalls:0, packageLifecycleExecutions:0, liveOrTaskEffects:0,
    fixtureScope:'new own synthetic leaves only; not package install or Windows acceptance' }));
} finally { fs.rmSync(lease, { recursive:true, force:false }); }
