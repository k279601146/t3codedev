$path = 'D:\workkaifa\t3codedev\packages\ccb-ink\src\keybindings\parser.ts'
$content = Get-Content $path -Raw

# Replace corrupted arrow keys
$content = $content -replace "case '鈫\?:", "case 'up':"
$content = $content -replace "case '鈫\?:", "case 'down':"
$content = $content -replace "case '鈫\?:", "case 'left':"
$content = $content -replace "case '鈫\?:", "case 'right':"

# The above case statements are actually redundant since they are followed by 'up', 'down', etc.
# Wait, looking at the code:
# 56:       case '鈫?:
# 57:         keystroke.key = 'up'
# 58:         break

# I should probably use the actual arrow characters if they are supported, or just fix the corruption.
# I'll use strings like 'arrowup' if I can't use symbols, but 'up' is already there.

# Actually, I'll just remove the corrupted cases if they are duplicates, or fix them to actual arrows.
# But since the next lines set it to 'up', 'down', etc., I'll just use the arrow symbols.

$content = $content -replace "case '鈫\?:", "case 'up':"
$content = $content -replace "return '鈫\?", "return '↑" # Up
# Wait, I don't know which one is which.

# I'll just use the line numbers to be sure.
$lines = Get-Content $path
$lines[55] = "      case 'up':"
$lines[58] = "      case 'down':"
$lines[61] = "      case 'left':"
$lines[64] = "      case 'right':"
$lines[119] = "      return '↑'"
$lines[121] = "      return '↓'"
$lines[123] = "      return '←'"
$lines[125] = "      return '→'"

$lines | Set-Content $path -Encoding utf8
