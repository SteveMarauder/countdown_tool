param([switch]$Local, [switch]$Publish)
$ErrorActionPreference = 'Stop'
$previousOutputEncoding = $OutputEncoding
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$adminName = Read-Host '管理者帳戶（3–80 個英數字元）'
$securePassword = Read-Host '管理者密碼（至少 12 字元）' -AsSecureString
$adminCredential = New-Object System.Management.Automation.PSCredential($adminName, $securePassword)
$inputJson = @{ username = $adminName; password = $adminCredential.GetNetworkCredential().Password } | ConvertTo-Json -Compress
try {
    if ($Local) { $inputJson | node scripts/create-admin.mjs --local }
    else { $inputJson | node scripts/create-admin.mjs }
    if ($LASTEXITCODE -ne 0) { throw '管理者建立失敗。' }
    if ($Publish -and -not $Local) {
        npx wrangler d1 execute contest-clock --remote --file=work/admin.sql
        if ($LASTEXITCODE -ne 0) { throw '管理者匯入失敗，請稍後重新匯入 work/admin.sql。' }
    }
} finally {
    $inputJson = $null
    $adminCredential = $null
    $securePassword.Dispose()
    $OutputEncoding = $previousOutputEncoding
}
