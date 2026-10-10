# Invoke only exact production read-only seal and private metadata inspection.
param([Parameter(Mandatory=$true)][string]$ProposalRoot,[Parameter(Mandatory=$true)][string]$Slot,[Parameter(Mandatory=$true)][string]$Inventory)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or $env:OS -ne 'Windows_NT') { throw 'actual_windows_powershell_51_required' }
$gate=Get-Content -LiteralPath (Join-Path $ProposalRoot 'SOURCE-GATES.json') -Raw | ConvertFrom-Json
if ($gate.status -ne 'frozen_reviewed_source_gates') { throw 'helper_source_not_frozen' }
$module=Import-Module (Join-Path $ProposalRoot $gate.windowsOperationsModule) -Force -PassThru
$identity=& $module {param($p) Initialize-KanonDirectoryIdentityReader; Get-KanonDirectoryIdentity $p} $Slot
$acl=& $module {param($p) Get-KanonAclHash $p} $Slot
$inventoryHash=(Get-FileHash -LiteralPath $Inventory -Algorithm SHA256).Hash.ToLowerInvariant()
$context=@{Spec=@{inventoryPath=$Inventory;inventorySha256=$inventoryHash;candidateAclSha256=$acl}}
$verified=Test-KanonCandidateSeal $context $Slot
if ($verified -ne $true) { throw 'actual_production_seal_not_verified' }
@{schema=1;runtime=$PSVersionTable.PSVersion.ToString();productionSealConsumerVerified=$true;inventorySha256=$inventoryHash;directoryIdentity=$identity;aclSha256=$acl;activationAccepted=$false;taskActionsInvoked=0} | ConvertTo-Json -Depth 10 -Compress
