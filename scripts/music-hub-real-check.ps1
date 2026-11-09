# Music Hub (docs/music/SPOTIFY_REEL_LAB.md) - READ-ONLY check of the real Spotify catalogue through the Lab's Studio
# (LAB_SPOTIFY=real, Spotify connected): a few searches, what each result carries (id, title, artists, album, ISRC,
# duration), written to .lab-data/spotify-real-check-<date>.json. Nothing is requested, queued or played; no token is
# read or written (Studio answers with track metadata only).
#   powershell -File scripts\music-hub-real-check.ps1 -Queries "numb linkin park","daft punk one more time"
param(
  [string]$Base = 'http://127.0.0.1:4100',
  [string[]]$Queries = @('numb linkin park', 'one more time daft punk', 'bohemian rhapsody')
)
$headers = @{ 'x-raptoru-studio' = '1' }
try {
  $state = Invoke-RestMethod "$Base/api/spotify/state" -Headers $headers -TimeoutSec 5
} catch {
  Write-Output "Le Lab ne repond pas sur $Base."
  exit 1
}
if ($state.environment -ne 'lab' -or $state.connection.mode -ne 'lab_real') {
  Write-Output "Ce n'est pas le Lab sur le compte reel (environnement $($state.environment), mode $($state.connection.mode)) : rien n'est fait."
  exit 1
}
if ($state.connection.auth -ne 'ok') {
  Write-Output "Spotify n'est pas connecte dans Studio (page Musique) : connecte-le d'abord."
  exit 1
}
$results = @()
foreach ($q in $Queries) {
  try {
    $r = Invoke-RestMethod "$Base/api/spotify/diagnostic/search" -Method Post -Headers $headers `
      -ContentType 'application/json' -Body (@{ q = $q } | ConvertTo-Json)
    $results += $r
    Write-Output ("{0} : {1} resultats, ISRC sur {2}" -f $q, $r.count, $r.fields.isrc)
    foreach ($i in $r.items | Select-Object -First 5) {
      Write-Output ("   {0} - {1} ({2}, {3}) id {4} ISRC {5}" -f $i.name, ($i.artists -join ', '), $i.album.name, $i.album.type, $i.id, $i.isrc)
    }
  } catch {
    Write-Output "$q : echec ($($_.Exception.Message))"
  }
}
$dir = Join-Path $PSScriptRoot '..\.lab-data'
New-Item -ItemType Directory -Force $dir | Out-Null
$file = Join-Path $dir ("spotify-real-check-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmm'))
@{ at = (Get-Date).ToString('o'); calls = $state.api.calls_last_minute; results = $results } |
  ConvertTo-Json -Depth 8 | Out-File -Encoding utf8 $file
Write-Output "Consigne : $file (aucun secret)."
