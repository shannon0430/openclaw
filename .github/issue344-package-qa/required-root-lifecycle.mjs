// Read-only QA gate for the created slot's exact OpenClaw root dependency.
// npm11.17 allow-scripts null entries are advisory, not proof of blocked scripts.
// Marker closure follows pinned scripts/install.ps1 Test-NpmLifecycleCompleted;
// no lifecycle execution, config change, blanket permission or automatic replay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

function ordinaryDirectory(p) {
  const s = fs.lstatSync(p);
  assert(s.isDirectory() && !s.isSymbolicLink(), 'qa_lifecycle_directory_not_ordinary');
}
function ordinaryFile(p) {
  const s = fs.lstatSync(p);
  assert(s.isFile() && !s.isSymbolicLink(), 'qa_lifecycle_leaf_not_ordinary');
  return p;
}
function markerAbsent(p) {
  try { fs.lstatSync(p); }
  catch (e) {
    if (e?.code === 'ENOENT') return true;
    throw new Error('qa_lifecycle_marker_unreadable');
  }
  return false; // A regular file, directory or dangling symlink all mean present.
}

export function assertRequiredRootLifecycle(slot) {
  const root = path.resolve(slot);
  ordinaryDirectory(root);
  const declared = JSON.parse(fs.readFileSync(ordinaryFile(path.join(root, 'package.json')), 'utf8'));
  assert(declared.private === true && declared.name === 'forone-kanon-issue344-node-slot', 'qa_lifecycle_slot_identity_mismatch');
  assert(declared.dependencies?.openclaw === 'file:artifacts/openclaw.tgz', 'qa_lifecycle_root_dependency_mismatch');
  const bindings = JSON.parse(fs.readFileSync(ordinaryFile(path.join(root, 'release-bindings.json')), 'utf8'));
  assert(/^[a-f0-9]{64}$/.test(bindings.openclawTarSha256), 'qa_lifecycle_root_digest_missing');
  ordinaryDirectory(path.join(root, 'artifacts'));
  const tar = ordinaryFile(path.join(root, 'artifacts', 'openclaw.tgz'));
  assert.equal(createHash('sha256').update(fs.readFileSync(tar)).digest('hex'), bindings.openclawTarSha256, 'qa_lifecycle_root_digest_mismatch');
  const modules = path.join(root, 'node_modules');
  const pkg = path.join(modules, 'openclaw');
  ordinaryDirectory(modules); ordinaryDirectory(pkg); ordinaryDirectory(path.join(pkg, 'dist'));
  const installed = JSON.parse(fs.readFileSync(ordinaryFile(path.join(pkg, 'package.json')), 'utf8'));
  assert(installed.name === 'openclaw', 'qa_lifecycle_installed_identity_mismatch');
  ordinaryFile(path.join(pkg, 'dist', 'entry.js'));
  assert(markerAbsent(path.join(pkg, '.openclaw-lifecycle-pending')), 'qa_lifecycle_required_root_pending');
  assert(markerAbsent(path.join(pkg, 'dist', 'openclaw-install-guard')), 'qa_lifecycle_legacy_guard_present');
  return {
    schemaVersion: 1,
    requiredRootLifecycleCompleted: true,
    requiredRootIdentity: 'openclaw:file:artifacts/openclaw.tgz',
    requiredRootTarSha256: bindings.openclawTarSha256,
    ordinaryEntryVerified: true,
    pendingMarkerAbsent: true,
    legacyGuardAbsent: true,
    packageLifecycleExecutions: 0,
    dependencyLifecycleTraceClaimed: false,
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.platform === 'win32' && process.arch === 'x64' && process.version === 'v24.19.0', 'actual_windows_node_required');
  console.log(JSON.stringify(assertRequiredRootLifecycle(process.argv[2])));
}
