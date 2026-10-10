# No live target, node start, scheduled task, release upload or Git write.
param([Parameter(Mandatory=$true)][string]$InputsRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$proposal=$PSScriptRoot
if ($env:OS -ne 'Windows_NT' -or [IntPtr]::Size -ne 8) { throw 'windows_x64_required' }
if ($env:GH_TOKEN) { throw 'install_must_not_inherit_release_token' }
$node=(Get-Command node.exe -ErrorAction Stop).Source
$npm=(Get-Command npm.cmd -ErrorAction Stop).Source
if ((& $node --version).Trim() -ne 'v24.19.0' -or (& $npm --version).Trim() -ne '11.17.0') { throw 'exact_node_npm_required' }
$base=Join-Path (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Temp') ('kanon-issue344-package-qa-'+[Guid]::NewGuid().ToString('N'))
if ($base -notmatch '^[Cc]:\\' -or (Test-Path -LiteralPath $base)) { throw 'new_owned_c_drive_root_required' }
New-Item -ItemType Directory -Path $base -ErrorAction Stop | Out-Null
$evidence=Join-Path $base 'evidence'; New-Item -ItemType Directory -Path $evidence | Out-Null
$slotA=Join-Path $base 'slot-before'; $slotB=Join-Path $base 'slot-after'
$utf8=New-Object Text.UTF8Encoding($false)
function Write-NewJson([string]$file,$value) { if (Test-Path -LiteralPath $file) { throw 'receipt_replay_forbidden' }; [IO.File]::WriteAllText($file,($value | ConvertTo-Json -Depth 30)+"`n",$utf8) }
function Run-Node([string]$label,[string[]]$Arguments) {
    $log=Join-Path $evidence ($label+'.log'); if (Test-Path -LiteralPath $log) { throw 'probe_replay_forbidden' }
    $output=& $node @Arguments 2>&1
    [IO.File]::WriteAllText($log,($output -join "`n")+"`n",$utf8)
    if ($LASTEXITCODE -ne 0) { throw ('required_node_probe_failed_'+$label) }
    return (($output -join "`n") | ConvertFrom-Json)
}
function Run-51([string]$label,[string[]]$Arguments) {
    $ps51="$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $output=& $ps51 -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass @Arguments 2>&1
    [IO.File]::WriteAllText((Join-Path $evidence ($label+'.log')),($output -join "`n")+"`n",$utf8)
    if ($LASTEXITCODE -ne 0) { throw ('required_windows_51_probe_failed_'+$label) }
    return (($output -join "`n") | ConvertFrom-Json)
}
function Public-Probes([string]$generation,[string]$slot) {
    $probe=Join-Path $proposal 'dependencies/artifact-assembly-v1/package-qa-probe.mjs'
    $results=@()
    foreach ($mode in @('version','register','doctor','abi')) {
        $arg=if ($mode -eq 'doctor') {'pass'} elseif ($mode -eq 'abi') {Join-Path $slot 'release-bindings.json'} else {''}
        $argv=@($probe,$mode,$slot); if ($arg) {$argv+=$arg}
        $r=Run-Node ($generation+'-'+$mode) $argv
        $results+=@{mode=$mode;result=$r}
    }
    $r=Run-Node ($generation+'-sdk-wire') @((Join-Path $proposal 'dependencies/artifact-assembly-v1/sdk-wire-qa.mjs'),$slot,(Join-Path $slot 'release-bindings.json'))
    $results+=@{mode='sdk-wire';result=$r}
    if ($results.Count -ne 5) { throw 'public_probe_count_changed' }
    return ,$results
}
try {
    Write-NewJson (Join-Path $base 'owned-lease.json') @{schema=1;purpose='source_license_only_disposable_package_qa';liveActivation=$false;cleanup='after verified artifact handover and parent release; no deletion on failure';root=$base}
    if ($env:GITHUB_OUTPUT) { [IO.File]::AppendAllText($env:GITHUB_OUTPUT,"evidence=$evidence`nowned_root=$base`n",$utf8) }
    # Child/native fixtures must use our new C:\ temporary lease, not runner D:\ temp.
    $env:TEMP=$base; $env:TMP=$base; $env:npm_config_cache=Join-Path $base 'npm-cache'
    $lifecycleNegatives=Run-Node 'required-root-lifecycle-source-negatives' @((Join-Path $proposal 'test-required-root-lifecycle.mjs'))
    if ($lifecycleNegatives.passed -ne 12 -or $lifecycleNegatives.failed -ne 0 -or -not $lifecycleNegatives.productionGate -or $lifecycleNegatives.npmInstalls -ne 0 -or $lifecycleNegatives.packageLifecycleExecutions -ne 0) { throw 'required_lifecycle_source_gate_not_passed' }
    $readonlyGates=Run-51 'actual-51-readonly-package-primitives' @('-File',(Join-Path $proposal 'Test-Issue344HelperGates.ps1'),'-ProposalRoot',$proposal)
    $created=Run-Node 'create-owned-slot' @((Join-Path $proposal 'dependencies/artifact-assembly-v1/create-slot-inputs.mjs'),(Join-Path $InputsRoot 'slot-inputs.json'),$slotA)
    if (-not $created.newOwnedQaRootCreated -or $created.installStarted) { throw 'new_slot_not_proven' }
    Push-Location -LiteralPath $slotA
    try {
        # Normal npm11.17 lifecycle; null allow-scripts warnings are advisory.
        # Do not change wildcard/dependency permissions, ignore scripts or replay.
        # Installed required-root marker closure is measured before any probes.
        $npmOutput=& $npm install --omit=dev --include=optional --no-audit --no-fund 2>&1
        $npmExit=$LASTEXITCODE
        [IO.File]::WriteAllText((Join-Path $evidence 'normal-npm-install.log'),($npmOutput -join "`n")+"`n",$utf8)
        if ($npmExit -ne 0) { throw 'normal_npm_install_failed' }
    } finally { Pop-Location }
    $lifecycleBefore=Run-Node 'required-root-lifecycle-before-probes' @((Join-Path $proposal 'required-root-lifecycle.mjs'),$slotA)
    if (-not $lifecycleBefore.requiredRootLifecycleCompleted) { throw 'required_root_lifecycle_not_complete' }
    $before=Public-Probes 'before-relocation' $slotA
    $matrix=Run-Node 'production-eight-negatives' @((Join-Path $proposal 'dependencies/artifact-assembly-v1/package-qa-matrix.mjs'),$slotA)
    if ($matrix.negatives -ne 8 -or $matrix.positive -ne 1 -or -not $matrix.originalLeavesRestored -or -not $matrix.freshProcessEachCheck) { throw 'exact_production_negative_matrix_required' }
    # Capture physical identity through the exact private production reader,
    # without creating an activation Context or calling any task action.
    $modulePath=Join-Path $proposal ((Get-Content (Join-Path $proposal 'SOURCE-GATES.json') -Raw | ConvertFrom-Json).windowsOperationsModule)
    $module=Import-Module $modulePath -Force -PassThru
    $identityBefore=& $module {param($p) Initialize-KanonDirectoryIdentityReader; Get-KanonDirectoryIdentity $p} $slotA
    $bindingsBefore=(Get-FileHash -LiteralPath (Join-Path $slotA 'release-bindings.json') -Algorithm SHA256).Hash
    if (Test-Path -LiteralPath (Join-Path $slotA '.package-qa-matrix-pending.json')) { throw 'negative_pending_no_relocation' }
    Write-NewJson (Join-Path $evidence 'relocation-intent.json') @{schema=1;action='one_owned_root_physical_rename';from=$slotA;to=$slotB;identityBefore=$identityBefore;automaticReplayAllowed=$false}
    Move-Item -LiteralPath $slotA -Destination $slotB -ErrorAction Stop
    if ((Test-Path -LiteralPath $slotA) -or -not (Test-Path -LiteralPath $slotB)) { throw 'relocation_outcome_unknown' }
    $identityAfter=& $module {param($p) Get-KanonDirectoryIdentity $p} $slotB
    $gate=Get-Content (Join-Path $proposal 'SOURCE-GATES.json') -Raw | ConvertFrom-Json
    if ($gate.directoryIdentityFormat -ne 'volumeHex8:fileIndexHex16' -or $identityBefore -cnotmatch '^[a-f0-9]{8}:[a-f0-9]{16}$' -or $identityBefore -cne $identityAfter) { throw 'physical_root_identity_changed' }
    if ((Get-FileHash -LiteralPath (Join-Path $slotB 'release-bindings.json') -Algorithm SHA256).Hash -ne $bindingsBefore) { throw 'relocation_binding_changed' }
    Write-NewJson (Join-Path $evidence 'relocation-confirmed.json') @{schema=1;physicalRelocations=1;identityBefore=$identityBefore;identityAfter=$identityAfter;bindingUnchanged=$true}
    $lifecycleAfter=Run-Node 'required-root-lifecycle-after-relocation' @((Join-Path $proposal 'required-root-lifecycle.mjs'),$slotB)
    if (-not $lifecycleAfter.requiredRootLifecycleCompleted -or $lifecycleAfter.requiredRootTarSha256 -cne $lifecycleBefore.requiredRootTarSha256) { throw 'required_root_lifecycle_relocation_mismatch' }
    $after=Public-Probes 'after-relocation' $slotB
    $lifecycleBeforeSeal=Run-Node 'required-root-lifecycle-before-seal' @((Join-Path $proposal 'required-root-lifecycle.mjs'),$slotB)
    if (-not $lifecycleBeforeSeal.requiredRootLifecycleCompleted -or $lifecycleBeforeSeal.requiredRootTarSha256 -cne $lifecycleAfter.requiredRootTarSha256) { throw 'required_root_lifecycle_not_complete_before_seal' }
    $inventory=Join-Path $evidence 'candidate-inventory.json'
    $seal=Run-Node 'emit-compatible-seal' @((Join-Path $proposal 'dependencies/artifact-assembly-v2/seal-package-qa-slot.mjs'),$slotB,$inventory)
    if ($seal.sdkCopies -ne 1 -or $seal.nativeCopies -ne 1 -or $seal.reparseAccepted -or $seal.activationAccepted) { throw 'seal_closure_not_proven' }
    $consumer=Run-51 'actual-51-production-seal-consumer' @('-File',(Join-Path $proposal 'Test-Issue344CandidateSeal.ps1'),'-ProposalRoot',$proposal,'-Slot',$slotB,'-Inventory',$inventory)
    if (-not $consumer.productionSealConsumerVerified -or $consumer.activationAccepted -or $consumer.taskActionsInvoked -ne 0) { throw 'actual_production_seal_consumer_required' }
    Write-NewJson (Join-Path $evidence 'package-qa-result.json') @{schema=1;status='owned_windows_package_qa_passed_not_live_acceptance';node=(& $node --version).Trim();npm=(& $npm --version).Trim();readOnlyPackageFixtureGates=$readonlyGates;helperSemanticSourceGatesExecuted=$false;deploymentReady=$false;normalInstallExit=0;npmLifecyclePolicy='npm11_17_advisory_standard_install_unmodified';requiredRootLifecycleReadbacks=3;requiredRootLifecycleBefore=$lifecycleBefore;requiredRootLifecycleAfter=$lifecycleAfter;requiredRootLifecycleBeforeSeal=$lifecycleBeforeSeal;lifecycleSourceNegatives=$lifecycleNegatives;publicBefore=$before;productionNegativeMatrix=$matrix;physicalRelocations=1;publicAfter=$after;sealEmitter=$seal;actual51SealConsumer=$consumer;liveActivation=$false;realPlatformInput=$false;excelAcceptance=$false;taskActionsInvoked=0}
    if ($env:GITHUB_OUTPUT) { [IO.File]::AppendAllText($env:GITHUB_OUTPUT,"candidate_slot=$slotB`n",$utf8) }
} catch {
    if (-not (Test-Path -LiteralPath (Join-Path $evidence 'package-qa-failed.json'))) { Write-NewJson (Join-Path $evidence 'package-qa-failed.json') @{schema=1;status='failed_or_outcome_unknown';passed=$false;liveActivation=$false;automaticReplayAllowed=$false;ownedRootRetained=$true} }
    throw 'required_owned_package_qa_not_passed'
}
