param([switch]$LibraryOnly, [switch]$SmokeUI)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# No configuration files, transcripts or credentials in command-line arguments.
function Test-IdeaClipNodeVersion([string]$Version) {
    return $Version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24
}
function Test-IdeaClipPort([int]$Port = 8788) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try { $listener.Start(); return $true } catch { return $false } finally { $listener.Stop() }
}
function Get-IdeaClipNode {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $cmd) { throw '未找到 Node.js。请安装 Node.js 24 或更新版本后重新打开。' }
    $version = & $cmd.Source --version 2>$null
    if (-not (Test-IdeaClipNodeVersion $version)) { throw 'Node.js 版本不足：研究服务需要 24 或更新版本。' }
    return $cmd.Source
}
function Test-IdeaClipConfig($Config) {
    if ($Config.token -notmatch '^[\x21-\x7e]{16,1000}$') { throw '代理访问密钥须为16至1000个可见ASCII字符。' }
    if ($Config.origins.Count -lt 1 -or $Config.origins.Count -gt 10) { throw '请填写扩展 ID。' }
    foreach ($o in $Config.origins) { if ($o -notmatch '^chrome-extension://[a-p]{32}$') { throw '扩展 ID 应为32个 a-p 字母；请从扩展详情复制。' } }
    if ($Config.hosts.Count -lt 1 -or $Config.hosts.Count -gt 20) { throw '请填写1至20个精确公开域名。' }
    foreach ($h in $Config.hosts) { if ($h -notmatch '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' -or -not $h.Contains('.') -or $h -match '(^|\.)(localhost|local|internal|arpa|onion|test|invalid)$' -or $h -match '^\d+(\.\d+){3}$') { throw '来源域名无效；不要填写URL、IP、通配符或内网域名。' } }
    if ($Config.braveKey -and $Config.braveKey -notmatch '^[\x21-\x7e]{8,1000}$') { throw 'Brave Key 格式无效。可以留空，仅使用公开网页与GitHub。' }
}
function Get-IdeaClipHealth($Config) {
    Add-Type -AssemblyName System.Net.Http
    $handler = [System.Net.Http.HttpClientHandler]::new(); $handler.AllowAutoRedirect = $false; $handler.UseProxy = $false
    $client = [System.Net.Http.HttpClient]::new($handler); $client.Timeout = [TimeSpan]::FromSeconds(3)
    try {
        $client.DefaultRequestHeaders.Add('Origin', $Config.origins[0])
        $client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $Config.token)
        $content = [System.Net.Http.StringContent]::new('{"version":1,"operation":{"kind":"health"}}', [System.Text.Encoding]::UTF8, 'application/json')
        try { $response = $client.PostAsync('http://127.0.0.1:8788/research', $content).GetAwaiter().GetResult() } finally { $content.Dispose() }
        try {
            if (-not $response.IsSuccessStatusCode) { throw 'health' }
            $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if ($raw.Length -gt 16384 -or $raw.Contains($Config.token)) { throw 'health' }
            $result = $raw | ConvertFrom-Json
            if ($result.service -ne 'IdeaClipResearchProxy' -or $result.version -ne 1 -or $result.noUpstreamRequests -ne $true -or $result.search.verified -ne $false) { throw 'health' }
            return $result
        } finally { $response.Dispose() }
    } catch { throw '本地健康检查失败。未调用搜索或AI；请核对服务、端口和配置。' } finally { $client.Dispose() }
}
function Stop-IdeaClipService($Child) {
    if ($null -eq $Child) { return }
    try {
        if (-not $Child.HasExited) {
            $Child.StandardInput.WriteLine('stop'); $Child.StandardInput.Flush()
            if (-not $Child.WaitForExit(5000)) { $Child.Kill(); $Child.WaitForExit() }
        }
    } finally { $Child.Dispose() }
}
function Start-IdeaClipService($Config) {
    Test-IdeaClipConfig $Config
    $node = Get-IdeaClipNode
    if (-not (Test-IdeaClipPort)) { throw '8788端口已占用。请关闭已有研究服务或检查占用程序；不会终止其他进程。' }
    $entry = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tools/research-service.ts'))
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw '缺少研究服务源码，请保留完整IdeaClip项目目录。' }
    $info = [Diagnostics.ProcessStartInfo]::new(); $info.FileName = $node; $info.Arguments = '"' + $entry + '"'
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true; $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    foreach ($name in @('BRAVE_SEARCH_API_KEY', 'IDEACLIP_RESEARCH_PROXY_TOKEN')) { $info.EnvironmentVariables.Remove($name) }
    $child = [Diagnostics.Process]::new(); $child.StartInfo = $info
    try {
        [void]$child.Start()
        # Drain stderr without displaying or persisting arbitrary process output.
        $child.BeginErrorReadLine()
        $child.StandardInput.WriteLine(($Config | ConvertTo-Json -Compress -Depth 4)); $child.StandardInput.Flush()
        $ready = $child.StandardOutput.ReadLineAsync()
        if (-not $ready.Wait(7000)) { throw '启动超时，请重试。' }
        if (-not $ready.Result -or (($ready.Result | ConvertFrom-Json).event -ne 'ready')) { throw '服务启动失败，请核对配置和8788端口。' }
        [void](Get-IdeaClipHealth $Config)
        return $child
    } catch { Stop-IdeaClipService $child; throw '研究服务启动失败。请核对配置、Node版本与端口；没有保存或输出密钥。' }
}
if ($LibraryOnly) { return }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form = [Windows.Forms.Form]::new(); $form.Text = 'IdeaClip 本地研究服务'; $form.Width = 660; $form.Height = 660; $form.StartPosition = 'CenterScreen'
$layout = [Windows.Forms.FlowLayoutPanel]::new(); $layout.Dock = 'Fill'; $layout.FlowDirection = 'TopDown'; $layout.WrapContents = $false; $layout.AutoScroll = $true; $layout.Padding = [Windows.Forms.Padding]::new(16); $form.Controls.Add($layout)
function Add-Label([string]$Text) { $label = [Windows.Forms.Label]::new(); $label.Text = $Text; $label.Width = 590; $label.AutoSize = $false; $label.Height = 38; $layout.Controls.Add($label) }
function Add-Input([bool]$Secret = $false) { $box = [Windows.Forms.TextBox]::new(); $box.Width = 590; $box.UseSystemPasswordChar = $Secret; $box.MaxLength = 1000; $layout.Controls.Add($box); return $box }
Add-Label '仅监听127.0.0.1:8788；关闭本窗口会停止服务。不会自动搜索、调用AI或保存密钥。'
Add-Label 'Chrome / Edge 扩展 ID（在扩展详情中复制32位ID）'; $extension = Add-Input
Add-Label '允许的公开域名（用逗号分隔，最多20个，不自动包括子域）'; $hosts = Add-Input; $hosts.Text = 'github.com'
Add-Label '代理访问密钥（插件中填写同一值；不是Brave Key）'; $token = Add-Input $true
$bytes = New-Object byte[] 24; $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose(); $token.Text = [Convert]::ToBase64String($bytes)
$copy = [Windows.Forms.Button]::new(); $copy.Text = '复制代理密钥（30秒后清除剪贴板）'; $copy.Width = 350; $layout.Controls.Add($copy)
$clipTimer = [Windows.Forms.Timer]::new(); $clipTimer.Interval = 30000; $script:copied = ''
$copy.Add_Click({ try { [Windows.Forms.Clipboard]::SetText($token.Text); $script:copied = $token.Text; $clipTimer.Start() } catch { [void][Windows.Forms.MessageBox]::Show('复制失败，请稍后重试。') } })
$clipTimer.Add_Tick({ try { if ([Windows.Forms.Clipboard]::GetText() -eq $script:copied) { [Windows.Forms.Clipboard]::Clear() } } catch {} finally { $script:copied = ''; $clipTimer.Stop() } })
Add-Label 'Brave Search API Key（可留空；健康检查不会验证账户或产生搜索费用）'; $brave = Add-Input $true
$start = [Windows.Forms.Button]::new(); $start.Text = '启动本地研究服务'; $start.Width = 250; $layout.Controls.Add($start)
$health = [Windows.Forms.Button]::new(); $health.Text = '检查本地连接（免费）'; $health.Width = 250; $health.Enabled = $false; $layout.Controls.Add($health)
$stop = [Windows.Forms.Button]::new(); $stop.Text = '安全停止服务'; $stop.Width = 250; $stop.Enabled = $false; $layout.Controls.Add($stop)
$status = [Windows.Forms.Label]::new(); $status.Text = '未启动。先填写配置，再点击启动。'; $status.Width = 590; $status.Height = 70; $layout.Controls.Add($status)
$script:child = $null; $script:config = $null
$start.Add_Click({
    try {
        $script:config = @{ token = $token.Text; origins = @('chrome-extension://' + $extension.Text.Trim()); hosts = @($hosts.Text.ToLowerInvariant().Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }); braveKey = $brave.Text }
        $script:child = Start-IdeaClipService $script:config
        $start.Enabled = $false; $stop.Enabled = $true; $health.Enabled = $true
        foreach ($b in @($extension,$hosts,$token,$brave)) { $b.Enabled = $false }
        $status.Text = '服务已启动：http://127.0.0.1:8788/research。请在插件保存配置并授权。搜索账户尚未验证。'
    } catch { $script:config = $null; $status.Text = $_.Exception.Message }
})
$health.Add_Click({ try { $r = Get-IdeaClipHealth $script:config; $status.Text = '本地代理连接正常。' + $(if ($r.search.configured) { '已填写搜索Key，上游未验证。' } else { '缺少搜索配置；公开网页/GitHub仍可使用。' }) } catch { $status.Text = $_.Exception.Message } })
$stop.Add_Click({ Stop-IdeaClipService $script:child; $script:child = $null; $script:config = $null; $brave.Clear(); $start.Enabled = $true; $stop.Enabled = $false; $health.Enabled = $false; foreach ($b in @($extension,$hosts,$token,$brave)) { $b.Enabled = $true }; $status.Text = '服务已安全停止。未终止其他程序；Brave Key已从输入框清除。' })
$form.Add_FormClosing({ Stop-IdeaClipService $script:child; $script:child = $null; $script:config = $null; $token.Clear(); $brave.Clear(); try { if ($script:copied -and [Windows.Forms.Clipboard]::GetText() -eq $script:copied) { [Windows.Forms.Clipboard]::Clear() } } catch {}; $script:copied = ''; $clipTimer.Dispose() })
if ($SmokeUI) {
    try {
        if (-not $token.UseSystemPasswordChar -or -not $brave.UseSystemPasswordChar -or $health.Enabled -or $stop.Enabled -or $layout.Controls.Count -ne 14) { throw 'UI construction validation failed' }
        Write-Output 'WINDOWS_UI_CONSTRUCTION_OK'
    } finally { $token.Clear(); $brave.Clear(); $clipTimer.Dispose(); $form.Dispose() }
    return
}
try { [void]$form.ShowDialog() } finally { $form.Dispose() }
