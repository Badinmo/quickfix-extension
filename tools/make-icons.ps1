# Generates the extension icons: a rounded indigo tile with a white check mark.
#
#   powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
#
# Written as a self-contained PNG encoder in plain PowerShell (no Add-Type, no
# System.Drawing, no [Math]) so it also runs under Constrained Language Mode,
# which is what locked-down corporate builds use.

$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------------ CRC/Adler

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

function Get-Adler32($bytes) {
    $a = [long]1; $b = [long]0
    foreach ($byte in $bytes) {
        $a = ($a + $byte) % 65521
        $b = ($b + $a) % 65521
    }
    return ($b * 65536) + $a
}

function ConvertTo-Be32([long]$v) {
    return @(
        [int](($v -shr 24) -band 255),
        [int](($v -shr 16) -band 255),
        [int](($v -shr 8) -band 255),
        [int]($v -band 255)
    )
}

# ---------------------------------------------------------------- PNG pieces

function New-Chunk([string]$type, $data) {
    $typeBytes = @()
    foreach ($ch in $type.ToCharArray()) { $typeBytes += [int][char]$ch }
    $body = $typeBytes + $data
    return (ConvertTo-Be32 $data.Count) + $body + (ConvertTo-Be32 (Get-Crc32 $body))
}

# zlib stream using stored (uncompressed) deflate blocks — no compressor needed,
# and icons this small do not benefit from one.
function ConvertTo-ZlibStored($raw) {
    $out = @(120, 1)
    $i = 0
    $total = $raw.Count
    while ($i -lt $total) {
        $len = $total - $i
        if ($len -gt 65535) { $len = 65535 }
        $final = if (($i + $len) -ge $total) { 1 } else { 0 }
        $nlen = -bnot $len
        $out += @($final, ($len -band 255), (($len -shr 8) -band 255), ($nlen -band 255), (($nlen -shr 8) -band 255))
        $out += $raw[$i..($i + $len - 1)]
        $i += $len
    }
    return $out + (ConvertTo-Be32 (Get-Adler32 $raw))
}

function Save-Png([int]$size, $rgba, [string]$path) {
    # Prepend the per-row filter byte (0 = none).
    $stride = $size * 4
    $raw = , 0 * (($stride + 1) * $size)
    $r = 0
    for ($y = 0; $y -lt $size; $y++) {
        $raw[$r] = 0
        $r++
        $src = $y * $stride
        for ($x = 0; $x -lt $stride; $x++) {
            $raw[$r] = $rgba[$src + $x]
            $r++
        }
    }

    $ihdr = (ConvertTo-Be32 $size) + (ConvertTo-Be32 $size) + @(8, 6, 0, 0, 0)

    $png = @(137, 80, 78, 71, 13, 10, 26, 10) +
           (New-Chunk 'IHDR' $ihdr) +
           (New-Chunk 'IDAT' (ConvertTo-ZlibStored $raw)) +
           (New-Chunk 'IEND' @())

    Set-Content -Path $path -Value ([byte[]]$png) -Encoding Byte
}

# ----------------------------------------------------------------- rendering

