#requires -Version 5.1
[CmdletBinding()]
param([switch]$EnableFileSymlinkCase)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ($env:OS -ne 'Windows_NT') { throw 'owned_native_test_windows_only' }
$module=Import-Module (Join-Path $PSScriptRoot 'GenericSlotMetadata.psm1') -Force -PassThru
& $module { Initialize-KanonDirectoryIdentityReader }
$root=Join-Path ([IO.Path]::GetTempPath()) ('kanon-slot-v2-owned-'+[Guid]::NewGuid().ToString('N'))
if (-not $root.StartsWith('C:',[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $root)) { throw 'owned_native_fixture_scope_refused' }
[void][IO.Directory]::CreateDirectory($root)
$directory=Join-Path $root 'ordinary'; $junction=Join-Path $root 'junction'
$lock=Join-Path $root 'receipt.lock'; $nonempty=Join-Path $root 'nonempty.lock'; $link=Join-Path $root 'linked.lock'
$passed=0; $names=New-Object 'System.Collections.Generic.List[string]'
function Assert-Refused([scriptblock]$Operation) {
    $refused=$false; try { $value=& $Operation; if ($value -is [IDisposable]) { $value.Dispose() } } catch { $refused=$true }
    if (-not $refused) { throw 'owned_native_refusal_missing' }
}
$stream=$null
try {
    [void][IO.Directory]::CreateDirectory($directory)
    $id=[ForoneKanonSlotNativeHandlesV2]::Read($directory)
    if ($id -notmatch '^[a-f0-9]{8}:[a-f0-9]{16}$' -or [ForoneKanonSlotNativeHandlesV2]::Read($directory) -ne $id) { throw 'owned_native_identity_failed' }
    $passed++; $names.Add('owned_ordinary_directory_id_stable')
    $stream=[ForoneKanonSlotNativeHandlesV2]::OpenExclusiveLock($lock)
    if ($stream.Length -ne 0 -or -not $stream.CanRead -or -not $stream.CanWrite) { throw 'owned_native_lock_failed' }
    $passed++; $names.Add('owned_empty_regular_lock_same_handle')
    Assert-Refused { [ForoneKanonSlotNativeHandlesV2]::OpenExclusiveLock($lock) }
    $passed++; $names.Add('owned_lock_contention_refused')
    $stream.Dispose(); $stream=$null
    [IO.File]::WriteAllBytes($nonempty,[byte[]]@(1,2,3))
    Assert-Refused { [ForoneKanonSlotNativeHandlesV2]::OpenExclusiveLock($nonempty) }
    if (([IO.File]::ReadAllBytes($nonempty)).Length -ne 3) { throw 'owned_native_lock_truncated' }
    $passed++; $names.Add('owned_nonempty_lock_refused_without_truncation')
    Assert-Refused { [ForoneKanonSlotNativeHandlesV2]::OpenExclusiveLock($directory) }
    $passed++; $names.Add('owned_directory_as_lock_refused')
    New-Item -ItemType Junction -Path $junction -Target $directory -ErrorAction Stop | Out-Null
    Assert-Refused { [ForoneKanonSlotNativeHandlesV2]::Read($junction) }
    $passed++; $names.Add('owned_junction_metadata_refused')
    if ($EnableFileSymlinkCase) {
        New-Item -ItemType SymbolicLink -Path $link -Target $lock -ErrorAction Stop | Out-Null
        Assert-Refused { [ForoneKanonSlotNativeHandlesV2]::OpenExclusiveLock($link) }
        if (([IO.File]::ReadAllBytes($lock)).Length -ne 0) { throw 'owned_native_link_target_changed' }
        $passed++; $names.Add('owned_file_symlink_lock_refused')
    }
    @{schema=1;passed=$passed;failed=0;runtime=$PSVersionTable.PSVersion.ToString();tests=$names.ToArray();ownedNativeHandlesOnly=$true;fileSymlinkCaseExecuted=[bool]$EnableFileSymlinkCase;runtimeOrTaskMutations=0} | ConvertTo-Json -Depth 4
} finally {
    if ($null -ne $stream) { $stream.Dispose() }
    # Exact own leaves only. No recursive/wildcard cleanup or target traversal.
    foreach ($path in @($link,$lock,$nonempty)) { if ([IO.File]::Exists($path)) { [IO.File]::Delete($path) } }
    if ([IO.Directory]::Exists($junction)) { [IO.Directory]::Delete($junction) }
    if ([IO.Directory]::Exists($directory)) { [IO.Directory]::Delete($directory) }
    [IO.Directory]::Delete($root)
}
