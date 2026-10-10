// Parent execution only after exact full build and canonical all/GUI gate.
// It prepares public/source receipt copies; no GitHub write or Windows command.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSETS, PROOF_ORIGINALS, FINAL_OPENCLAW, TAR_BINDINGS, DLL, ADDON, CUA_HEAD, digest, commit, hash, ordinary, eligibility, projectPublicReceipt, verifyProposal } from './transfer-core.mjs';
const [inputFile,out]=process.argv.slice(2);assert(inputFile&&out,'input_required');
const source=JSON.parse(fs.readFileSync(ordinary(inputFile),'utf8'));
assert(commit(source.finalOpenclawSourceCommit)===FINAL_OPENCLAW,'final_openclaw_source_drift');assert(source.cuaSourceCommit===CUA_HEAD && source.finalDllSha256===DLL && source.officialAddonSha256===ADDON,'candidate_drift');digest(source.proposalManifestSha256);verifyProposal(path.dirname(fileURLToPath(import.meta.url)),source.proposalManifestSha256);
eligibility(source.eligibility,source.finalOpenclawSourceCommit);assert(source.publicSourceLicenseOnlyOwnerReviewed===true,'public_inputs_not_reviewed');
const files=[];
for(const [key,name] of Object.entries(ASSETS)) {
  if(key==='sourceReleaseEligibilityReceipt')continue;
  const x=source[key];assert(x && x.path,'input_missing');ordinary(x.path);assert(hash(x.path)===digest(x.sha256),'input_digest_mismatch');
  if(PROOF_ORIGINALS[key])assert(x.sha256===PROOF_ORIGINALS[key],'immutable_source_proof_drift');
  if(TAR_BINDINGS[key])assert(x.sha256===TAR_BINDINGS[key].sha256&&fs.statSync(x.path).size===TAR_BINDINGS[key].bytes,'frozen_source_tar_drift');
  files.push({key,name,path:x.path,originalSha256:x.sha256});
}
assert(!fs.existsSync(out),'new_prepared_directory_required');fs.mkdirSync(out);
const assets=[];
for(const f of files) {
  const target=path.join(out,f.name);
  if(f.key.endsWith('Tar'))fs.copyFileSync(f.path,target,fs.constants.COPYFILE_EXCL);
  else { const original=JSON.parse(fs.readFileSync(f.path,'utf8'));const publicCopy=projectPublicReceipt(f.key,original,f.originalSha256);fs.writeFileSync(target,JSON.stringify(publicCopy,null,2)+'\n',{flag:'wx'}); }
  assets.push({key:f.key,name:f.name,path:fs.realpathSync(target),bytes:fs.statSync(target).size,sha256:hash(target),originalSha256:f.originalSha256});
}
const eligibilityFile=path.join(out,ASSETS.sourceReleaseEligibilityReceipt);fs.writeFileSync(eligibilityFile,JSON.stringify(source.eligibility,null,2)+'\n',{flag:'wx'});assets.push({key:'sourceReleaseEligibilityReceipt',name:ASSETS.sourceReleaseEligibilityReceipt,path:fs.realpathSync(eligibilityFile),bytes:fs.statSync(eligibilityFile).size,sha256:hash(eligibilityFile)});
const prepared={schemaVersion:1,finalOpenclawSourceCommit:source.finalOpenclawSourceCommit,cuaSourceCommit:CUA_HEAD,finalDllSha256:DLL,officialAddonSha256:ADDON,proposalManifestSha256:source.proposalManifestSha256,eligibility:source.eligibility,assets,publicSourceLicenseOnlyOwnerReviewed:source.publicSourceLicenseOnlyOwnerReviewed};
assert(prepared.publicSourceLicenseOnlyOwnerReviewed===true,'public_inputs_not_reviewed');fs.writeFileSync(path.join(out,'prepared-inputs.json'),JSON.stringify(prepared,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({prepared:true,artifactsAndProofs:assets.length,receiptsSanitized:true,executionStatusesUnchanged:true,uploadPerformed:false}));
