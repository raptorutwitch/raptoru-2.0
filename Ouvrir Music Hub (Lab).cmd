@echo off
rem Music Hub (docs/music/MUSIC_HUB_STATE.md) - ouvre le Lab de CE worktree en un double-clic.
rem Le Lab : Studio Lab + Core Lab locaux, chaine et viewers fictifs, catalogue musical fictif, Jetons du Lab.
rem Rien en Production : pas de Twitch, pas de Spotify reel, pas de vrais Jetons.
rem Avant : ferme Raptoru Studio (installe) et demarre Docker Desktop. Fermer cette fenetre arrete le Lab.
cd /d "%~dp0"
echo Music Hub - Lab local (donnees fictives). Demarrage, patiente une a deux minutes...
rem Une fois le Lab pret : la musique ouverte dans le Lab, puis l'extension en viewer, moderateur et supermod.
start "Music Hub - pages" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\music-hub-lab-open.ps1"
call npm run studio:lab
if errorlevel 1 pause
