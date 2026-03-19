; Claude Code Pet — custom NSIS macros
; electron-builder includes this via nsis.include in package.json

!macro customInstall
  ; Hook installation is handled by the app on first launch.
  ; Nothing extra needed here.
!macroend

!macro customUnInstall
  ; Remove Claude Code hooks from ~/.claude/settings.json on uninstall
  DetailPrint "Removing Claude Code hooks..."
  ExecWait 'powershell -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\resources\uninstall-hooks.ps1"'
!macroend
