@echo off
rem Raptoru 2.0 - sonde SMTC (docs/music/SMTC_PROBE.md) : ecoute ce que Windows sait de la musique de Spotify Desktop.
rem Lecture seule : aucune commande au lecteur, aucun appel a Spotify, rien dans Studio ni en Production.
rem Fais les manipulations de la fiche, puis Ctrl+C pour le bilan. Journal : .lab-data\smtc-probe\smtc-<date>.jsonl
cd /d "%~dp0"
echo.
echo  Sonde SMTC - detection locale de la musique Spotify (lecture seule)
echo  -------------------------------------------------------------------
echo   Fais dans Spotify : lecture, titre suivant, un autre morceau au choix, pause / reprise,
echo   un changement depuis ton telephone (Spotify toujours lu sur le PC), puis ferme et rouvre Spotify.
echo   Ctrl+C quand tu as fini : la sonde affiche son bilan (dont les changements MANQUES).
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\smtc-probe\run.ps1"
pause
