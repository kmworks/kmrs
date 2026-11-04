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
  param([System.Diagnostics.Process]$Process)
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.UseProxy = $false
  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(1)
  try {
    for ($i = 0; $i -lt 60; $i++) {
      if ($Process.HasExited) { throw "KMServer exited with $($Process.ExitCode)" }
      try {
        $response = $client.GetStringAsync('http://127.0.0.1:25600/actuator/health').GetAwaiter().GetResult()
        if ($response -match '"status"\s*:\s*"UP"') { return }
      } catch {}
      Start-Sleep -Milliseconds 500
    }
    throw 'KMServer health check failed'
  } finally {
    $client.Dispose()
    $handler.Dispose()
  }
}
try {
  $installer = Start-Process "$root\setup.exe" -ArgumentList '/S', "/D=$install" -PassThru -Wait
  if ($installer.ExitCode -ne 0) { throw "initial installer exited with $($installer.ExitCode)" }
  if (-not (Test-Path $exe)) { throw 'initial install failed' }
  Write-Output 'Initial installation completed'
  $old = Start-Process $exe -ArgumentList '--config-dir', "`"$config`"" -PassThru
  Wait-Health -Process $old
  if ($old.HasExited) { throw "initial server exited with $($old.ExitCode)" }
  Write-Output 'Initial server is healthy'
  $update = Start-Process "$root\setup.exe" -ArgumentList '/S', "/UPDATEPID=$($old.Id)", "/CONFIGDIR=`"$config`"", "/INSTALLDIR=`"$install`"" -PassThru -Wait
  if ($update.ExitCode -ne 0) { throw "update installer exited with $($update.ExitCode)" }
  for ($i = 0; $i -lt 60; $i++) {
    $new = Get-CimInstance Win32_Process -Filter "Name = 'kmrs.exe'" |
      Where-Object { $_.ExecutablePath -eq $exe -and $_.ProcessId -ne $old.Id }
    if ($new) { break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $new) { throw 'updated server did not restart' }
  if ($new.CommandLine -notlike "*--config-dir*") { throw 'custom config-dir was lost' }
  Wait-Health -Process $new
  Write-Output 'Windows install, custom-path update, config preservation, and restart passed'
  Stop-TestServer
  $failed = Start-Process $exe -ArgumentList '--config-dir', "`"$config`"" -PassThru
  Wait-Health -Process $failed
  Move-Item "$install\pdfium.dll" "$root\previous-pdfium.dll"
  New-Item -ItemType Directory "$install\pdfium.dll" | Out-Null
  $recovery = Start-Process "$root\setup.exe" -ArgumentList '/S', "/UPDATEPID=$($failed.Id)", "/CONFIGDIR=`"$config`"", "/INSTALLDIR=`"$install`"" -PassThru -Wait
  if ($recovery.ExitCode -ne 0) { throw "recovery installer exited with $($recovery.ExitCode)" }
  if (Test-Path "$install\pdfium.dll" -PathType Container) { throw 'installer did not reach the injected file-write failure' }
  Wait-Health -Process $failed
  $restored = Get-CimInstance Win32_Process -Filter "Name = 'kmrs.exe'" |
    Where-Object { $_.ExecutablePath -eq $exe -and $_.ProcessId -ne $failed.Id }
  if (-not $restored) { throw 'previous server did not restart after a failed update' }
  if ($restored.CommandLine -notlike "*--config-dir*") { throw 'config-dir was lost during rollback' }
  Wait-Health -Process $restored
  if (-not (Test-Path "$install\pdfium.dll" -PathType Leaf)) { throw 'previous PDFium was not restored' }
  Write-Output 'Windows failed update restored the previous server and configuration'
} catch {
  Get-ChildItem "$config\logs" -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Output "--- $($_.FullName)"; Get-Content $_.FullName -Tail 80 }
  throw
} finally {
  Stop-TestServer
  Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
}
