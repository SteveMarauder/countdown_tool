param([switch]$Local)
$ErrorActionPreference = 'Stop'
$adminName = Read-Host '管理者帳戶（3–80 個英數字元）'
$securePassword = Read-Host '管理者密碼（至少 12 字元）' -AsSecureString
$adminCredential = New-Object System.Management.Automation.PSCredential($adminName, $securePassword)
$inputJson = @{ username = $adminName; password = $adminCredential.GetNetworkCredential().Password } | ConvertTo-Json -Compress
try {
    if ($Local) { $inputJson | node scripts/create-admin.mjs --local }
    else { $inputJson | node scripts/create-admin.mjs }
    if ($LASTEXITCODE -ne 0) { throw '管理者建立失敗。' }
} finally {
    $inputJson = $null
    $adminCredential = $null
    $securePassword.Dispose()
}
