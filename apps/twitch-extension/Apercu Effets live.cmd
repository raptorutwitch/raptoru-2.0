@echo off
rem Apercu de la maquette " Effets live " (Chaos V2 + Bonk) : l extension en mode demo, dans ses vraies tailles,
rem cote a cote. Donnees fictives locales : aucun appel au Core, a Twitch, au Studio installe ni a l extension publiee.
rem Fermer cette fenetre arrete tout.
cd /d "%~dp0"
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start "" http://127.0.0.1:4471/demo-v2/lab-modules/effets/apercu.html"
node test\responsive\server.mjs
if errorlevel 1 pause
