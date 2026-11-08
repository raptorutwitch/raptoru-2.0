# Music Hub (docs/music/MUSIC_HUB_STATE.md) - called by « Ouvrir Music Hub (Lab).cmd » while `npm run studio:lab` starts.
# Waits for the Lab's Studio, opens the music in the LAB only (requests open, the extension's entry, the player's
# controls), then the extension as a viewer, a moderator and a supermod. Never Production: the Lab's own address only.
param(
  [string]$Base = 'http://127.0.0.1:4100',
  [int]$WaitSeconds = 480,
  [switch]$DryRun
)
$headers = @{ 'x-raptoru-studio' = '1' }
$ready = $false
$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
  try {
    $state = Invoke-RestMethod "$Base/api/spotify/state" -Headers $headers -TimeoutSec 3
    $ready = $true
    break
  } catch {
    Start-Sleep -Seconds 2
  }
}
if (-not $ready) {
  Write-Output "Le Lab n'a pas repondu sur $Base : pages non ouvertes."
  exit 1
}
if ($state.environment -ne 'lab') {
  # Never touch anything else than the Lab (an installed Studio answering on this port is Production).
  Write-Output "Ce Studio n'est pas le Lab ($($state.environment)) : rien n'est change."
  exit 1
}
try {
  Invoke-RestMethod "$Base/api/spotify/settings" -Method Post -Headers $headers -ContentType 'application/json' `
    -Body '{"enabled":true,"extension_enabled":true,"player_controls":true}' | Out-Null
} catch {
  Write-Output "Reglages musique du Lab non appliques : $($_.Exception.Message)"
}
foreach ($role in 'viewer', 'moderator', 'supermod') {
  $url = "$Base/ext/mobile.html?shell=v2&labRole=$role"
  if ($DryRun) { Write-Output "OPEN $url" } else { Start-Process $url }
  Start-Sleep -Milliseconds 600
}
