# Builds the Chrome Web Store / Edge Add-ons upload package: a plain ZIP of
# dist\package (which has already had manifest.json's dev-only "key" field
# stripped -the store assigns its own permanent ID on first upload and
# ignores that field anyway).
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
$zipPath = Join-Path $root 'dist\quickfix-webstore.zip'

if (-not (Test-Path $packageDir)) {
    throw "dist\package not found - stage the store file set first (see README's Web Store section)."
}

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
