$root = "D:\workkaifa\t3codedev"
$targets = @("packages", "apps")

$replacements = @{
    "脳" = "x"
    "锟" = "..."
    "鉁" = "(check)"
    "鈿" = "(warning)"
    "鈩" = "(info)"
    "鈼" = "(circle)"
    "鈥" = "..."
    "鈫" = "->"
    "鈫" = "->"
    "銆" = "{"
    "銆" = "}"
    "鈹" = "|"
}

foreach ($target in $targets) {
    $targetPath = Join-Path $root $target
    if (Test-Path $targetPath) {
        Write-Host "Processing directory for corruption: $targetPath"
        $files = Get-ChildItem -Path $targetPath -Include *.ts, *.tsx -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch "node_modules" }
        
        foreach ($file in $files) {
            $content = Get-Content $file.FullName -Raw
            if ($null -eq $content) { continue }
            
            $changed = $false
            foreach ($key in $replacements.Keys) {
                if ($content.Contains($key)) {
                    Write-Host "  Fixing '$key' in $($file.FullName)"
                    $content = $content.Replace($key, $replacements[$key])
                    $changed = $true
                }
            }

            if ($changed) {
                [System.IO.File]::WriteAllText($file.FullName, $content)
            }
        }
    }
}

Write-Host "Done fixing corruption."
