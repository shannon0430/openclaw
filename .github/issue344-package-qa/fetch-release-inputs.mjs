// Read-only GitHub REST consumer. No publication, upload or scope fallback.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, ASSETS, digest, positive, hash, validateManifest, validatePublicProjection, verifyProposal } from './transfer-core.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const [destination]=process.argv.slice(2);
const releaseId=positive(Number(process.env.ISSUE344_RELEASE_ID));
const manifestId=positive(Number(process.env.ISSUE344_MANIFEST_ASSET_ID));
const manifestSha=digest(process.env.ISSUE344_TRANSFER_MANIFEST_SHA256);
const proposalSha=digest(process.env.ISSUE344_PROPOSAL_MANIFEST_SHA256);
assert(destination && process.platform==='win32' && process.arch==='x64' && process.version==='v24.19.0','clean_windows_node_required');
verifyProposal(here,proposalSha);
const token=process.env.GH_TOKEN;assert(token && token.length>0,'read_token_missing');
const base='https://api.github.com/repos/'+REPOSITORY;
const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'};
async function json(url) { const r=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(120000)});assert(r.ok,'release_or_ci_not_readable_with_readonly_token');const text=await r.text();assert(Buffer.byteLength(text)<2097152,'metadata_unbounded');return JSON.parse(text); }
async function verifyTag(tag,expected) {
  const ref=await json(base+'/git/ref/tags/'+encodeURIComponent(tag));assert(ref.ref==='refs/tags/'+tag,'tag_ref_identity_changed');
  let object=ref.object;const seen=new Set();
  for(let depth=0;object.type==='tag';depth++) {assert(depth<4&&!seen.has(object.sha),'tag_dereference_unbounded');seen.add(object.sha);const t=await json(base+'/git/tags/'+object.sha);assert(t.sha===object.sha,'annotated_tag_identity_changed');object=t.object;}
  assert(object.type==='commit'&&object.sha===expected,'actual_tag_commit_changed');return {ref:ref.ref,commitSha:object.sha};
}
async function metadata(id) { const a=await json(base+'/releases/assets/'+id);assert(a.id===id && a.state==='uploaded','asset_not_uploaded');return a; }
async function download(id,file,bytes,expected) {
  assert(!fs.existsSync(file),'download_replay_forbidden');
  let r=await fetch(base+'/releases/assets/'+id,{headers:{...headers,Accept:'application/octet-stream'},redirect:'manual',signal:AbortSignal.timeout(600000)});
  if(r.status===302) { const u=new URL(r.headers.get('location'));assert(u.protocol==='https:' && u.hostname==='release-assets.githubusercontent.com','unexpected_asset_redirect');r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(600000)}); } // never forwards token to signed asset host
  assert(r.ok && r.body,'asset_download_failed');const fd=fs.openSync(file,'wx');let count=0;const h=createHash('sha256');
  try { for await(const chunk of r.body) { const b=Buffer.from(chunk);count+=b.length;assert(count<=bytes,'asset_size_exceeded');h.update(b);assert(fs.writeSync(fd,b)===b.length,'short_asset_write'); }fs.fsyncSync(fd); } finally {fs.closeSync(fd);}
  assert(count===bytes && h.digest('hex')===expected && hash(file)===expected,'actual_download_digest_mismatch');
}
try {
  const release=await json(base+'/releases/'+releaseId);assert(release.id===releaseId && release.draft===false && release.prerelease===true && Array.isArray(release.assets),'pinned_qa_prerelease_not_readable');
  const index=await metadata(manifestId);assert(index.name==='issue344-package-transfer.json' && index.size>0 && index.size<16777216,'manifest_asset_invalid');
  assert(release.assets.filter(a=>a.id===manifestId).length===1,'manifest_not_in_release');if(index.digest)assert(index.digest==='sha256:'+manifestSha,'manifest_api_digest_mismatch');
  const root=path.resolve(destination);assert(!fs.existsSync(root),'new_transfer_directory_required');fs.mkdirSync(root,{recursive:false});
  const manifestFile=path.join(root,index.name);await download(manifestId,manifestFile,index.size,manifestSha);
  const m=validateManifest(JSON.parse(fs.readFileSync(manifestFile,'utf8')));assert(m.release.id===releaseId && m.proposalManifestSha256===proposalSha,'dispatch_binding_mismatch');
  assert(release.tag_name===m.release.tag && release.target_commitish===m.release.targetCommitish && release.name==='INTERNAL QA ONLY — unofficial Issue344 '+m.finalOpenclawSourceCommit.slice(0,16) && release.body.includes('NOT official CUA/OpenClaw release'),'release_commit_or_qa_label_drift');
  const actualTag=await verifyTag(m.release.tag,m.finalOpenclawSourceCommit);
  assert(release.assets.length===m.assets.length+1,'release_asset_scope_changed');
  const paths={};const downloaded=[];
  for(const a of m.assets) {
    const x=await metadata(a.id);assert(x.name===a.name && x.size===a.bytes && release.assets.filter(y=>y.id===a.id).length===1,'asset_identity_drift');if(x.digest)assert(x.digest==='sha256:'+a.sha256,'asset_api_digest_mismatch');
    const file=path.join(root,a.name);await download(a.id,file,a.bytes,a.sha256);paths[a.key]=file;downloaded.push({key:a.key,id:a.id,name:a.name,bytes:a.bytes,sha256:hash(file)});
  }
  for(const key of Object.keys(ASSETS).filter(k=>!k.endsWith('Tar')&&k!=='sourceReleaseEligibilityReceipt'))validatePublicProjection(key,JSON.parse(fs.readFileSync(paths[key],'utf8')));
  const proof=JSON.parse(fs.readFileSync(paths.sourceReleaseEligibilityReceipt,'utf8'));assert.deepEqual(proof,m.eligibility,'eligibility_copy_changed');
  const n=m.eligibility.focusedNative;const focusedRun=await json('https://api.github.com/repos/'+n.repository+'/actions/runs/'+n.runId);
  assert(focusedRun.head_sha===n.headSha&&focusedRun.status==='completed'&&focusedRun.conclusion==='success'&&focusedRun.path===n.workflowPath,'focused_native_run_not_green');
  const a=m.eligibility.canonicalActivationGate;const activationRun=await json('https://api.github.com/repos/'+a.repository+'/actions/runs/'+a.runId);
  assert(activationRun.head_sha===a.dispatchHeadSha&&activationRun.path===a.workflowPath&&activationRun.head_branch===a.dispatchBranch&&activationRun.event===a.event,'canonical_activation_dispatch_identity_drift');
  const wf=await json('https://api.github.com/repos/'+a.repository+'/contents/'+a.workflowPath+'?ref='+a.dispatchHeadSha);
  assert(wf.type==='file'&&wf.encoding==='base64'&&wf.size>0&&wf.size<1048576&&createHash('sha256').update(Buffer.from(wf.content,'base64')).digest('hex')===a.workflowSha256,'canonical_activation_workflow_drift');
  const inputs={finalOpenclawSourceCommit:m.finalOpenclawSourceCommit,cuaSourceCommit:m.cuaSourceCommit,finalDllSha256:m.finalDllSha256,officialAddonSha256:m.officialAddonSha256};
  for(const key of Object.keys(ASSETS).filter(k=>k!=='sourceReleaseEligibilityReceipt'))inputs[key]={path:paths[key],sha256:m.assets.find(a=>a.key===key).sha256};
  fs.writeFileSync(path.join(root,'slot-inputs.json'),JSON.stringify(inputs,null,2)+'\n',{flag:'wx'});
  fs.writeFileSync(path.join(root,'transfer-verification.json'),JSON.stringify({schemaVersion:1,readOnlyActionsToken:true,releaseId,manifestAssetId:manifestId,manifestSha256:manifestSha,proposalManifestSha256:proposalSha,actualDownloadedAssets:downloaded,actualTagReadback:actualTag,focusedNativeApiReadback:{runId:n.runId,headSha:focusedRun.head_sha,conclusion:focusedRun.conclusion},canonicalActivationApiReadback:{runId:a.runId,dispatchHeadSha:activationRun.head_sha,workflowSha256:a.workflowSha256,status:activationRun.status,conclusion:activationRun.conclusion,sourceRefCertifiedByParent:a.sourceRef,notUsedAsDisposableQaGreen:true,liveAcceptanceStillSeparate:true},qaPrereleaseReadableWithThisReadOnlyToken:true,installationPerformed:false,sourceOwnerEligibilityStillRequired:true},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({transferVerified:true,assets:downloaded.length,qaPrereleaseReadableWithReadOnlyToken:true,installStarted:false}));
} catch {console.error(JSON.stringify({failed:true,code:'PACKAGE_TRANSFER_NOT_VERIFIED',installationStarted:false,noPermissionFallback:true}));process.exitCode=1;}
