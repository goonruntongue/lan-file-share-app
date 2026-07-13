$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$hostName = 'flashmelody.sakura.ne.jp'
$userName = 'flashmelody'
$remoteDirectory = '~/www/lan-fileshare-app-dl'
$keyPath = Join-Path $env:USERPROFILE '.ssh\id_ed25519_flashmelody_deploy'
$files = @(
    'index.html',
    'style.css',
    'manifest.json',
    'app-icon.ico',
    'app-icon.svg',
    'favicon.png',
    'pwa-icon.png',
    'lan-file-share.exe'
)

foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $file) -PathType Leaf)) {
        throw "Missing deploy file: $file"
    }
}

& ssh -i $keyPath -o IdentitiesOnly=yes -o BatchMode=yes "$userName@$hostName" "mkdir -p $remoteDirectory"
if ($LASTEXITCODE -ne 0) { throw 'Could not create the deployment directory.' }

$localPaths = $files | ForEach-Object { Join-Path $PSScriptRoot $_ }
& scp -i $keyPath -o IdentitiesOnly=yes -o BatchMode=yes @localPaths "${userName}@${hostName}:$remoteDirectory/"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed.' }

Write-Host 'Deployment complete: https://flashmelody.sakura.ne.jp/lan-fileshare-app-dl/'
