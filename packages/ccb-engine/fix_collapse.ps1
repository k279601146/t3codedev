function Fix-CorruptedFile($path, $regex, $replacement) {
    Write-Host "Fixing $path"
    $content = Get-Content $path
    if ($null -eq $content) { Write-Error "Could not read $path"; return }
    $newContent = $content -replace $regex, $replacement
    $newContent | Set-Content $path -Encoding utf8
}

$path = 'D:\workkaifa\t3codedev\packages\ccb-engine\src\utils\collapseReadSearch.ts'

# Fix all instances of the corrupted character followed by "hint" or "renderer" or comment marker
Fix-CorruptedFile $path ' 锟\? ' ' - '
Fix-CorruptedFile $path ' 锟\?hint' ' hint'
Fix-CorruptedFile $path ' 锟\? renderer' ' renderer'
Fix-CorruptedFile $path ' 锟\?counted' ' - counted'
Fix-CorruptedFile $path ' 锟\?same' ' - same'
Fix-CorruptedFile $path ' 锟\?command' ' - command'
Fix-CorruptedFile $path ' 锟\?collect' ' - collect'
Fix-CorruptedFile $path ' 锟\?update' ' - update'
Fix-CorruptedFile $path ' 锟\?block' ' - block'
Fix-CorruptedFile $path ' 锟\?that' ' - that'
Fix-CorruptedFile $path ' 锟\?Loaded' ' - Loaded'
Fix-CorruptedFile $path 'times锟\?' 'times'
Fix-CorruptedFile $path '\$\{text\}锟\? : text' '`${text}...` : text'
Fix-CorruptedFile $path 'cap 锟\?the' 'cap - the'
Fix-CorruptedFile $path 'silently 锟\?its' 'silently - its'
Fix-CorruptedFile $path 'category 锟\?"' 'category - "'
Fix-CorruptedFile $path 'stderr 锟\?scan' 'stderr - scan'
Fix-CorruptedFile $path 'tool_use_id 锟\?command' 'tool_use_id - command'
Fix-CorruptedFile $path 'double-count 锟\?e.g.' 'double-count - e.g.'
Fix-CorruptedFile $path 'readFilePaths 锟\?readFilePaths' 'readFilePaths - readFilePaths'
Fix-CorruptedFile $path 'attachments are NOT in readFilePaths 锟\?added' 'attachments are NOT in readFilePaths - added'
Fix-CorruptedFile $path 'write/edit 锟\?check' 'write/edit - check'
Fix-CorruptedFile $path 'silently 锟\?no' 'silently - no'

# Special fix for line 1133
Fix-CorruptedFile $path 'return isActive \? `\$\{text\}.* : text' '  return isActive ? `${text}...` : text'
