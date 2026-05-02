$packages = Get-ChildItem -Path 'D:\workkaifa\t3codedev\packages' -Directory
foreach ($pkg in $packages) {
    Write-Host "Checking package: $($pkg.Name)"
    # Include both .ts and .tsx files
    $files = Get-ChildItem -Path $pkg.FullName -Include *.ts, *.tsx -Recurse
    foreach ($file in $files) {
        $content = Get-Content $file.FullName
        if ($content -match '\.ts\.ts') {
            Write-Host "  Fixing $($file.FullName)"
            $newContent = $content -replace '\.ts\.ts', '.ts'
            $newContent | Set-Content $file.FullName -Encoding utf8
        }
    }
}
