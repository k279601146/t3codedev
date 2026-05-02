$path = 'D:\workkaifa\t3codedev\packages\ccb-engine\src\utils\worktree.ts'
$content = [System.IO.File]::ReadAllLines($path)
if ($null -eq $content) { Write-Error "Content is null"; exit 1 }
Write-Host "Read $($content.Length) lines"

$content[1384] = '      `\n${y("+--- iTerm2 Tip --------------------------------------------------------+")}\n` +'
$content[1385] = '        `${y("|")} To open as a tab instead of a new window:                           ${y("|")}\n` +'
$content[1386] = '        `${y("|")} iTerm2 > Settings > General > tmux > "Tabs in attaching window"     ${y("|")}\n` +'
$content[1387] = '        `${y("+-----------------------------------------------------------------------+")}\n`,'

[System.IO.File]::WriteAllLines($path, $content)
