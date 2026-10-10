# Source-only QA. Execute only on the parent's owned Windows Actions seat.
param([Parameter(Mandatory=$true)][string]$ProposalRoot)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or $env:OS -ne 'Windows_NT') { throw 'actual_windows_powershell_51_required' }
$gate=Get-Content -LiteralPath (Join-Path $ProposalRoot 'SOURCE-GATES.json') -Raw | ConvertFrom-Json
if ($gate.schema -ne 1 -or $gate.status -ne 'frozen_reviewed_source_gates' -or $gate.liveActivation -ne $false -or $gate.scope -ne 'package_only_readonly_metadata_native_fixture_no_helper_semantics') { throw 'helper_source_gates_not_frozen' }
$parsed=0
foreach ($relative in $gate.parserFiles) {
    $file=Join-Path $ProposalRoot $relative
    $tokens=$null; $errors=$null
    [Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors) | Out-Null
    if ($errors.Count -ne 0) { throw 'powershell_51_parser_failed' }
    $parsed++
}
if ($parsed -ne $gate.expectedParserFiles) { throw 'parser_count_changed' }
$groups=@()
foreach ($test in $gate.tests) {
    $file=Join-Path $ProposalRoot $test.path
    $arguments=@('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$file)
    if ($test.nativeFileSymlinkRequired) { $arguments+= '-EnableFileSymlinkCase' }
    # A new process is deliberate: tests compile one exact private C# reader.
    # No provider runtime or action adapter is started by these fixture files.
    $lines=& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" @arguments
    if ($LASTEXITCODE -ne 0) { throw 'required_helper_fixture_failed' }
    $result=($lines -join "`n") | ConvertFrom-Json
    if ($result.passed -ne $test.expectedPassed -or $result.failed -ne 0 -or $result.runtime -notmatch '^5\.1\.') { throw 'helper_fixture_count_or_runtime_changed' }
    foreach ($property in $test.expectedFlags.PSObject.Properties) {
        if ($result.($property.Name) -cne $property.Value) { throw 'helper_fixture_scope_changed' }
    }
    $groups+=@{label=$test.label;path=$test.path;actualResult=$result}
}
if ($groups.Count -ne $gate.tests.Count -or @($groups | ForEach-Object {$_.label} | Select-Object -Unique).Count -ne $groups.Count) { throw 'required_group_missing_or_duplicate' }
@{schema=1;runtime=$PSVersionTable.PSVersion.ToString();parserFilesPassed=$parsed;groups=$groups;helperSemanticSourceGatesExecuted=$false;deploymentReady=$false;liveActivation=$false;taskActionsInvoked=0} | ConvertTo-Json -Depth 20 -Compress
