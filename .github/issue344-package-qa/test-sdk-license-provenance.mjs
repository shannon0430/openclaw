import assert from 'node:assert/strict';
import { projectPublicReceipt, validatePublicProjection, PROOF_ORIGINALS, CUA_HEAD, PACKAGE_ASSEMBLY_SOURCE, MIT_LICENSE, CANONICAL_ASSEMBLER } from './transfer-core.mjs';
// Synthetic primitives exercise production projection rules. No artifact receipt is manufactured.
const bound = PROOF_ORIGINALS.sourceSdkBuildReceipt !== null;
const fixtureOriginalSha256 = bound ? PROOF_ORIGINALS.sourceSdkBuildReceipt : 'd'.repeat(64);
const addedPrimitiveFields = ['runtimeSourceCommit','packageAssemblySourceCommit','sourceArchiveCommit','licenseSourceCommit','sourceSdkUnchangedFromPublicBase','assemblerOnlyLicensePackagingChange','licenseSha256','allPackedMitLicenseNoticesByteEqualExactSource'];
function fixture() { return {
  result: 'synthetic_source_seam_only', sourceCommit: CUA_HEAD, runtimeSourceCommit: CUA_HEAD,
  packageAssemblySourceCommit: PACKAGE_ASSEMBLY_SOURCE, sourceArchiveCommit: PACKAGE_ASSEMBLY_SOURCE, licenseSourceCommit: PACKAGE_ASSEMBLY_SOURCE,
  sourceSdkUnchangedFromPublicBase: true, sourceSdkAndCanonicalScriptsUnchangedFromPublicBase: false, assemblerOnlyLicensePackagingChange: true,
  licenseSha256: MIT_LICENSE, allPackedMitLicenseNoticesByteEqualExactSource: true, canonicalAssemblerSha256: CANONICAL_ASSEMBLER,
  archiveDetails: {privatePath:'/Users/owned/source'}, rawXml: 'private-xml-fixture', actualDellTask: {private:'excluded'},
  sourceSdkTar: {path:'/private/owned/source.tgz'}, actualWindowsPackageQa: false
}; }
const cases=[]; function test(name,fn) { fn(); cases.push(name); }
function project(original=fixture()) { return projectPublicReceipt('sourceSdkBuildReceipt',original,fixtureOriginalSha256); }
test('truthful_runtime_and_license_assembler_split_projects_verbatim',()=>{
  const original=fixture();const x=project(original);
  for(const key of addedPrimitiveFields)assert.equal(x.proof[key],original[key]);
  assert.equal(x.proof.sourceSdkAndCanonicalScriptsUnchangedFromPublicBase,false);
  assert.equal(x.proof.sourceCommit,CUA_HEAD);assert.equal(x.proof.canonicalAssemblerSha256,CANONICAL_ASSEMBLER);
  assert.equal(x.projection.createsNoNewExecutionEvidence,true);
  for(const key of ['archiveDetails','rawXml','actualDellTask','sourceSdkTar','actualWindowsPackageQa'])assert(!Object.hasOwn(x.proof,key));
  assert(!JSON.stringify(x).includes('/Users/'));assert(!JSON.stringify(x).includes('/private/'));assert(!JSON.stringify(x).includes('private-xml-fixture'));
});
for(const key of ['sourceCommit','runtimeSourceCommit'])test(key+'_assembly_commit_substitution_refused',()=>{const x=fixture();x[key]=PACKAGE_ASSEMBLY_SOURCE;assert.throws(()=>project(x),/sdk_runtime_source_provenance_changed/);});
for(const key of ['packageAssemblySourceCommit','sourceArchiveCommit','licenseSourceCommit'])test(key+'_runtime_commit_substitution_refused',()=>{const x=fixture();x[key]=CUA_HEAD;assert.throws(()=>project(x),/sdk_assembly_archive_license_provenance_changed/);});
for(const [key,value] of [['sourceSdkUnchangedFromPublicBase',false],['sourceSdkAndCanonicalScriptsUnchangedFromPublicBase',true],['assemblerOnlyLicensePackagingChange',false]])test(key+'_untruthful_scope_refused',()=>{const x=fixture();x[key]=value;assert.throws(()=>project(x),/sdk_runtime_and_assembler_change_scope_untruthful/);});
for(const [key,value] of [['licenseSha256','e'.repeat(64)],['canonicalAssemblerSha256','e'.repeat(64)],['allPackedMitLicenseNoticesByteEqualExactSource',false]])test(key+'_unproven_license_refused',()=>{const x=fixture();x[key]=value;assert.throws(()=>project(x),/sdk_delivered_license_source_not_proven/);});
for(const key of addedPrimitiveFields)test(key+'_missing_exact_primitive_refused',()=>{const x=fixture();delete x[key];assert.throws(()=>project(x));});
for(const key of addedPrimitiveFields)test(key+'_nested_private_value_refused',()=>{const x=fixture();x[key]={private:'/Users/owned/fixture'};assert.throws(()=>project(x),/nonprimitive_public_proof_field/);});
for(const key of addedPrimitiveFields)test(key+'_raw_path_value_refused',()=>{const x=fixture();x[key]='/private/owned/fixture';assert.throws(()=>project(x),/private_path_in_allowlisted_field/);});
if(bound){
  test('actual_bound_source_sdk_projection_roundtrip',()=>validatePublicProjection('sourceSdkBuildReceipt',project()));
  test('old_unlicensed_sdk_proof_binding_refused',()=>{const x=project();x.immutablePrivateReceiptSha256='b3a5bcb18580c82c8ad73ef2781dd9194920197df9d3abdf73a73a4e52e7856b';assert.throws(()=>validatePublicProjection('sourceSdkBuildReceipt',x));});
  test('extra_public_nested_private_proof_refused',()=>{const x=project();x.proof.archiveDetails={private:'excluded'};assert.throws(()=>validatePublicProjection('sourceSdkBuildReceipt',x));});
  test('extra_public_top_level_private_proof_refused',()=>{const x=project();x.privateReservation={private:'excluded'};assert.throws(()=>validatePublicProjection('sourceSdkBuildReceipt',x));});
  test('projected_archive_commit_drift_refused',()=>{const x=project();x.proof.sourceArchiveCommit=CUA_HEAD;assert.throws(()=>validatePublicProjection('sourceSdkBuildReceipt',x),/sdk_assembly_archive_license_provenance_changed/);});
}
console.log(JSON.stringify({schemaVersion:1,passed:cases.length,failed:0,cases,sourceSdkBuildReceiptBindingMaterialized:bound,scope:'production closed projection provenance seams using inert synthetic records; no receipt materialization, transfer, packaging, Windows, native, live or input execution'}));
