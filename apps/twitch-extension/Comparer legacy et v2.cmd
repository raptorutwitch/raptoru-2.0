@echo off
rem Compare les deux interfaces de l extension (legacy et v2) cote a cote, avec des donnees fictives locales.
rem Aucun appel au Core, a Twitch, au Studio installe ni a l extension publiee. Fermer cette fenetre arrete tout.
cd /d "%~dp0"
node test\responsive\compare-shells.mjs
if errorlevel 1 pause
