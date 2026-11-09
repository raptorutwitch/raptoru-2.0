@echo off
rem Music Hub (docs/music/SPOTIFY_REEL_LAB.md) - le Lab de CE worktree, mais la musique sur TON compte Spotify.
rem Le Lab reste fictif (chaine, viewers, Jetons) ; seule la musique est reelle. LECTURE SEULE par defaut :
rem recherches et lecture de ce qui joue, AUCUN ajout a ta file ni commande du lecteur tant que tu ne l'autorises pas
rem dans Studio (Musique > "Autoriser les ajouts pour cette session", coupe a chaque demarrage).
rem Avant : ferme Raptoru Studio (installe), demarre Docker Desktop. Fermer cette fenetre arrete le Lab.
cd /d "%~dp0"
echo.
echo  Music Hub - Lab sur TON compte Spotify (lecture seule par defaut)
echo  -----------------------------------------------------------------
echo   - Fais ce test HORS LIVE : le quota Spotify est celui de ton compte developpeur.
echo   - Dans Studio, page Musique : connecte Spotify (Client ID de ton application Spotify).
echo   - Puis cherche un titre dans l'extension : les resultats viennent de Spotify.
echo   - Rien n'est ajoute a ta file tant que tu n'as pas clique "Autoriser les ajouts pour cette session".
echo   - Musique en cours : Studio ecoute aussi Windows (Spotify Desktop ouvert), sans appel a Spotify.
echo     Pour l'historique "Musiques du stream" : Studio ^> Simulation ^> demarrer un live simule.
echo.
choice /c ON /m "Continuer avec ton compte Spotify reel (O = oui, N = non)"
if errorlevel 2 exit /b 0
set LAB_SPOTIFY=real
start "Music Hub - pages" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\music-hub-lab-open.ps1" -Real
call npm run studio:lab
if errorlevel 1 pause
