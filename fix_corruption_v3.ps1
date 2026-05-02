$root = "D:\workkaifa\t3codedev"
$targets = @("packages", "apps")

# Define replacements correctly for PS 5.1
$replacements = @{}
$replacements[[char]0x00D7] = "x"
$replacements[[char]0xFFFD] = "..."
$replacements[[char]0x2714] = "(check)"
$replacements[[char]0x26A0] = "(warning)"
$replacements[[char]0x2139] = "(info)"
$replacements[[char]0x25CF] = "(circle)"
$replacements[[char]0x2026] = "..."
$replacements[[char]0x2192] = "->"

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
                # Convert char to string for Contains
                $keyStr = $key.ToString()
                if ($content.Contains($keyStr)) {
                    Write-Host "  Fixing character code $([int]$key) in $($file.FullName)"
                    $content = $content.Replace($keyStr, $replacements[$key])
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
