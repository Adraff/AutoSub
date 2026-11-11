# Construye el instalador de AutoSub sin herramientas de terceros.
# Usa solo lo que ya trae Windows: PowerShell + el compilador de C# de .NET Framework 4.
#
# Uso:  powershell -ExecutionPolicy Bypass -File installer\build.ps1
# Resultado:
#   dist\AutoSub-Installer.exe   (Windows: instalador grafico con el panel incrustado)
#   dist\AutoSub-macOS.zip       (macOS: carpeta del panel + script de instalacion)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$ext = Join-Path $root 'extension'
$dist = Join-Path $root 'dist'
$build = Join-Path $root 'build'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Force $build | Out-Null
New-Item -ItemType Directory -Force $dist | Out-Null

# 1) Empaquetar el panel en payload.zip (rutas con "/")
$payload = Join-Path $build 'payload.zip'
$zip = [System.IO.Compression.ZipFile]::Open($payload, 'Create')
try {
    Get-ChildItem $ext -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($ext.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, 'Optimal') | Out-Null
    }
} finally { $zip.Dispose() }
Write-Host "Panel empaquetado: $payload"

# 2) Compilar con csc.exe de .NET Framework
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'No se encontro csc.exe de .NET Framework 4.' }

$fw = Split-Path $csc

$exe = Join-Path $dist 'AutoSub-Installer.exe'
$src = Join-Path $PSScriptRoot 'Installer.cs'

& $csc /nologo /target:winexe /optimize+ /codepage:65001 `
    "/out:$exe" `
    "/resource:$payload,payload.zip" `
    "/r:$fw\System.IO.Compression.dll" `
    "/r:$fw\System.IO.Compression.FileSystem.dll" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll `
    $src
if ($LASTEXITCODE -ne 0) { throw 'Error al compilar el instalador.' }
Write-Host "Instalador de Windows: $exe"

# 3) Paquete para macOS
$macZip = Join-Path $dist 'AutoSub-macOS.zip'
if (Test-Path $macZip) { Remove-Item $macZip -Force }
$zip = [System.IO.Compression.ZipFile]::Open($macZip, 'Create')
try {
    Get-ChildItem $ext -Recurse -File | ForEach-Object {
        $rel = 'AutoSub/extension/' + $_.FullName.Substring($ext.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, 'Optimal') | Out-Null
    }
    $cmd = Join-Path $PSScriptRoot 'Instalar-AutoSub-mac.command'
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $cmd, 'AutoSub/Instalar-AutoSub-mac.command', 'Optimal') | Out-Null
} finally { $zip.Dispose() }
Write-Host "Paquete macOS: $macZip"

Remove-Item $build -Recurse -Force
Write-Host 'Listo.'
