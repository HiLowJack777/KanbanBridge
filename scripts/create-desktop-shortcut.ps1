$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$candidatePaths = @(
  (Join-Path $repoRoot "desktop-release\win-unpacked\KanbanBridge.exe"),
  (Join-Path $repoRoot "desktop-release\win-x64-unpacked\KanbanBridge.exe"),
  (Join-Path $repoRoot "release\win-unpacked\KanbanBridge.exe"),
  (Join-Path $repoRoot "release\win-x64-unpacked\KanbanBridge.exe"),
  (Join-Path $repoRoot "desktop-release\win-unpacked\Project Board.exe"),
  (Join-Path $repoRoot "desktop-release\win-x64-unpacked\Project Board.exe"),
  (Join-Path $repoRoot "release\win-unpacked\Project Board.exe"),
  (Join-Path $repoRoot "release\win-x64-unpacked\Project Board.exe")
)

$targetPath = $candidatePaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $targetPath) {
  throw "Packaged app not found. Run 'pnpm package:dir' first."
}

$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "KanbanBridge.lnk"
$workingDirectory = Split-Path -Parent $targetPath
$iconPath = Join-Path $repoRoot "build\icon.ico"

if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $workingDirectory
$shortcut.IconLocation = if (Test-Path -LiteralPath $iconPath) { $iconPath } else { "$targetPath,0" }
$shortcut.Description = "Open KanbanBridge"
$shortcut.Save()

Write-Host "Created desktop shortcut: $shortcutPath"