function New-Tile([int]$S) {
    $img = , 0 * ($S * $S * 4)

    $radius = $S * 0.22
    $r2 = $radius * $radius
    $half = $S / 2.0
    $inner = $half - $radius

    # Check mark: three points, drawn as two thick round-capped segments.
    $ax = 0.26 * $S; $ay = 0.53 * $S
    $bx = 0.44 * $S; $by = 0.70 * $S
    $cx = 0.76 * $S; $cy = 0.32 * $S

    $v1x = $bx - $ax; $v1y = $by - $ay; $vv1 = ($v1x * $v1x) + ($v1y * $v1y)
    $v2x = $cx - $bx; $v2y = $cy - $by; $vv2 = ($v2x * $v2x) + ($v2y * $v2y)

    $th = $S * 0.058
    $th2 = $th * $th

    for ($y = 0; $y -lt $S; $y++) {
        $py = $y + 0.5
        $row = $y * $S * 4
        for ($x = 0; $x -lt $S; $x++) {
            $px = $x + 0.5

            # Rounded-rectangle coverage.
            $dx = $px - $half; if ($dx -lt 0) { $dx = -$dx }
            $dy = $py - $half; if ($dy -lt 0) { $dy = -$dy }
            $dx = $dx - $inner; if ($dx -lt 0) { $dx = 0 }
            $dy = $dy - $inner; if ($dy -lt 0) { $dy = 0 }
            $alpha = if ((($dx * $dx) + ($dy * $dy)) -le $r2) { 255 } else { 0 }

            # Diagonal gradient #635BFF -> #4338CA.
            $t = ($x + $y) / (2.0 * $S)
            $red = [int](99 + ((67 - 99) * $t))
            $grn = [int](91 + ((56 - 91) * $t))
            $blu = [int](255 + ((202 - 255) * $t))

            # Distance to segment 1.
            $wx = $px - $ax; $wy = $py - $ay
            $u = (($wx * $v1x) + ($wy * $v1y)) / $vv1
            if ($u -lt 0) { $u = 0 } elseif ($u -gt 1) { $u = 1 }
            $ex = $wx - ($u * $v1x); $ey = $wy - ($u * $v1y)
            $d2 = ($ex * $ex) + ($ey * $ey)

            if ($d2 -gt $th2) {
                # Distance to segment 2.
                $wx = $px - $bx; $wy = $py - $by
                $u = (($wx * $v2x) + ($wy * $v2y)) / $vv2
                if ($u -lt 0) { $u = 0 } elseif ($u -gt 1) { $u = 1 }
                $ex = $wx - ($u * $v2x); $ey = $wy - ($u * $v2y)
                $d2 = ($ex * $ex) + ($ey * $ey)
            }

            if ($d2 -le $th2) { $red = 255; $grn = 255; $blu = 255 }

            $i = $row + ($x * 4)
            # Transparent pixels keep the tile colour so downsampling does not
            # bleed black into the rounded edges.
            $img[$i] = $red
            $img[$i + 1] = $grn
            $img[$i + 2] = $blu
            $img[$i + 3] = $alpha
        }
    }
    return $img
}

# Box-downsample by 2 — this is where the anti-aliasing comes from.
function Get-Halved($img, [int]$S) {
    $H = [int]($S / 2)
    $out = , 0 * ($H * $H * 4)
    for ($y = 0; $y -lt $H; $y++) {
        $srcRowA = ($y * 2) * $S * 4
        $srcRowB = (($y * 2) + 1) * $S * 4
        $dstRow = $y * $H * 4
        for ($x = 0; $x -lt $H; $x++) {
            $a = $srcRowA + ($x * 8)
            $b = $srcRowB + ($x * 8)
            $d = $dstRow + ($x * 4)
            # No rounding bias term here: sum/4 tops out at exactly 255, and
            # [int] rounds half-to-even, so (sum + 2) / 4 could reach 256.
            $out[$d]     = [int](($img[$a]     + $img[$a + 4] + $img[$b]     + $img[$b + 4]) / 4)
            $out[$d + 1] = [int](($img[$a + 1] + $img[$a + 5] + $img[$b + 1] + $img[$b + 5]) / 4)
            $out[$d + 2] = [int](($img[$a + 2] + $img[$a + 6] + $img[$b + 2] + $img[$b + 6]) / 4)
            $out[$d + 3] = [int](($img[$a + 3] + $img[$a + 7] + $img[$b + 3] + $img[$b + 7]) / 4)
        }
    }
    return $out
}

# ---------------------------------------------------------------------- main

$outDir = Join-Path $PSScriptRoot '..\icons'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

Write-Output 'Rendering...'

# 256 -> 128 -> 64 -> 32 -> 16
$img = New-Tile 256
$px128 = Get-Halved $img 256
$px64 = Get-Halved $px128 128
$px32 = Get-Halved $px64 64
$px16 = Get-Halved $px32 32

# 96 -> 48
$px48 = Get-Halved (New-Tile 96) 96

Save-Png 128 $px128 (Join-Path $outDir 'icon128.png')
Save-Png 48  $px48  (Join-Path $outDir 'icon48.png')
Save-Png 32  $px32  (Join-Path $outDir 'icon32.png')
Save-Png 16  $px16  (Join-Path $outDir 'icon16.png')

foreach ($s in 16, 32, 48, 128) {
    $f = Join-Path $outDir "icon$s.png"
    Write-Output "wrote $f ($((Get-Item $f).Length) bytes)"
}
