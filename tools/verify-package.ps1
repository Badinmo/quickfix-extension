# Independent check on dist\kalam-webstore.zip: walks the local file
# headers by hand, re-reads each entry's raw bytes, and confirms the stored
# CRC-32 matches what's actually in the archive. Written separately from
# build-package.ps1 (own CRC table, own byte reader) so it isn't just
# checking the builder's math against itself.

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$zipPath = Join-Path $root 'dist\kalam-webstore.zip'

$bytes = Get-Content -Path $zipPath -Encoding Byte -ReadCount 0

$crcTable = , 0 * 256
for ($n = 0; $n -lt 256; $n++) {
    $c = [long]$n
    for ($k = 0; $k -lt 8; $k++) {
        if ($c -band 1) { $c = 3988292384 -bxor ($c -shr 1) } else { $c = $c -shr 1 }
    }
    $crcTable[$n] = $c
}
function Crc32($data) {
    $crc = [long]4294967295
    foreach ($b in $data) { $crc = $crcTable[[int](($crc -bxor $b) -band 255)] -bxor ($crc -shr 8) }
    return $crc -bxor 4294967295
}
function Le16($bytes, $pos) { return [int]$bytes[$pos] + ([int]$bytes[$pos + 1] * 256) }
function Le32($bytes, $pos) {
    return [long]$bytes[$pos] + ([long]$bytes[$pos + 1] * 256) + ([long]$bytes[$pos + 2] * 65536) + ([long]$bytes[$pos + 3] * 16777216)
}

$pos = 0
$n = 0
$ok = 0
while ($pos -lt $bytes.Count - 4) {
    $sig = Le32 $bytes $pos
    if ($sig -ne 0x04034b50) { break }   # hit the central directory

    $method = Le16 $bytes ($pos + 8)
    $crcStored = Le32 $bytes ($pos + 14)
    $compSize = Le32 $bytes ($pos + 18)
    $rawSize = Le32 $bytes ($pos + 22)
    $nameLen = Le16 $bytes ($pos + 26)
    $extraLen = Le16 $bytes ($pos + 28)

    $nameStart = $pos + 30
    $name = ''
    for ($i = 0; $i -lt $nameLen; $i++) { $name += [char]$bytes[$nameStart + $i] }

    $dataStart = $nameStart + $nameLen + $extraLen
    $data = if ($compSize -gt 0) { $bytes[$dataStart..($dataStart + $compSize - 1)] } else { @() }

    $crcActual = Crc32 $data
    $match = ($crcActual -eq $crcStored) -and ($compSize -eq $rawSize) -and ($method -eq 0)
    if ($match) { $ok++ }
    "{0}  {1,-28} {2,7} bytes  crc stored=0x{3:X8} actual=0x{4:X8}" -f $(if ($match) { 'OK  ' } else { 'FAIL' }), $name, $rawSize, $crcStored, $crcActual

    $pos = $dataStart + $compSize
    $n++
}

"`n$ok / $n entries verified (CRC-32 + size + stored-method all matched independently)"
if ($ok -ne $n) { throw "package verification FAILED" }
