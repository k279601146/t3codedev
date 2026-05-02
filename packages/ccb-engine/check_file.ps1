$path = 'D:\workkaifa\t3codedev\packages\ccb-engine\src\utils\worktree.ts'
Write-Host "Checking $path"
if (Test-Path $path) {
    $info = Get-Item $path
    Write-Host "File exists, size: $($info.Length) bytes"
    $content = Get-Content $path
    Write-Host "Read $($content.Count) lines via Get-Content"
} else {
    Write-Host "File does NOT exist"
}
