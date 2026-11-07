$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Research-Service.ps1') -LibraryOnly
function Assert-Service([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message } }
Assert-Service (Test-IdeaClipNodeVersion 'v24.22.0') 'Node24 rejected'
Assert-Service (Test-IdeaClipNodeVersion 'v26.0.0') 'Future Node rejected'
Assert-Service (-not (Test-IdeaClipNodeVersion 'v22.12.0')) 'Old Node accepted'
Assert-Service (-not (Test-IdeaClipNodeVersion 'invalid')) 'Invalid Node accepted'
$diagnostic = Get-IdeaClipNetworkDiagnostic 'environment'
Assert-Service ($diagnostic.free -eq $true -and $diagnostic.searchAuthentication -eq 'untested' -and $diagnostic.searchQuota -eq 'unverified') 'Environment diagnostic not free'
Assert-Service ($diagnostic.environment.transport -eq 'direct-pinned-https') 'Diagnostic transport changed'
Assert-Service (-not (($diagnostic | ConvertTo-Json -Depth 8) -match 'Bearer|synthetic-windows-proxy-token')) 'Sensitive diagnostic fields'
$config = @{ token = 'synthetic-windows-proxy-token'; origins = @('chrome-extension://' + ('a' * 32)); hosts = @('github.com'); braveKey = '' }
$invalid = $config.Clone(); $invalid.token = ''; $rejected = $false
try { Test-IdeaClipConfig $invalid } catch { $rejected = $true }
Assert-Service $rejected 'Incomplete configuration accepted'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
try { $listener.Start(); Assert-Service (-not (Test-IdeaClipPort $listener.LocalEndpoint.Port)) 'Busy port accepted' } finally { $listener.Stop() }
if (-not (Test-IdeaClipPort)) { throw '8788 is already occupied; test did not stop the existing process.' }
$child = $null
try {
    $child = Start-IdeaClipService $config
    Assert-Service (-not (Test-IdeaClipPort)) 'Service did not bind 8788'
    $health = Get-IdeaClipHealth $config
    Assert-Service ($health.noUpstreamRequests -eq $true -and $health.search.configured -eq $false -and $health.usage.searchRequests -eq 0) 'Health check accessed search'
    $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $child.Id)
    Assert-Service (-not $process.CommandLine.Contains($config.token)) 'Credential in process arguments'
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8788)
    Assert-Service (@($listeners | Where-Object { $_.LocalAddress -ne '127.0.0.1' }).Count -eq 0) 'Service exposed beyond loopback'
    $occupied = $false
    try { [void](Start-IdeaClipService $config) } catch { $occupied = $true }
    Assert-Service $occupied 'Second service accepted busy port'
    Assert-Service (-not $child.HasExited) 'Existing process was stopped'
} finally { Stop-IdeaClipService $child }
Assert-Service (Test-IdeaClipPort) 'Port remained bound after safe stop'
Write-Output 'WINDOWS_SERVICE_VALIDATION_OK: version/config/port/start/health/loopback/no-secret-argv/safe-stop'
