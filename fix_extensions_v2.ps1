$root = "D:\workkaifa\t3codedev"
$targets = @("packages", "apps")

foreach ($target in $targets) {
    $targetPath = Join-Path $root $target
    if (Test-Path $targetPath) {
        Write-Host "Processing directory: $targetPath"
        # Exclude node_modules for speed
        $files = Get-ChildItem -Path $targetPath -Include *.ts, *.tsx -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch "node_modules" }
        
        foreach ($file in $files) {
            $content = Get-Content $file.FullName -Raw
            if ($null -eq $content) { continue }
            
            $changed = $false
            if ($content.Contains(".ts.ts")) {
                Write-Host "  Fixing .ts.ts in $($file.FullName)"
                $content = $content.Replace(".ts.ts", ".ts")
                $changed = $true
            }
            if ($content.Contains(".tsx.tsx")) {
                Write-Host "  Fixing .tsx.tsx in $($file.FullName)"
                $content = $content.Replace(".tsx.tsx", ".tsx")
                $changed = $true
            }
            if ($content.Contains(".js.js")) {
                Write-Host "  Fixing .js.js in $($file.FullName)"
                $content = $content.Replace(".js.js", ".js")
                $changed = $true
            }

            if ($changed) {
                [System.IO.File]::WriteAllText($file.FullName, $content)
            }
        }
    }
}

Write-Host "Done."
