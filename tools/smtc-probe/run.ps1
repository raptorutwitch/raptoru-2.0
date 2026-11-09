# Raptoru 2.0 - SMTC probe (docs/music/SMTC_PROBE.md): builds SmtcProbe.cs with Windows' own C# compiler (no SDK, no
# package) into .lab-data/smtc-probe, then runs it. Read-only: Windows' local media metadata, never Spotify's API.
#   powershell -ExecutionPolicy Bypass -File tools\smtc-probe\run.ps1            (build if needed, then listen)
#   powershell -ExecutionPolicy Bypass -File tools\smtc-probe\run.ps1 -BuildOnly
#   ... -BuildOnly -Out <folder>   (Studio builds its own copy: an open test window keeps its exe locked)
param([switch]$BuildOnly, [string]$Out)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$out = if ($Out) { $Out } else { Join-Path $here '..\..\.lab-data\smtc-probe' }
New-Item -ItemType Directory -Force $out | Out-Null
$out = (Resolve-Path $out).Path
$exe = Join-Path $out 'SmtcProbe.exe'
$src = Join-Path $here 'SmtcProbe.cs'
$fw = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
$meta = "$env:WINDIR\System32\WinMetadata"
# The framework's facades for the WinRT metadata (present on every Windows 10 / 11).
$gac = "$env:WINDIR\Microsoft.NET\assembly\GAC_MSIL"
$facades = 'System.Runtime', 'System.Runtime.InteropServices.WindowsRuntime', 'System.Threading.Tasks' | ForEach-Object {
  Get-ChildItem "$gac\$_" -Recurse -Filter "$_.dll" | Select-Object -First 1 -ExpandProperty FullName
}
if (-not (Test-Path $exe) -or (Get-Item $src).LastWriteTime -gt (Get-Item $exe).LastWriteTime) {
  $refs = @(
    "$fw\System.Runtime.WindowsRuntime.dll",
    $facades[0], $facades[1], $facades[2],
    "$meta\Windows.Foundation.winmd",
    "$meta\Windows.Media.winmd",
    "$meta\Windows.Storage.winmd"
  ) | ForEach-Object { "/reference:$_" }
  & "$fw\csc.exe" /nologo /target:exe /optimize+ /platform:anycpu "/out:$exe" @refs $src
  if ($LASTEXITCODE -ne 0) { Write-Output 'Compilation impossible (voir ci-dessus).'; exit 1 }
}
if ($BuildOnly) { Write-Output "Construit : $exe"; exit 0 }
$logFile = Join-Path $out ('smtc-{0}.jsonl' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Write-Output "Journal : $logFile"
& $exe $logFile
