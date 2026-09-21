<#
  worker-deploy.ps1 — 클럽의 Cloudflare Worker(텔레그램 웹훅 프록시) 배포 + 비밀값 설정

    .\tools\worker-deploy.ps1 geumhyang -GasUrl "https://script.google.com/.../exec"   # 최초: 배포 + 비밀값 2개
    .\tools\worker-deploy.ps1 geumhyang                                                # 이후: 코드만 재배포

  - 사전 조건: npx wrangler login (브라우저에서 Allow 1회)
  - TG_SECRET 은 여기서 무작위로 만들어 Worker 에 넣고 **클립보드에만** 복사한다(화면·로그에 출력하지 않음).
    → GAS 스크립트 속성 WEBHOOK_SECRET 에 Ctrl+V 로 붙여넣는다. 두 값이 같아야 봇이 동작한다.
  - -RotateSecret : 비밀값만 새로 만들어 교체(교체 후 WEBHOOK_SECRET 도 새 값으로 바꾸고 setWebhook 재실행)
#>
param(
  [Parameter(Mandatory = $true)][string]$Club,
  [string]$GasUrl,
  [switch]$RotateSecret
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "clubs\$Club\worker"
if (-not (Test-Path (Join-Path $dir 'wrangler.toml'))) { throw "clubs\$Club\worker\wrangler.toml 이 없습니다." }

Push-Location $dir
try {
  npx --yes wrangler deploy
  if ($LASTEXITCODE -ne 0) { throw 'wrangler deploy 실패' }

  if ($GasUrl) {
    if ($GasUrl -notmatch '^https://script\.google\.com/.+/exec$') { throw 'GasUrl 은 https://script.google.com/.../exec 형식이어야 합니다.' }
    $GasUrl | npx --yes wrangler secret put GAS_URL | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'GAS_URL 설정 실패' }
    Write-Host '✅ GAS_URL 설정됨'
  }

  if ($GasUrl -or $RotateSecret) {
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    $bytes = [byte[]]::new(48)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $secret = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
    $secret | npx --yes wrangler secret put TG_SECRET | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'TG_SECRET 설정 실패' }
    Set-Clipboard -Value $secret
    $secret = $null
    Write-Host '✅ TG_SECRET 설정됨 — 값은 클립보드에 복사했습니다. GAS 스크립트 속성 WEBHOOK_SECRET 에 Ctrl+V 하세요.'
  }
} finally { Pop-Location }
