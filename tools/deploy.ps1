<#
  deploy.ps1 — 클럽별 빌드 + clasp push

  코어(gas/) + 클럽 프로필(clubs/<club>/Club.js) + 클럽의 .clasp.json 을 dist/<club>/ 로 합친 뒤
  그 폴더에서 clasp push 한다. gas/ 에는 .clasp.json 이 없으므로 코어만 실수로 push 될 일이 없다.

    .\tools\deploy.ps1 geumsong            # 빌드 + 검증 + clasp push
    .\tools\deploy.ps1 geumhyang -NoPush   # 빌드 + 검증만

  웹앱(웹훅)은 고정 버전 배포라, push 후 기존 절차대로 clasp create-version → redeploy 가 필요하다.
#>
param(
  [Parameter(Mandatory = $true)][string]$Club,
  [switch]$NoPush
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$clubDir = Join-Path $root "clubs\$Club"
$dist = Join-Path $root "dist\$Club"

if (-not (Test-Path (Join-Path $clubDir 'Club.js'))) { throw "clubs\$Club\Club.js 가 없습니다." }

# 폴더 자체는 두고 내용만 비운다(터미널이 그 폴더에 들어가 있으면 폴더 삭제가 잠겨 실패하므로)
New-Item -ItemType Directory -Force $dist | Out-Null
Get-ChildItem $dist -Force | Remove-Item -Recurse -Force -Confirm:$false
Copy-Item (Join-Path $root 'gas\*.js') $dist
# 매니페스트: 클럽 폴더에 있으면 그것을(예: clasp run 용 executionApi), 없으면 코어 기본값
$manifest = Join-Path $clubDir 'appsscript.json'
if (-not (Test-Path $manifest)) { $manifest = Join-Path $root 'gas\appsscript.json' }
Copy-Item $manifest $dist
Copy-Item (Join-Path $clubDir 'Club.js') $dist

# 검증 1: 구문
Get-ChildItem $dist -Filter *.js | ForEach-Object {
  node -c $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "구문 오류: $($_.Name)" }
}
# 검증 2: GAS 와 같은 순서로 전부 로드해 문구·계산 함수가 오류 없이 도는지(골든 하네스 재사용)
$golden = node (Join-Path $root 'tools\golden.js') $dist | ConvertFrom-Json
$errors = $golden.PSObject.Properties | Where-Object { $_.Value -is [string] -and $_.Value.StartsWith('ERROR') }
if ($errors) { $errors | ForEach-Object { Write-Host "  $($_.Name): $($_.Value)" -ForegroundColor Red }; throw "로드 검증 실패 ($Club)" }
Write-Host "✅ 빌드·검증 통과: dist\$Club ($((Get-ChildItem $dist -Filter *.js).Count)개 파일)"

if ($NoPush) { return }

$clasp = Join-Path $clubDir '.clasp.json'
if (-not (Test-Path $clasp)) { throw "clubs\$Club\.clasp.json 이 없습니다. 먼저 GAS 프로젝트를 만들고(clasp create) 이 위치에 두세요." }
Copy-Item $clasp $dist
Push-Location $dist
try { clasp push -f } finally { Pop-Location }
