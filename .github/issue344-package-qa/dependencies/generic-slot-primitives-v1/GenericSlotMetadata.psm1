#requires -Version 5.1
# DECLARED SOURCE SUBSET: read-only metadata/seal primitives, NOT deployed helper.
# No task/process/action/context/phase or Dell identity constants are present.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Get-KanonTextHash {
    param([string]$Text)
    $sha=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))).Replace('-','').ToLowerInvariant()) } finally { $sha.Dispose() }
}

function Get-KanonFileHash {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
}

function Assert-KanonOrdinaryPath {
    param([string]$Path,[bool]$MayBeAbsent=$false)
    $full=[IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith('C:\',[StringComparison]::OrdinalIgnoreCase)) { throw 'kanon_slot_nonlocal_path' }
    $chain=New-Object 'System.Collections.Generic.List[string]'
    $cursor=$full
    while ($cursor -and $cursor.Length -gt 3) { $chain.Add($cursor); $cursor=[IO.Path]::GetDirectoryName($cursor) }
    $chain.Add('C:\'); $chain.Reverse()
    foreach ($item in $chain) {
        if (Test-Path -LiteralPath $item) {
            $leaf=Get-Item -LiteralPath $item -Force -ErrorAction Stop
            if (($leaf.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'kanon_slot_reparse_refused' }
        } elseif ($item -ne $full -or -not $MayBeAbsent) { throw 'kanon_slot_parent_absent' }
    }
    return $full
}

function Get-KanonAclHash {
    param([string]$Path)
    $acl=Get-Acl -LiteralPath $Path -ErrorAction Stop
    $parts=[Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Group -bor [Security.AccessControl.AccessControlSections]::Access
    return Get-KanonTextHash $acl.GetSecurityDescriptorSddlForm($parts)
}

function Initialize-KanonDirectoryIdentityReader {
    # Distinct type prevents a previously loaded frozen v1 reader from being used.
    if ('ForoneKanonSlotNativeHandlesV2' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class ForoneKanonSlotNativeHandlesV2 {
 [StructLayout(LayoutKind.Sequential)] struct Info {
  public uint attributes,creationLow,creationHigh,accessLow,accessHigh,writeLow,writeHigh;
  public uint volume,sizeHigh,sizeLow,links,indexHigh,indexLow;
 }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern SafeFileHandle CreateFileW(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out Info info);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,StringBuilder path,uint size,uint flags);
 static Info Verify(SafeFileHandle handle,string expected,bool directory) {
  if(handle.IsInvalid) throw new InvalidOperationException("slot_handle_unavailable");
  Info first; if(!GetFileInformationByHandle(handle,out first)) throw new InvalidOperationException("slot_handle_unavailable");
  CheckType(first,directory);
  var buffer=new StringBuilder(32768);
  uint length=GetFinalPathNameByHandleW(handle,buffer,(uint)buffer.Capacity,0);
  if(length==0 || length>=buffer.Capacity) throw new InvalidOperationException("slot_handle_path_unavailable");
  string actual=buffer.ToString();
  // Only local DOS C:\ paths; reject UNC, device namespaces and any redirection.
  if(actual.StartsWith(@"\\?\",StringComparison.Ordinal)) actual=actual.Substring(4);
  expected=Path.GetFullPath(expected);
  if(!actual.StartsWith(@"C:\",StringComparison.OrdinalIgnoreCase) ||
     !expected.StartsWith(@"C:\",StringComparison.OrdinalIgnoreCase) ||
     !String.Equals(actual,expected,StringComparison.OrdinalIgnoreCase))
   throw new InvalidOperationException("slot_handle_path_mismatch");
  Info second; if(!GetFileInformationByHandle(handle,out second)) throw new InvalidOperationException("slot_handle_unavailable");
  CheckType(second,directory);
  if(first.volume!=second.volume || first.indexHigh!=second.indexHigh || first.indexLow!=second.indexLow)
   throw new InvalidOperationException("slot_handle_identity_changed");
  return second;
 }
 static void CheckType(Info info,bool directory) {
  if((info.attributes & 0x400)!=0) throw new InvalidOperationException("slot_handle_reparse_refused");
  if(((info.attributes & 0x10)!=0)!=directory) throw new InvalidOperationException("slot_handle_type_refused");
  if(!directory && (info.sizeHigh!=0 || info.sizeLow!=0)) throw new InvalidOperationException("slot_lock_nonempty_refused");
 }
 public static string Read(string path) {
  // Metadata only. BACKUP_SEMANTICS | OPEN_REPARSE_POINT; no privilege enablement.
  using(var handle=CreateFileW(path,0x80,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero)) {
   Info info=Verify(handle,path,true);
   return info.volume.ToString("x8")+":"+info.indexHigh.ToString("x8")+info.indexLow.ToString("x8");
  }
 }
 public static FileStream OpenExclusiveLock(string path) {
  // No-follow OPEN_ALWAYS, no sharing, no inheritance; never read/write contents.
  var handle=CreateFileW(path,0xc0000000,0,IntPtr.Zero,4,0x00200080,IntPtr.Zero);
  try {
   Verify(handle,path,false);
   // Transfer this SAME exclusive verified handle to the stream, not a path reopen.
   return new FileStream(handle,FileAccess.ReadWrite);
  } catch { handle.Dispose(); throw; }
 }
}
'@ -ErrorAction Stop | Out-Null
}

function Get-KanonDirectoryIdentity {
    param([string]$Path)
    [void](Assert-KanonOrdinaryPath $Path $true)
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $leaf=Get-Item -LiteralPath $Path -Force
    if (-not $leaf.PSIsContainer) { throw 'kanon_slot_directory_expected' }
    return [ForoneKanonSlotNativeHandlesV2]::Read($Path)
}

function Test-KanonCandidateSeal {
    param([hashtable]$Context,[string]$Root)
    $s=$Context.Spec
    if ((Get-KanonFileHash $s.inventoryPath) -ne $s.inventorySha256) { throw 'kanon_slot_inventory_changed' }
    if ((Get-Item -LiteralPath $s.inventoryPath).Length -gt 33554432) { throw 'kanon_slot_inventory_too_large' }
    $inventory=Get-Content -LiteralPath $s.inventoryPath -Raw | ConvertFrom-Json
    if ($inventory.schema -ne 1 -or $inventory.files.Count -lt 1 -or $inventory.files.Count -gt 200000) { throw 'kanon_slot_inventory_invalid' }
    $expected=New-Object 'System.Collections.Generic.Dictionary[string,object]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $inventory.files) {
        if ($entry.path -notmatch '^[A-Za-z0-9_@.+ -]+(/[A-Za-z0-9_@.+ -]+)*$' -or
            $entry.path.Split('/') -contains '..' -or $entry.path.Split('/') -contains '.' -or
            $entry.sha256 -notmatch '^[a-f0-9]{64}$' -or $entry.bytes -lt 0) { throw 'kanon_slot_inventory_invalid' }
        if ($expected.ContainsKey($entry.path)) { throw 'kanon_slot_inventory_duplicate' }
        $expected.Add($entry.path,$entry)
    }
    [void](Assert-KanonOrdinaryPath $Root)
    $pending=New-Object 'System.Collections.Generic.Stack[string]'; $pending.Push($Root)
    $seen=0; $directoryCount=0
    while ($pending.Count -gt 0) {
        $directory=$pending.Pop(); $directoryCount++
        if ($directoryCount -gt 200000) { throw 'kanon_slot_candidate_directory_limit' }
        # No recursive old-slot traversal. This queue walks ONLY our own candidate,
        # rejecting reparse children before descending (including junctions).
        foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'kanon_slot_candidate_reparse' }
            if ($item.PSIsContainer) { $pending.Push($item.FullName); continue }
            $relative=$item.FullName.Substring($Root.Length+1).Replace('\','/')
            if (-not $expected.ContainsKey($relative)) { throw 'kanon_slot_candidate_extra_file' }
            $entry=$expected[$relative]
            if ($item.Length -ne $entry.bytes -or (Get-KanonFileHash $item.FullName) -ne $entry.sha256) { throw 'kanon_slot_candidate_digest_mismatch' }
            $seen++
        }
    }
    if ($seen -ne $expected.Count) { throw 'kanon_slot_candidate_missing_file' }
    if ((Get-KanonAclHash $Root) -ne $s.candidateAclSha256) { throw 'kanon_slot_candidate_acl_changed' }
    $package=Get-Content -LiteralPath (Join-Path $Root 'node_modules\openclaw\package.json') -Raw | ConvertFrom-Json
    if ($package.name -ne 'openclaw' -or $package.version -ne '2026.9.6') { throw 'kanon_slot_candidate_package_mismatch' }
    return $true
}

Export-ModuleMember -Function Get-KanonFileHash,Test-KanonCandidateSeal
