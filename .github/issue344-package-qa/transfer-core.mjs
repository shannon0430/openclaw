import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const FINAL_OPENCLAW = 'f3eb17ededbc2d7f10d5c9630ccad05b77431d55';
export const TAR_BINDINGS = Object.freeze({openclawTar:{sha256:'5894d14f4dbd4a9e259d79e9c5b3a89520c79b91a272dda978163266a8d14048',bytes:95907840},sourceSdkTar:{sha256:'d7f98ec0a225681383e02cfa67126893059dce94aa88587a08701205308f3b11',bytes:74125},nativeTar:{sha256:'c67d99918be009f4ed21429608b3b3383c9868c7661fb9d25cb465f16e0d46ef',bytes:9234968}});
export const REPOSITORY = 'shannon0430/openclaw';
export const CUA_HEAD = '891efae2cc01a38260a303b0329785e5c4d7b03c';
export const DLL = '601adefd44cc982dd4a1ff2e80dae8b056b971f830521d7e6acbb7dde8420f94';
export const ADDON = '93f220e8a5cbf25aff23321f20a868368a204f1026b8dce45c5a4f84290de09f';
export const ASSETS = Object.freeze({ openclawTar: 'openclaw.tgz', sourceSdkTar: 'cua-sdk.tgz', nativeTar: 'cua-win.tgz', nativeQaReceipt: 'native-qa.json', officialAddonProvenanceReceipt: 'official-addon.json', sourceSdkBuildReceipt: 'source-sdk-build.json', sourceRebakeReceipt: 'source-rebake.json', sourceReleaseEligibilityReceipt: 'source-release-eligibility.json' });
export function digest(v) { assert(typeof v==='string' && /^[a-f0-9]{64}$/.test(v) && v!=='0'.repeat(64), 'missing_final_sha256'); return v; }
export function commit(v) { assert(typeof v==='string' && /^[a-f0-9]{40}$/.test(v) && v!=='0'.repeat(40), 'missing_final_commit'); return v; }
export function positive(v) { assert(Number.isSafeInteger(v) && v>0, 'missing_positive_id'); return v; }
export function hash(file) { const h=createHash('sha256'); const fd=fs.openSync(file,'r'); const b=Buffer.allocUnsafe(1048576); try { for(;;) { const n=fs.readSync(fd,b,0,b.length,null); if(!n)break; h.update(b.subarray(0,n)); } return h.digest('hex'); } finally { fs.closeSync(fd); } }
export function ordinary(file) { const p=path.resolve(file); assert((process.platform==='win32'?fs.realpathSync(p).toLowerCase()===p.toLowerCase():fs.realpathSync(p)===p) && fs.lstatSync(p).isFile() && !fs.lstatSync(p).isSymbolicLink(), 'nonphysical_input'); return p; }
export const IMMUTABLE_PROOF_HASHES=Object.freeze({focusedNativeVerificationReceiptSha256:'40c0ce05a118bf893a96ec6891d4fba61f093d5670d2c017478ec2f7f52ead82',completePackageVerificationReceiptSha256:'d875590854904b9e26d4553f0f5dac2e9532e16af2f06ea3af6f857fa34299cf',sourceSdkBuildReceiptSha256:'e15e7999d6bc670c02d21bd71717ddc991674d3a5c842ff88644bbcebf27f386',officialAddonProvenanceReceiptSha256:'6293a94de97363275140da7f3f326ba9c38aa8f00d595efbd394826c39028099'});
function exactKeys(x,keys){assert(x&&typeof x==='object'&&!Array.isArray(x),'generic_object_required');assert.deepEqual(Object.keys(x).sort(),[...keys].sort(),'unknown_or_missing_generic_proof_field');}
export function eligibility(x,finalCommit){
  exactKeys(x,['schemaVersion','status','liveActivation','deploymentReady','windowsPackageQaAlreadyPassed','focusedNative','sourceRelease','canonicalActivationGate','immutableProofHashes']);
  assert(x.schemaVersion===1&&x.status==='accepted_for_isolated_package_qa_only'&&x.liveActivation===false&&x.deploymentReady===false&&x.windowsPackageQaAlreadyPassed===false,'false_package_or_live_acceptance');
  const n=x.focusedNative;exactKeys(n,['repository','runId','headSha','workflowPath','conclusion','unitCasesPassed','ownedFixturesPassed','node','rust']);
  assert(n.repository==='shannon0430/cua'&&n.runId===38040866092&&n.headSha===CUA_HEAD&&n.workflowPath==='.github/workflows/issue344-keyboard-native-qa.yml'&&n.conclusion==='success'&&n.unitCasesPassed===668&&n.ownedFixturesPassed===2&&n.node==='24.19.0'&&n.rust==='1.97.1','focused_native_not_proven');
  const r=x.sourceRelease;exactKeys(r,['sourceCommit','version','fullBuildExit','packageCheckExit','normalPackageHelper','completePluginSet','declarationsUiMetadata','selectionNarrowing','skipBuild']);
  assert(r.sourceCommit===commit(finalCommit)&&r.sourceCommit===FINAL_OPENCLAW&&r.version==='2026.9.6'&&r.fullBuildExit===0&&r.packageCheckExit===0&&r.normalPackageHelper==='scripts/package-openclaw-for-docker.mjs'&&r.completePluginSet===true&&r.declarationsUiMetadata===true&&r.selectionNarrowing===false&&r.skipBuild===false,'full_source_package_not_proven');
  const a=x.canonicalActivationGate;exactKeys(a,['repository','runId','dispatchHeadSha','sourceRef','workflowPath','workflowSha256','dispatchBranch','event','lane','requireGui','noSkippedCasesRequired','activationEligibility']);
  assert(a.repository==='shannon0430/cua'&&a.runId===38042245292&&a.dispatchHeadSha==='27bbeaa4940c801da76645df952815b28143f011'&&a.sourceRef===CUA_HEAD&&a.workflowPath==='.github/workflows/issue344-canonical-windows-all.yml'&&a.workflowSha256==='aca159f5198db42e26aa939b63c6903f5644a5115fec8f4fca5ef77f7107c223'&&a.dispatchBranch==='source/issue344-canonical-windows-qa-20261010'&&a.event==='workflow_dispatch'&&a.lane==='all'&&a.requireGui===true&&a.noSkippedCasesRequired===true&&a.activationEligibility==='pending_separate_live_acceptance','canonical_activation_identity_or_boundary_changed');
  exactKeys(x.immutableProofHashes,Object.keys(IMMUTABLE_PROOF_HASHES));assert.deepEqual(x.immutableProofHashes,IMMUTABLE_PROOF_HASHES,'immutable_source_proof_binding_changed');
  return x;
}
export function validateManifest(m) {
  assert(m && m.schemaVersion===1 && m.status==='materialized_reviewed_package_qa_inputs' && m.repository===REPOSITORY, 'manifest_not_materialized');
  assert(commit(m.finalOpenclawSourceCommit)===FINAL_OPENCLAW,'final_openclaw_source_drift'); assert(m.cuaSourceCommit===CUA_HEAD && m.finalDllSha256===DLL && m.officialAddonSha256===ADDON, 'native_candidate_drift'); digest(m.proposalManifestSha256);
  assert(m.release && m.release.draft===false && m.release.prerelease===true && m.release.makeLatest===false && m.release.targetCommitish===m.finalOpenclawSourceCommit && m.release.tag==='issue344-package-qa-'+m.finalOpenclawSourceCommit.slice(0,16), 'release_binding_invalid'); positive(m.release.id);
  eligibility(m.eligibility, m.finalOpenclawSourceCommit);
  assert(Array.isArray(m.assets) && m.assets.length===Object.keys(ASSETS).length, 'asset_count_invalid');
  assert(new Set(m.assets.map(a=>a.key)).size===m.assets.length && new Set(m.assets.map(a=>a.id)).size===m.assets.length, 'duplicate_assets');
  for(const [key,name] of Object.entries(ASSETS)) { const a=m.assets.find(a=>a.key===key); assert(a && a.name===name && a.state==='uploaded', 'missing_exact_asset'); positive(a.id); positive(a.bytes); digest(a.sha256); assert(a.bytes<=(key.endsWith('Tar')?1073741824:16777216), 'asset_size_unbounded'); }
  for(const [key,binding] of Object.entries(TAR_BINDINGS)){const a=m.assets.find(a=>a.key===key);assert(a.sha256===binding.sha256&&a.bytes===binding.bytes,'frozen_source_tar_drift');}
  return m;
}
export function verifyProposal(root, expected) {
  const file=ordinary(path.join(root,'PACKAGE-QA-PROPOSAL-MANIFEST.json')); assert(hash(file)===digest(expected),'proposal_manifest_hash_mismatch');
  const m=JSON.parse(fs.readFileSync(file,'utf8')); assert(m.schemaVersion===1 && m.status==='frozen_source_only_review_candidate' && m.liveActivation===false, 'proposal_not_frozen');
  assert(Array.isArray(m.files) && m.files.length>10 && new Set(m.files.map(f=>f.path)).size===m.files.length,'proposal_scope_invalid');
  for(const f of m.files) { assert(/^[A-Za-z0-9_@.+-]+(?:\/[A-Za-z0-9_@.+-]+)*$/.test(f.path) && !f.path.split('/').some(p=>p==='.'||p==='..'),'proposal_path_invalid'); assert(hash(ordinary(path.join(root,f.path)))===digest(f.sha256),'proposal_file_drift'); }
  return m;
}
export function sanitizePublicReceipt(original) {
  let redacted=0;
  function visit(v) {
    if(Array.isArray(v)) return v.map(visit);
    if(v && typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,value])=>{ assert(!/^(?:secret|password|accessToken|refreshToken|authorization|rawEnvironment|customerOriginal)$/i.test(k),'sensitive_receipt_key'); return [k,visit(value)]; }));
    if(typeof v==='string' && (/^(?:[A-Za-z]:[\\/]|\/(?:Users|private|var|tmp)\/)/.test(v))) { redacted++; return '[local_source_path_omitted]'; }
    return v;
  }
  const value=visit(original); assert(value && typeof value==='object' && !Array.isArray(value),'receipt_object_required');
  return { ...value, transportSanitization: { localPathsOmitted:redacted, originalParsedJsonSha256:createHash('sha256').update(JSON.stringify(original)).digest('hex'), executionStatusFieldsUnchanged:true, createsNoNewExecutionEvidence:true } };
}
export function projectPublicReceipt(kind, original, originalFileSha256) {
  // Deliberate source/build-QA allowlists, not a promise of generic sanitization.
  // Private deployment receipts, paths, logs/XML/environment/config are excluded.
  const allow = {
    nativeQaReceipt: ['runId','runUrl','headSha','conclusion','archiveSha256','apiArchiveDigestVerified','sourceManifestSha256','keyboardPatchSha256','passedUnitCases','nativeCompilationVerified','totalSelectedTestsPassed','ownedFixturesPassed','workflowSha256','authorManifestSha256','verificationConclusion','liveWrites'],
    officialAddonProvenanceReceipt: ['result','package','version','actualTarBytes','actualTarSha256','actualTarSha1','actualTarIntegrity','integrityMatchesRegistryAndNormalPack','allMembersRegular','acceptedRegularAddonSha256','license','requiredNoticeSha256','noticeByteEqualsExactCandidateSource','baselineDllNotUsedAsCandidate','installationPerformed','registrySignatureOrAttestationCryptographicVerification'],
    sourceSdkBuildReceipt: ['result','sourceCommit','baseCommit','sourceSdkAndCanonicalScriptsUnchangedFromPublicBase','frozenAssemblyManifestSha256','sourceArchiveSha256','sourceArchiveBytes','sourceArchiveFiles','npmCiExit','normalBuildExit','canonicalPackExit','canonicalAssemblerSha256','allPackedSdkFilesByteMatchSourceBuiltDist','allTarMembersRegular','candidateNativeOnlyWindowsX64Pair','requiredNoticeRetainedAndByteEqualExactSourceAndOfficialTar','sourceSdkContainsNoColocatedOrOtherPlatformNativeBinary'],
    sourceRebakeReceipt: ['status','sourceSha','sourceClean','tarSha256','tarBytes','entries','regularFiles','uncompressedBytes','allCanonicalPluginManifests','allCanonicalBundledPluginPackArtifacts','sourceLicenseByteEquality','packInventoryModeSizePathEquality','pluginManifestOnlyExpectedRuntimeEntryRewrite','standardPackTarballIntegrityCheck','fullDefaultBuildNoSkipOrPluginNarrowing','inventorySha256','packReceiptSha256','buildLogSha256','artifactKind','windowsProductionInstallAndFreshImportQa','fullCanonicalWindowsGate','deploymentReady','liveWrites','businessReplays']
  };
  assert(allow[kind] && original && typeof original==='object'&&!Array.isArray(original),'unsupported_public_proof_kind');
  const proof={};
  for(const key of allow[kind]) if(Object.hasOwn(original,key)) {
    const v=original[key];assert(['string','number','boolean'].includes(typeof v),'nonprimitive_public_proof_field');
    if(key==='runUrl')assert(/^https:\/\/github\.com\/shannon0430\/cua\/actions\/runs\/[0-9]+$/.test(v),'unexpected_public_run_url');
    else if(typeof v==='string')assert(!/(?:[A-Za-z]:[\\/]|\/(?:Users|private|var|tmp)\/)/.test(v),'private_path_in_allowlisted_field');
    proof[key]=v;
  }
  assert(Object.keys(proof).length>=3,'source_proof_too_sparse');
  if(original.toolchain)proof.toolchain=Object.fromEntries(['node','npm','rustc','cargo','rustTarget','platform','arch'].filter(k=>Object.hasOwn(original.toolchain,k)).map(k=>{const v=original.toolchain[k];assert(typeof v==='string'&&!/(?:[A-Za-z]:[\\/]|\/(?:Users|private|var|tmp)\/)/.test(v),'private_toolchain_field');return[k,v];}));
  return {schemaVersion:1,status:'public_projection_of_immutable_source_qa_proof',kind,immutablePrivateReceiptSha256:digest(originalFileSha256),proof,projection:{explicitAllowlist:true,localPathsRawLogsXmlEnvironmentTaskProcessCompanionActivationMetadataExcluded:true,originalIncludedFieldsUnchanged:true,createsNoNewExecutionEvidence:true,exhaustiveGenericSanitizationClaim:false}};
}
export const PROOF_ORIGINALS=Object.freeze({nativeQaReceipt:IMMUTABLE_PROOF_HASHES.focusedNativeVerificationReceiptSha256,officialAddonProvenanceReceipt:IMMUTABLE_PROOF_HASHES.officialAddonProvenanceReceiptSha256,sourceSdkBuildReceipt:IMMUTABLE_PROOF_HASHES.sourceSdkBuildReceiptSha256,sourceRebakeReceipt:IMMUTABLE_PROOF_HASHES.completePackageVerificationReceiptSha256});
export function validatePublicProjection(kind,x){assert(PROOF_ORIGINALS[kind],'unknown_projection_kind');assert.deepEqual(x,projectPublicReceipt(kind,x.proof,PROOF_ORIGINALS[kind]),'public_projection_unknown_or_private_field');return x;}
