param(
  [string]$Executable = (Join-Path $PSScriptRoot "..\lan-file-share.exe"),
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..")
)

$ErrorActionPreference = "Stop"

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SeaResource {
  [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr LoadLibrary(string path);
  [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr FindResource(IntPtr module, string name, IntPtr type);
  [DllImport("kernel32", SetLastError=true)] public static extern uint SizeofResource(IntPtr module, IntPtr resource);
  [DllImport("kernel32", SetLastError=true)] public static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
  [DllImport("kernel32", SetLastError=true)] public static extern IntPtr LockResource(IntPtr handle);
}
'@

function Read-UInt64LE([byte[]]$bytes, [ref]$offset) {
  $value = [BitConverter]::ToUInt64($bytes, $offset.Value)
  $offset.Value += 8
  return $value
}

function Read-Bytes([byte[]]$bytes, [ref]$offset) {
  $length = Read-UInt64LE $bytes $offset
  if ($length -gt [int]::MaxValue -or $offset.Value + $length -gt $bytes.Length) { throw "Invalid SEA resource length." }
  $result = New-Object byte[] ([int]$length)
  [Array]::Copy($bytes, $offset.Value, $result, 0, [int]$length)
  $offset.Value += [int]$length
  return $result
}

$module = [SeaResource]::LoadLibrary((Resolve-Path $Executable))
$resource = [SeaResource]::FindResource($module, "NODE_SEA_BLOB", [IntPtr]10) # RT_RCDATA
if ($resource -eq [IntPtr]::Zero) { throw "NODE_SEA_BLOB resource was not found." }
$size = [SeaResource]::SizeofResource($module, $resource)
$pointer = [SeaResource]::LockResource([SeaResource]::LoadResource($module, $resource))
$blob = New-Object byte[] $size
[Runtime.InteropServices.Marshal]::Copy($pointer, $blob, 0, $size)

$offset = 0
$magic = [BitConverter]::ToUInt32($blob, $offset); $offset += 4
if ($magic -ne 0x0143DA20) { throw "Invalid SEA resource magic." }
$flags = [BitConverter]::ToUInt32($blob, $offset); $offset += 4
$execArgvExtension = $blob[$offset]; $offset += 1
$codePath = [Text.Encoding]::UTF8.GetString((Read-Bytes $blob ([ref]$offset)));
$mainCode = Read-Bytes $blob ([ref]$offset)
if (($flags -band 2) -ne 0) { throw "This SEA uses a V8 snapshot and does not contain recoverable source code." }

$mainOutput = Join-Path $OutputDirectory $codePath
[IO.Directory]::CreateDirectory((Split-Path $mainOutput -Parent)) | Out-Null
[IO.File]::WriteAllBytes($mainOutput, $mainCode)

if (($flags -band 8) -ne 0) {
  $assetCount = Read-UInt64LE $blob ([ref]$offset)
  for ($i = 0; $i -lt $assetCount; $i++) {
    $relativePath = [Text.Encoding]::UTF8.GetString((Read-Bytes $blob ([ref]$offset)))
    if ([IO.Path]::IsPathRooted($relativePath) -or $relativePath.Split([IO.Path]::DirectorySeparatorChar) -contains "..") { throw "Unsafe asset path: $relativePath" }
    $assetOutput = Join-Path $OutputDirectory $relativePath
    [IO.Directory]::CreateDirectory((Split-Path $assetOutput -Parent)) | Out-Null
    [IO.File]::WriteAllBytes($assetOutput, (Read-Bytes $blob ([ref]$offset)))
  }
}

Write-Host "Extracted $codePath and embedded assets (flags: 0x$($flags.ToString('X')))."
