$packages = Get-ChildItem -Path 'D:\workkaifa\t3codedev\packages' -Directory
foreach ($pkg in $packages) {
    Write-Host "Checking package: $($pkg.Name)"
    $files = Get-ChildItem -Path $pkg.FullName -Filter *.ts -Recurse
    foreach ($file in $files) {
        $content = Get-Content $file.FullName
        if ($content -match '\.ts\.ts') {
            Write-Host "  Fixing $($file.FullName)"
            $newContent = $content -replace '\.ts\.ts', '.ts'
            $newContent | Set-Content $file.FullName -Encoding utf8
        }
    }
}
