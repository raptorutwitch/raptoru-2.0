@echo off
rem Banc mobile Twitch : l extension servie a la vraie application Twitch du telephone (docs/extension/BANC_MOBILE_TWITCH.md).
rem Ctrl+C ou fermer la fenetre arrete tout. Options : --reset (Jetons fictifs remis a zero), --no-tunnel.
cd /d "%~dp0"
node scripts\mobile-lab.mjs %*
pause
