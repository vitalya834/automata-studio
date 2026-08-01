$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$buildDirectory = Join-Path $projectRoot 'build'

function Add-CenteredText($Graphics, [string]$Text, [single]$Y, [single]$Size, $Color, [System.Drawing.FontStyle]$Style) {
    $font = [System.Drawing.Font]::new('Segoe UI', $Size, $Style, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = [System.Drawing.SolidBrush]::new($Color)
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    try { $Graphics.DrawString($Text, $font, $brush, 82, $Y, $format) }
    finally { $format.Dispose(); $brush.Dispose(); $font.Dispose() }
}

function New-Sidebar([string]$Destination, $Accent, [bool]$Uninstall) {
    $bitmap = [System.Drawing.Bitmap]::new(164, 314, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $top = if ($Uninstall) { [System.Drawing.Color]::FromArgb(30, 23, 17) } else { [System.Drawing.Color]::FromArgb(16, 25, 26) }
    $bottom = if ($Uninstall) { [System.Drawing.Color]::FromArgb(13, 10, 8) } else { [System.Drawing.Color]::FromArgb(7, 11, 13) }
    $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new([System.Drawing.Rectangle]::new(0, 0, 164, 314), $top, $bottom, 90)
    try {
        $graphics.FillRectangle($background, 0, 0, 164, 314)
        $gridPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(22, $Accent), 1)
        $borderPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(95, $Accent), 1)
        $flowPen = [System.Drawing.Pen]::new($Accent, 3)
        try {
            for ($position = 0; $position -lt 164; $position += 18) { $graphics.DrawLine($gridPen, $position, 0, $position, 314) }
            for ($position = 0; $position -lt 314; $position += 18) { $graphics.DrawLine($gridPen, 0, $position, 164, $position) }
            $graphics.DrawRectangle($borderPen, 18, 18, 128, 278)
            $graphics.DrawEllipse($flowPen, 35, 99, 18, 18)
            $graphics.DrawEllipse($flowPen, 111, 99, 18, 18)
            $graphics.DrawLine($flowPen, 54, 108, 110, 108)
            $graphics.DrawLines($flowPen, [System.Drawing.Point[]]@([System.Drawing.Point]::new(102, 102), [System.Drawing.Point]::new(110, 108), [System.Drawing.Point]::new(102, 114)))
        } finally { $flowPen.Dispose(); $borderPen.Dispose(); $gridPen.Dispose() }
        Add-CenteredText $graphics 'AUTOMATA' 150 13 ([System.Drawing.Color]::FromArgb(238, 246, 245)) ([System.Drawing.FontStyle]::Bold)
        Add-CenteredText $graphics 'STUDIO' 167 13 ([System.Drawing.Color]::FromArgb(238, 246, 245)) ([System.Drawing.FontStyle]::Bold)
        $accentBrush = [System.Drawing.SolidBrush]::new($Accent)
        try { $graphics.FillRectangle($accentBrush, 49, 197, 66, 2) } finally { $accentBrush.Dispose() }
        if ($Uninstall) {
            Add-CenteredText $graphics 'SAFE REMOVE' 217 8 ([System.Drawing.Color]::FromArgb(180, 155, 136)) ([System.Drawing.FontStyle]::Regular)
            Add-CenteredText $graphics 'Your model files stay yours' 235 7 ([System.Drawing.Color]::FromArgb(119, 104, 93)) ([System.Drawing.FontStyle]::Regular)
        } else {
            Add-CenteredText $graphics 'MODEL  •  GENERATE' 217 7 ([System.Drawing.Color]::FromArgb(127, 148, 149)) ([System.Drawing.FontStyle]::Regular)
            Add-CenteredText $graphics 'RUN  •  REPORT' 232 7 ([System.Drawing.Color]::FromArgb(127, 148, 149)) ([System.Drawing.FontStyle]::Regular)
            Add-CenteredText $graphics 'WINDOWS DESKTOP' 275 7 $Accent ([System.Drawing.FontStyle]::Regular)
        }
        $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally { $background.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
}

function New-Header([string]$Destination) {
    $bitmap = [System.Drawing.Bitmap]::new(150, 57, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new([System.Drawing.Rectangle]::new(0, 0, 150, 57), [System.Drawing.Color]::FromArgb(16, 25, 26), [System.Drawing.Color]::FromArgb(7, 16, 15), 20)
    try {
        $graphics.FillRectangle($background, 0, 0, 150, 57)
        $cyan = [System.Drawing.Color]::FromArgb(82, 211, 200)
        $pen = [System.Drawing.Pen]::new($cyan, 2)
        try { $graphics.DrawRectangle($pen, 12, 9, 36, 39); $graphics.DrawLine($pen, 20, 43, 30, 15); $graphics.DrawLine($pen, 30, 15, 42, 43); $graphics.DrawLine($pen, 24, 33, 37, 33) } finally { $pen.Dispose() }
        $titleFont = [System.Drawing.Font]::new('Segoe UI', 9, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $smallFont = [System.Drawing.Font]::new('Segoe UI', 6, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
        $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(238, 246, 245))
        $cyanBrush = [System.Drawing.SolidBrush]::new($cyan)
        try { $graphics.DrawString('AUTOMATA STUDIO', $titleFont, $white, 56, 16); $graphics.DrawString('DESKTOP SETUP', $smallFont, $cyanBrush, 57, 35) }
        finally { $cyanBrush.Dispose(); $white.Dispose(); $smallFont.Dispose(); $titleFont.Dispose() }
        $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally { $background.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
}

New-Sidebar (Join-Path $buildDirectory 'installerSidebar.bmp') ([System.Drawing.Color]::FromArgb(82, 211, 200)) $false
New-Sidebar (Join-Path $buildDirectory 'uninstallerSidebar.bmp') ([System.Drawing.Color]::FromArgb(242, 159, 88)) $true
New-Header (Join-Path $buildDirectory 'installerHeader.bmp')

Get-ChildItem -LiteralPath $buildDirectory -File -Filter '*.bmp' | Select-Object Name, Length
