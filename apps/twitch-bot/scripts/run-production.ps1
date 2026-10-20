# Production bot on the streaming PC (docs/CUTOVER_PLAN_2026-10.md). Runs dist/index.js with .env.production
# (git-ignored; same token files as today, shared with any other bot process through their lock) and restarts it after
# a crash (5 s, 10 s, 30 s, then 60 s). Stops for good on exit 0 (TWITCH_ENABLED=false) and 78 (configuration error):
# restarting would not fix those. One line per start / stop in logs\production-bot.log.
#   powershell -ExecutionPolicy Bypass -File apps\twitch-bot\scripts\run-production.ps1
# .env.production (values never committed):
#   TWITCH_ENABLED=true  CORE_API_URL=https://<main Core>  BOT_SECRET=<the main Core's>
#   TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET / TWITCH_BROADCASTER_ID=83603689
#   PRESENCE_SHADOW, LOYALTY_TWITCH_EVENTS, CHAT_GAMES, ALERTS_MODE=active, ALERTS_FOLLOW,
#   DAILY_CHAT_COMMANDS, LOYALTY_CHAT_COMMANDS, CHAT_GAMES_OUTPUT, CHANNEL_POINTS_EVENTS, RANDOM_BAN (each true / false)
$ErrorActionPreference = 'Stop'
$bot = Split-Path -Parent $PSScriptRoot
Set-Location $bot
if (-not (Test-Path '.env.production')) { throw '.env.production missing in apps\twitch-bot' }
if (-not (Test-Path 'dist\index.js')) { throw 'dist\index.js missing: npm run build -w @raptoru/twitch-bot' }
New-Item -ItemType Directory -Force logs | Out-Null
$log = Join-Path $bot 'logs\production-bot.log'
$delays = @(5, 10, 30)
$crashes = 0
while ($true) {
  $started = Get-Date
  Add-Content $log "$($started.ToString('s')) start"
  & node --env-file=.env.production dist/index.js
  $code = $LASTEXITCODE
  Add-Content $log "$((Get-Date).ToString('s')) exit $code"
  if ($code -eq 0 -or $code -eq 78) { break }
  # A run longer than 10 minutes was healthy: start the backoff again.
  if (((Get-Date) - $started).TotalMinutes -gt 10) { $crashes = 0 }
  $wait = if ($crashes -lt $delays.Count) { $delays[$crashes] } else { 60 }
  $crashes++
  Start-Sleep -Seconds $wait
}
