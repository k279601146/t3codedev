function Fix-CorruptedFile($path, $regex, $replacement) {
    Write-Host "Fixing $path"
    $content = Get-Content $path
    if ($null -eq $content) { Write-Error "Could not read $path"; return }
    $newContent = $content -replace $regex, $replacement
    $newContent | Set-Content $path -Encoding utf8
}

# Fix analyzeContext.ts
Fix-CorruptedFile 'D:\workkaifa\t3codedev\packages\ccb-engine\src\utils\analyzeContext.ts' 'firstLine.slice\(0, 40\) \+ .*' '  return firstLine.length > 40 ? firstLine.slice(0, 40) + "..." : firstLine'

# Fix metadata.ts
Fix-CorruptedFile 'D:\workkaifa\t3codedev\packages\ccb-engine\src\services\analytics\metadata.ts' 'mapped.push\(\[''\?, .*' '      mapped.push(["...", `${entries.length} keys`])'

# Fix pipes.ts
Fix-CorruptedFile 'D:\workkaifa\t3codedev\packages\ccb-engine\src\commands\pipes\pipes.ts' 'Selected \$\{pipeName\} \?.*' '      value: `Selected ${pipeName} - messages will be broadcast to this pipe.`,'
Fix-CorruptedFile 'D:\workkaifa\t3codedev\packages\ccb-engine\src\commands\pipes\pipes.ts' 'isSelected \? ''\? : ''\?' '    const checkbox = isSelected ? "[x]" : "[ ]"'
Fix-CorruptedFile 'D:\workkaifa\t3codedev\packages\ccb-engine\src\commands\pipes\pipes.ts' 'none \?messages.*' '    `Selected: ${selected.length > 0 ? selected.join(", ") : "(none - messages run locally only)"}`,'
Fix-CorruptedFile 'D:\workkaifa\t3codedev\packages\ccb-engine\src\commands\pipes\pipes.ts' '<name>\s+\?.*' '  lines.push("  /pipes select <name>    - select pipe for broadcast")'
Fix-CorruptedFile 'D:\workkaifa\t3codedev\packages\ccb-engine\src\commands\pipes\pipes.ts' 'deselect <name>\s+\?.*' '  lines.push("  /pipes deselect <name>  - deselect pipe")'
Fix-CorruptedFile 'D:\workkaifa\t3codedev\packages\ccb-engine\src\commands\pipes\pipes.ts' 'all\s+\?.*' '  lines.push("  /pipes all              - select all connected")'
Fix-CorruptedFile 'D:\workkaifa\t3codedev\packages\ccb-engine\src\commands\pipes\pipes.ts' 'none\s+\?.*' '  lines.push("  /pipes none             - deselect all")'
Fix-CorruptedFile 'D:\workkaifa\t3codedev\packages\ccb-engine\src\commands\pipes\pipes.ts' '<msg>\s+\?.*' '  lines.push("  /send <name> <msg>      - send to specific pipe")'
Fix-CorruptedFile 'D:\workkaifa\t3codedev\packages\ccb-engine\src\commands\pipes\pipes.ts' 'claim-main\s+\?.*' '  lines.push("  /claim-main             - claim this machine as main")'
