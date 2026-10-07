$ErrorActionPreference = 'Continue'
$exe = '$env:LOCALAPPDATA\ima.copilot\Application\ima.copilot.exe'
$outDir = '$env:TEMP\tl-probe-icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class IconExtract {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern int PrivateExtractIcons(string lpszFile, int nIconIndex, int cxIcon, int cyIcon, IntPtr[] phicon, int[] piconid, int nIcons, int flags);
}
"@

# 1) PrivateExtractIcons:直读 PE 资源,绕过 shell 图标缓存
$handles = New-Object 'IntPtr[]' 4
$ids = New-Object 'int[]' 4
$n = [IconExtract]::PrivateExtractIcons($exe, 0, 256, 256, $handles, $ids, 4, 0)
Write-Output "PrivateExtractIcons(256px) count=$n"
for ($i = 0; $i -lt $n; $i++) {
    if ($handles[$i] -ne [IntPtr]::Zero) {
        $icon = [System.Drawing.Icon]::FromHandle($handles[$i])
        $bmp = $icon.ToBitmap()
        $png = Join-Path $outDir ("private_{0}.png" -f $i)
        $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Output ("  [{0}] {1}x{2} -> {3}" -f $i, $bmp.Width, $bmp.Height, $png)
        $bmp.Dispose()
        [void][IconExtract]::DestroyIcon($handles[$i])
    }
}

# 2) ExtractAssociatedIcon:shell 关联层(与 app.getFileIcon 同源)
try {
    $assoc = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
    $bmp2 = $assoc.ToBitmap()
    $png2 = Join-Path $outDir 'assoc.png'
    $bmp2.Save($png2, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output ("ExtractAssociatedIcon {0}x{1} -> {2}" -f $bmp2.Width, $bmp2.Height, $png2)
} catch {
    Write-Output "ExtractAssociatedIcon ERROR: $_"
}

# 3) 找 ima 的快捷方式并读 IconLocation
$lnkDirs = @(
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
    "$env:USERPROFILE\Desktop",
    'C:\Users\Public\Desktop'
)
$ws = New-Object -ComObject WScript.Shell
foreach ($dir in $lnkDirs) {
    if (-not (Test-Path $dir)) { continue }
    Get-ChildItem -Path $dir -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
        $lnk = $ws.CreateShortcut($_.FullName)
        if ($lnk.TargetPath -like '*ima*' -or $_.Name -like '*ima*') {
            Write-Output ("LNK: {0}" -f $_.FullName)
            Write-Output ("  TargetPath={0}" -f $lnk.TargetPath)
            Write-Output ("  IconLocation={0},{1}" -f $lnk.IconLocation, $lnk.IconLocation)
        }
    }
}

# 4) Application 目录结构(找真图标候选)
Write-Output '--- Application dir ---'
Get-ChildItem '$env:LOCALAPPDATA\ima.copilot\Application' -ErrorAction SilentlyContinue | Select-Object -First 12 | ForEach-Object { $tag = if ($_.PSIsContainer) { '<dir>' } else { $_.Length }; Write-Output ("  {0}  {1}" -f $_.Name, $tag) }
