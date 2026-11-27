@echo off
rem Apercu de la maquette " Interactions " (Chaos V2, Bonk, Regie) : l extension en mode demo, dans ses vraies
rem tailles, cote a cote. Donnees fictives locales : aucun appel au Core, a Twitch, au Studio installe ni a
rem l extension publiee. Fermer cette fenetre arrete tout.
cd /d "%~dp0"
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start "" http://127.0.0.1:4471/demo-v2/lab-modules/interactions/apercu.html"
node test\responsive\server.mjs
if errorlevel 1 pause
