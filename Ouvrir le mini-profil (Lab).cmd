@echo off
rem Mini-profil viewer (MAQUETTE, branche design/mini-profil) - ouvre la vitrine du Lab de CE worktree en un double-clic.
rem Lab leger : le Core du Lab en memoire + Studio devant, viewers et Jetons fictifs. Pas de Docker, pas besoin de
rem fermer Raptoru Studio. Rien en Production : pas de Twitch, pas de vrais Jetons. Fermer cette fenetre arrete le Lab.
cd /d "%~dp0apps\studio\server"
set PAGE=http://127.0.0.1:4499/ext/lab-modules/mini-profil.html
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4499/ext/panel.html -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  echo Le Lab du mini-profil tourne deja : ouverture de la vitrine.
  start "" "%PAGE%"
  exit /b 0
)
echo Mini-profil - Lab local (donnees fictives). Demarrage, patiente quelques secondes...
start "" /min powershell -NoProfile -Command "for ($i = 0; $i -lt 120; $i++) { try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4499/ext/panel.html -TimeoutSec 2 | Out-Null; Start-Process '%PAGE%'; break } catch { Start-Sleep 1 } }"
set E2E_CORE_LAB_PORT=4499
set E2E_CORE_LAB_PLAYERS=1
call npx tsx e2e/core-lab-stack.ts
if errorlevel 1 pause
