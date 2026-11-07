param([switch]$LibraryOnly, [switch]$SmokeUI, [switch]$AutoStart)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Start-IdeaClipSshEgress {
    param([string]$ConfigPath = '')
    $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    if (-not $ConfigPath) { $ConfigPath = Join-Path $repo 'private/ssh/research-egress.json' }
    if (-not (Test-Path -LiteralPath $configPath)) { throw '缺少本机专用SSH配置，请先完成部署和主机指纹核验。' }
    try { $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { throw '本机SSH配置无法读取或格式无效；不会显示原文件内容。' }
    $node = (Get-Command node -ErrorAction Stop).Source
    $version = & $node --version
    if ($version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) { throw '需要Node.js 24或更新版本。' }
    $info = [Diagnostics.ProcessStartInfo]::new(); $info.FileName = $node
    $info.Arguments = '"' + (Join-Path $repo 'tools/research-ssh-gateway.ts') + '"'
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    foreach ($name in @('BRAVE_SEARCH_API_KEY','IDEACLIP_RESEARCH_PROXY_TOKEN')) { $info.EnvironmentVariables.Remove($name) }
    $child = [Diagnostics.Process]::new(); $child.StartInfo = $info
    try {
        [void]$child.Start(); $child.BeginErrorReadLine()
        $bytes = [Text.Encoding]::UTF8.GetBytes(($config | ConvertTo-Json -Compress) + "`n")
        $child.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length); $child.StandardInput.BaseStream.Flush()
        $ready = $child.StandardOutput.ReadLineAsync()
        if (-not $ready.Wait(7000) -or -not $ready.Result -or ($ready.Result | ConvertFrom-Json).event -ne 'ready') { throw 'not-ready' }
        return $child
    } catch { if (-not $child.HasExited) { $child.Kill() }; $child.Dispose(); throw 'SSH出口启动失败，请检查配置、专用密钥权限或23334端口；未输出凭据。' }
}
function Stop-IdeaClipSshEgress($Child) {
    if ($null -eq $Child) { return }
    try { if (-not $Child.HasExited) { $bytes = [Text.Encoding]::UTF8.GetBytes("stop`n"); $Child.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length); $Child.StandardInput.BaseStream.Flush(); if (-not $Child.WaitForExit(5000)) { $Child.Kill(); $Child.WaitForExit() } } } finally { $Child.Dispose() }
}
if ($LibraryOnly) { return }
Add-Type -AssemblyName System.Windows.Forms
$form = [Windows.Forms.Form]::new(); $form.Text = 'IdeaClip 自有SSH研究出口'; $form.Width = 660; $form.Height = 300
$layout = [Windows.Forms.FlowLayoutPanel]::new(); $layout.Dock = 'Fill'; $layout.FlowDirection = 'TopDown'; $layout.WrapContents = $false; $form.Controls.Add($layout)
$label = [Windows.Forms.Label]::new(); $label.Width = 610; $label.Height = 100
$label.Text = '仅监听127.0.0.1:23334。专用SSH密钥只能执行公共域名解析和公共IP:443字节转发，不能登录Shell或原生端口转发。保留本机Node全部公共IP校验、IP固定及TLS验证；不修改系统网络，不自动搜索或调用AI。服务器系统维护仍由管理员负责。'
$layout.Controls.Add($label)
$start = [Windows.Forms.Button]::new(); $start.Width = 300; $start.Text = '启动SSH出口（不搜索）'; $layout.Controls.Add($start)
$stop = [Windows.Forms.Button]::new(); $stop.Width = 300; $stop.Text = '安全停止SSH出口'; $stop.Enabled = $false; $layout.Controls.Add($stop)
$status = [Windows.Forms.Label]::new(); $status.Width = 610; $status.Height = 60; $status.Text = '尚未启动。请勿将本机SSH私钥或配置加入Git/备份。'; $layout.Controls.Add($status)
$script:child = $null
$start.Add_Click({ try { $script:child = Start-IdeaClipSshEgress; $start.Enabled = $false; $stop.Enabled = $true; $status.Text = 'SSH出口已监听127.0.0.1:23334；上游连接只在请求时建立。免费TLS通过也不代表Brave认证/额度通过。' } catch { $status.Text = $_.Exception.Message } })
$stop.Add_Click({ Stop-IdeaClipSshEgress $script:child; $script:child = $null; $start.Enabled = $true; $stop.Enabled = $false; $status.Text = '已安全停止，仅终止本窗口创建的SSH子进程。' })
$form.Add_FormClosing({ Stop-IdeaClipSshEgress $script:child; $script:child = $null })
if ($SmokeUI) { try { if ($stop.Enabled -or $layout.Controls.Count -ne 4) { throw 'invalid-ui' }; 'SSH_EGRESS_UI_OK' } finally { $form.Dispose() }; return }
if ($AutoStart) { $form.Add_Shown({ $start.PerformClick() }) }
[void]$form.ShowDialog()
