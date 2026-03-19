# Removes Claude Code Pet hooks from ~/.claude/settings.json
# Called by the NSIS uninstaller during app removal on Windows.

$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
if (-not (Test-Path $settingsPath)) { exit 0 }

try {
    $raw      = Get-Content $settingsPath -Raw -Encoding UTF8
    $settings = $raw | ConvertFrom-Json

    if (-not $settings.hooks) { exit 0 }

    $port     = "localhost:7523/event"
    $modified = $false

    $events = @($settings.hooks.PSObject.Properties.Name)
    foreach ($event in $events) {
        $entries = @($settings.hooks.$event)
        $kept    = @($entries | Where-Object {
            $keep = $true
            if ($_.hooks) {
                foreach ($h in @($_.hooks)) {
                    if ($h.command -and ($h.command -like "*$port*")) {
                        $keep     = $false
                        $modified = $true
                        break
                    }
                }
            }
            $keep
        })
        if ($kept.Count -eq 0) {
            $settings.hooks.PSObject.Properties.Remove($event)
        } else {
            $settings.hooks.$event = $kept
        }
    }

    if ($modified) {
        $remaining = @($settings.hooks.PSObject.Properties.Name)
        if ($remaining.Count -eq 0) {
            $settings.PSObject.Properties.Remove('hooks')
        }
        $settings | ConvertTo-Json -Depth 10 | Set-Content $settingsPath -Encoding UTF8
    }
} catch {
    # Silently fail — don't block uninstall
    exit 0
}
exit 0
