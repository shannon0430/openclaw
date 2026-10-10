// SOURCE ONLY: parent management-seat executor; child must not invoke it.
// No clobber, production publication, overwrite, retry, or credential fallback. Journal exists => refuse replay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { REPOSITORY, ASSETS, FINAL_OPENCLAW, TAR_BINDINGS, CUA_HEAD, DLL, ADDON, hash, ordinary, digest, commit, eligibility, validateManifest, validatePublicProjection, verifyProposal } from './transfer-core.mjs';
const [preparedFile,newJournalDirectory]=process.argv.slice(2);assert(preparedFile&&newJournalDirectory,'required_inputs');
const p=JSON.parse(fs.readFileSync(ordinary(preparedFile),'utf8'));assert(commit(p.finalOpenclawSourceCommit)===FINAL_OPENCLAW,'final_openclaw_source_drift');digest(p.proposalManifestSha256);verifyProposal(path.dirname(fileURLToPath(import.meta.url)),p.proposalManifestSha256);
assert(p.schemaVersion===1&&p.publicSourceLicenseOnlyOwnerReviewed===true&&p.cuaSourceCommit===CUA_HEAD&&p.finalDllSha256===DLL&&p.officialAddonSha256===ADDON,'prepared_source_not_reviewed');eligibility(p.eligibility,p.finalOpenclawSourceCommit);
assert(Array.isArray(p.assets)&&p.assets.length===8&&new Set(p.assets.map(a=>a.key)).size===8,'prepared_assets_invalid');
for(const [key,name] of Object.entries(ASSETS)) {const a=p.assets.find(a=>a.key===key);assert(a&&a.name===name&&path.basename(a.path)===name,'prepared_identity_invalid');assert(Number.isSafeInteger(a.bytes)&&a.bytes>0&&a.bytes<=(key.endsWith('Tar')?1073741824:16777216),'unbounded_prepared_asset');if(TAR_BINDINGS[key])assert(a.sha256===TAR_BINDINGS[key].sha256&&a.bytes===TAR_BINDINGS[key].bytes,'frozen_source_tar_drift');ordinary(a.path);assert(hash(a.path)===digest(a.sha256)&&fs.statSync(a.path).size===a.bytes,'prepared_digest_changed');}
for(const a of p.assets.filter(a=>!a.key.endsWith('Tar')&&a.key!=='sourceReleaseEligibilityReceipt'))validatePublicProjection(a.key,JSON.parse(fs.readFileSync(a.path,'utf8')));
const actualEligibility=JSON.parse(fs.readFileSync(p.assets.find(a=>a.key==='sourceReleaseEligibilityReceipt').path,'utf8'));eligibility(actualEligibility,p.finalOpenclawSourceCommit);assert.deepEqual(actualEligibility,p.eligibility,'eligibility_asset_drift');
assert(!fs.existsSync(newJournalDirectory),'single_flight_journal_already_exists');fs.mkdirSync(newJournalDirectory);
const journal=path.join(newJournalDirectory,'pending-and-readback.jsonl');const initial=fs.openSync(journal,'wx');fs.closeSync(initial);
function event(v){const fd=fs.openSync(journal,'a');try{fs.writeSync(fd,JSON.stringify({...v,at:new Date().toISOString()})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function gh(args,outFd){const r=spawnSync('gh',args,{stdio:outFd===undefined?['ignore','pipe','pipe']:['ignore',outFd,'pipe'],encoding:outFd===undefined?'utf8':undefined,maxBuffer:2097152});assert(r.status===0,'manager_action_or_readback_unknown');return outFd===undefined?r.stdout:undefined;}
function release(){return JSON.parse(gh(['api','repos/'+REPOSITORY+'/releases/tags/'+tag]));}
function actualTag(){
 const r=JSON.parse(gh(['api','repos/'+REPOSITORY+'/git/ref/tags/'+tag]));assert(r.ref==='refs/tags/'+tag,'tag_ref_changed');let object=r.object;const seen=new Set();
 for(let depth=0;object.type==='tag';depth++){assert(depth<4&&!seen.has(object.sha),'tag_dereference_unbounded');seen.add(object.sha);const t=JSON.parse(gh(['api','repos/'+REPOSITORY+'/git/tags/'+object.sha]));assert(t.sha===object.sha,'annotated_tag_changed');object=t.object;}
 assert(object.type==='commit'&&object.sha===p.finalOpenclawSourceCommit,'actual_tag_commit_changed');return object.sha;
}
function checkRelease(r){assert(r.id>0&&r.draft===false&&r.prerelease===true&&r.tag_name===tag&&r.target_commitish===p.finalOpenclawSourceCommit&&r.name==='INTERNAL QA ONLY — unofficial Issue344 '+p.finalOpenclawSourceCommit.slice(0,16)&&r.body.includes('NOT official CUA/OpenClaw release'),'release_identity_changed');actualTag();return r;}
const tag='issue344-package-qa-'+p.finalOpenclawSourceCommit.slice(0,16);let current;
try{
 const refs=JSON.parse(gh(['api','repos/'+REPOSITORY+'/git/matching-refs/tags/'+tag]));assert(Array.isArray(refs)&&!refs.some(r=>r.ref==='refs/tags/'+tag),'preexisting_tag_refused');
 event({intent:'create_internal_qa_prerelease',repository:REPOSITORY,tag,target:p.finalOpenclawSourceCommit,automaticReplay:false});
 const notes=path.join(newJournalDirectory,'qa-prerelease-notes.txt');fs.writeFileSync(notes,'INTERNAL QA ONLY — unofficial fork prerelease. Source/license-only owned Issue344 package QA inputs. NOT official CUA/OpenClaw release, npm publication, deployed runtime, or Excel acceptance.\n',{flag:'wx'});
 gh(['release','create',tag,'--repo',REPOSITORY,'--prerelease','--latest=false','--target',p.finalOpenclawSourceCommit,'--title','INTERNAL QA ONLY — unofficial Issue344 '+p.finalOpenclawSourceCommit.slice(0,16),'--notes-file',notes]);
 current=checkRelease(release());assert(current.assets.length===0,'qa_prerelease_not_empty');event({confirmed:'internal_qa_prerelease_created',releaseId:current.id});
 function upload(file,name,expected,bytes){
  event({intent:'upload_asset_once',releaseId:current.id,name,sha256:expected,bytes,automaticReplay:false});
  gh(['release','upload',tag,file,'--repo',REPOSITORY]); // deliberately NO --clobber
  const r=checkRelease(release());const matches=r.assets.filter(a=>a.name===name);assert(matches.length===1,'uploaded_asset_not_unique');const a=matches[0];assert(a.state==='uploaded'&&a.size===bytes,'uploaded_asset_size_or_state');if(a.digest)assert(a.digest==='sha256:'+expected,'uploaded_api_digest');
  const downloaded=path.join(newJournalDirectory,'readback-'+a.id);const fd=fs.openSync(downloaded,'wx');try{gh(['api','repos/'+REPOSITORY+'/releases/assets/'+a.id,'-H','Accept: application/octet-stream'],fd);}finally{fs.closeSync(fd);}
  assert(fs.statSync(downloaded).size===bytes&&hash(downloaded)===expected,'uploaded_actual_readback_mismatch');fs.unlinkSync(downloaded);event({confirmed:'asset_uploaded_and_actual_download_rehashed',releaseId:current.id,assetId:a.id,name,sha256:expected,bytes});
  return{id:a.id,name,bytes,sha256:expected,state:'uploaded'};
 }
 const assets=[];for(const a of p.assets)assets.push({key:a.key,...upload(a.path,a.name,a.sha256,a.bytes)});
 const m=validateManifest({schemaVersion:1,status:'materialized_reviewed_package_qa_inputs',repository:REPOSITORY,release:{id:current.id,tag,draft:false,prerelease:true,makeLatest:false,targetCommitish:p.finalOpenclawSourceCommit},finalOpenclawSourceCommit:p.finalOpenclawSourceCommit,cuaSourceCommit:CUA_HEAD,finalDllSha256:DLL,officialAddonSha256:ADDON,proposalManifestSha256:p.proposalManifestSha256,eligibility:p.eligibility,assets});
 const file=path.join(newJournalDirectory,'issue344-package-transfer.json');fs.writeFileSync(file,JSON.stringify(m,null,2)+'\n',{flag:'wx'});const index=upload(file,path.basename(file),hash(file),fs.statSync(file).size);
 const final=checkRelease(release());assert(final.assets.length===9,'final_release_asset_scope');
 const dispatch={releaseId:current.id,manifestAssetId:index.id,transferManifestSha256:index.sha256,proposalManifestSha256:p.proposalManifestSha256,publicQaPrereleaseReadWithActionsContentsRead:'unrun_not_assumed',dispatchPerformed:false};
 fs.writeFileSync(path.join(newJournalDirectory,'parent-dispatch-inputs.json'),JSON.stringify(dispatch,null,2)+'\n',{flag:'wx'});event({confirmed:'all_upload_readbacks_complete',...dispatch});console.log(JSON.stringify(dispatch));
}catch{event({outcome:'unknown_or_not_verified',automaticReplay:false,readOnlyReconciliationRequired:true});console.error(JSON.stringify({failed:true,code:'QA_PRERELEASE_TRANSFER_NOT_VERIFIED',replayAllowed:false}));process.exitCode=1;}
