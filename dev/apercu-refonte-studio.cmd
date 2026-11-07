@echo off
rem Apercu de la refonte du Studio dans le navigateur, sur une pile isolee (vrai Core en memoire, donnees fictives).
rem Aucun Twitch, aucun OBS, aucun Core de Production : tout disparait a la fermeture de cette fenetre.
rem Pour le vrai Studio (Electron, profil Lab) : "npm run studio" depuis ce dossier.
cd /d "%~dp0.."
echo Construction de l'interface du Studio...
call npm run build -w @raptoru/schemas >nul || goto :fail
call npm run build -w @raptoru/studio-web >nul || goto :fail
set E2E_CORE_LAB_PORT=4411
set E2E_CORE_LAB_PLAYERS=1
start "" /min cmd /c "timeout /t 10 /nobreak >nul & start http://127.0.0.1:4411/?p=centre"
echo.
echo Apercu sur http://127.0.0.1:4411  (fermer cette fenetre pour tout arreter)
cd apps\studio\server
npx tsx e2e/core-lab-stack.ts
goto :eof
:fail
echo La construction a echoue.
pause
