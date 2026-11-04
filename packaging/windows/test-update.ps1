$ErrorActionPreference = 'Stop'
$root = Join-Path $env:TEMP ('kmserver-installer-test-' + $PID)
$install = Join-Path $root 'custom install'
$config = Join-Path $root 'custom config'
$exe = Join-Path $install 'kmrs.exe'
$source = Join-Path $root 'source'
New-Item -ItemType Directory -Force -Path $install, $config, $source | Out-Null
Copy-Item target\debug\kmrs.exe $source
Copy-Item packaging\windows\kmrs.ico $source
Copy-Item packaging\windows\pdfium.dll $source
Copy-Item -Recurse packaging\windows\PDFium $source
& 'C:\Program Files (x86)\NSIS\makensis.exe' /DVERSION=1.0.0 "/DOUTFILE=$root\setup.exe" packaging\windows\installer.nsi
if ($LASTEXITCODE -ne 0) { throw 'makensis failed' }

function Stop-TestServer {
  Get-CimInstance Win32_Process -Filter "Name = 'kmrs.exe'" |
    Where-Object ExecutablePath -EQ $exe |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
function Wait-Health {
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:25600/actuator/health' -TimeoutSec 1
      if ($response.Content -match '"status"\s*:\s*"UP"') { return }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  throw 'KMServer health check failed'
}
try {
  & "$root\setup.exe" /S "/D=$install"
  if (-not (Test-Path $exe)) { throw 'initial install failed' }
  $old = Start-Process $exe -ArgumentList '--config-dir', $config -PassThru
  Wait-Health
  & "$root\setup.exe" /S "/UPDATEPID=$($old.Id)" "/RELAUNCH=$exe" "/CONFIGDIR=$config" "/INSTALLDIR=$install"
  for ($i = 0; $i -lt 60; $i++) {
    $new = Get-CimInstance Win32_Process -Filter "Name = 'kmrs.exe'" |
      Where-Object { $_.ExecutablePath -eq $exe -and $_.ProcessId -ne $old.Id }
    if ($new) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $new) { throw 'updated server did not restart' }
  if ($new.CommandLine -notlike "*--config-dir*") { throw 'custom config-dir was lost' }
  Wait-Health
  Write-Output 'Windows install, custom-path update, config preservation, and restart passed'
  Stop-TestServer
  $failed = Start-Process $exe -ArgumentList '--config-dir', $config -PassThru
  Wait-Health
  Remove-Item "$source\pdfium.dll"
  New-Item -ItemType Directory "$source\pdfium.dll" | Out-Null
  & "$root\setup.exe" /S "/UPDATEPID=$($failed.Id)" "/RELAUNCH=$exe" "/CONFIGDIR=$config" "/INSTALLDIR=$install"
  Wait-Health
  $restored = Get-CimInstance Win32_Process -Filter "Name = 'kmrs.exe'" |
    Where-Object { $_.ExecutablePath -eq $exe -and $_.ProcessId -ne $failed.Id }
  if (-not $restored) { throw 'previous server did not restart after a failed update' }
  if ($restored.CommandLine -notlike "*--config-dir*") { throw 'config-dir was lost during rollback' }
  if (-not (Test-Path "$install\pdfium.dll" -PathType Leaf)) { throw 'previous PDFium was not restored' }
  Write-Output 'Windows failed update restored the previous server and configuration'
} finally {
  Stop-TestServer
  Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
}
