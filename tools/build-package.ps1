# Builds the Chrome Web Store upload package for Kalam: stages the runtime file
# set into dist\package with manifest.json's dev-only "key" field stripped (the
# store assigns its own permanent ID on first upload and ignores that field
# anyway), then writes it as a plain ZIP, dist\kalam-webstore.zip.
#
#   powershell -ExecutionPolicy Bypass -File tools\build-package.ps1
#
# Written as a self-contained ZIP encoder in plain PowerShell -no Add-Type,
# no System.IO.Compression, no [Convert] -so it also runs under Constrained
# Language Mode, same constraint as tools\make-icons.ps1. Entries are stored
# (uncompressed); the package is a few hundred KB either way.

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$packageDir = Join-Path $root 'dist\package'
$zipPath = Join-Path $root 'dist\kalam-webstore.zip'

# ----------------------------------------------------------------- staging

# Only what the browser loads. Tests, docs, tools and the repo metadata stay out.
$packageItems = @('manifest.json', 'background', 'content', 'lib', 'options', 'popup', 'offscreen', 'icons')

# images/ holds the onboarding step screenshots (onboarding-1.png .. onboarding-4.png).
# They are optional (README: "with no file there is no image and no broken icon"), so
# this folder may legitimately not exist yet; only stage it when it does.
$optionalItems = @('images')

if (Test-Path $packageDir) { Remove-Item -Path $packageDir -Recurse -Force }
New-Item -ItemType Directory -Path $packageDir | Out-Null
foreach ($item in $packageItems) {
    Copy-Item -Path (Join-Path $root $item) -Destination (Join-Path $packageDir $item) -Recurse
}
foreach ($item in $optionalItems) {
    $src = Join-Path $root $item
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination (Join-Path $packageDir $item) -Recurse
        "staged optional $item"
    }
}

# Plain UTF-8 bytes, no BOM: Set-Content -Encoding UTF8 would prepend one, and
# a BOM in front of manifest.json is exactly the kind of thing that makes a
# store upload fail with "manifest is not valid JSON".
function Get-Utf8Bytes([string]$text) {
    $bytes = @()
    foreach ($ch in $text.ToCharArray()) {
        $c = [int]$ch
        if ($c -lt 128) {
            $bytes += $c
        } elseif ($c -lt 2048) {
            $bytes += (192 -bor ($c -shr 6)), (128 -bor ($c -band 63))
        } else {
            $bytes += (224 -bor ($c -shr 12)), (128 -bor (($c -shr 6) -band 63)), (128 -bor ($c -band 63))
        }
    }
    return $bytes
}

$manifestPath = Join-Path $packageDir 'manifest.json'
$manifest = Get-Content -Path $manifestPath -Raw -Encoding UTF8
$stripped = $manifest -replace '(?m)^\s*"key":\s*"[^"]*",\s*\r?\n', ''
if ($stripped -eq $manifest) { throw 'manifest.json: expected a "key" field to strip and found none.' }
Set-Content -Path $manifestPath -Value ([byte[]](Get-Utf8Bytes $stripped)) -Encoding Byte
"staged $packageDir (manifest key stripped)"

# ------------------------------------------------------------------- CRC32

$script:CrcTable = , 0 * 256
for ($n = 0; $n -lt 256; $n++) {
    $c = [long]$n
    for ($k = 0; $k -lt 8; $k++) {
        if ($c -band 1) { $c = 3988292384 -bxor ($c -shr 1) } else { $c = $c -shr 1 }
    }
    $script:CrcTable[$n] = $c
}

function Get-Crc32($bytes) {
    $crc = [long]4294967295
    foreach ($b in $bytes) {
        $crc = $script:CrcTable[[int](($crc -bxor $b) -band 255)] -bxor ($crc -shr 8)
    }
    return $crc -bxor 4294967295
}

# --------------------------------------------------------------- LE packing

function Get-Le16([int]$v) {
    return @([int]($v -band 255), [int](($v -shr 8) -band 255))
}
function Get-Le32([long]$v) {
    return @(
        [int]($v -band 255),
        [int](($v -shr 8) -band 255),
        [int](($v -shr 16) -band 255),
        [int](($v -shr 24) -band 255)
    )
}

function Get-DosDateTime {
    $now = Get-Date
    $dosTime = (($now.Hour -band 31) -shl 11) -bor ((($now.Minute) -band 63) -shl 5) -bor ([int]($now.Second / 2) -band 31)
    $dosDate = (((($now.Year - 1980)) -band 127) -shl 9) -bor (($now.Month -band 15) -shl 5) -bor ($now.Day -band 31)
    return @{ time = $dosTime; date = $dosDate }
}

# -------------------------------------------------------------- file walk

$files = Get-ChildItem -Path $packageDir -Recurse -File | Sort-Object FullName
$dt = Get-DosDateTime

$localParts = @()      # bytes of all local file headers + data, in order
$centralParts = @()    # bytes of all central directory entries, in order
$offset = 0             # running byte offset from start of archive
$count = 0

foreach ($f in $files) {
    $relPath = $f.FullName.Substring($packageDir.Length + 1).Replace('\', '/')
    $nameBytes = @()
    foreach ($ch in $relPath.ToCharArray()) { $nameBytes += [int]$ch }   # ASCII-only paths

    $data = Get-Content -Path $f.FullName -Encoding Byte -ReadCount 0
    if ($null -eq $data) { $data = @() }
    $crc = Get-Crc32 $data
    $size = $data.Count

    $localHeader = @(80, 75, 3, 4) +                # local file header signature
                   (Get-Le16 20) +                   # version needed
                   (Get-Le16 0) +                     # flags
                   (Get-Le16 0) +                     # method: stored
                   (Get-Le16 $dt.time) + (Get-Le16 $dt.date) +
                   (Get-Le32 $crc) +
                   (Get-Le32 $size) + (Get-Le32 $size) +
                   (Get-Le16 $nameBytes.Count) + (Get-Le16 0) +
                   $nameBytes

    $localParts += , ($localHeader + $data)

    $centralHeader = @(80, 75, 1, 2) +               # central directory signature
                     (Get-Le16 20) + (Get-Le16 20) +
                     (Get-Le16 0) + (Get-Le16 0) +
                     (Get-Le16 $dt.time) + (Get-Le16 $dt.date) +
                     (Get-Le32 $crc) +
                     (Get-Le32 $size) + (Get-Le32 $size) +
                     (Get-Le16 $nameBytes.Count) + (Get-Le16 0) + (Get-Le16 0) +
                     (Get-Le16 0) + (Get-Le16 0) +
                     (Get-Le32 0) +
                     (Get-Le32 $offset) +
                     $nameBytes

    $centralParts += , $centralHeader

    $offset += $localHeader.Count + $data.Count
    $count++
    "added: $relPath ($size bytes)"
}

$centralStart = $offset
$centralSize = 0
foreach ($c in $centralParts) { $centralSize += $c.Count }

$eocd = @(80, 75, 5, 6) +
        (Get-Le16 0) + (Get-Le16 0) +
        (Get-Le16 $count) + (Get-Le16 $count) +
        (Get-Le32 $centralSize) +
        (Get-Le32 $centralStart) +
        (Get-Le16 0)

$all = @()
foreach ($p in $localParts) { $all += $p }
foreach ($c in $centralParts) { $all += $c }
$all += $eocd

Set-Content -Path $zipPath -Value ([byte[]]$all) -Encoding Byte
"`nwrote $zipPath ($($all.Count) bytes, $count files)"
