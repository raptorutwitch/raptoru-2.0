@echo off
rem Moteur Chaos : compile avec le C# fourni par Windows (.NET Framework 4.8), rien a installer.
rem   bin\ChaosEngine.exe  moteur (--serve), gardien (--guardian), mire (--test-target), apercu (--render-preview)
rem   bin\chaos-unit.exe   tests unitaires de la logique pure (registre, parametres, transitions, config, ordonnanceur, protocole)
rem   bin\chaos-checks.exe controles d'integration (processus, ecran, arrets, mesures ; garde de jeu)
rem   bin\chaos-bench.exe  banc de performances (jeu temoin, PresentMon facultatif) ; --obs-compat : methodes de capture dOBS
rem Le registre des effets (source unique) est embarque : packages\schemas\src\chaos-registry.json
rem Usage : build.cmd [unit]   (unit = seulement les tests unitaires)
setlocal
set FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319
set WM=%WINDIR%\System32\WinMetadata
set HERE=%~dp0
set OUT=%HERE%bin
rem CHAOS_OUT : autre dossier de sortie (compiler pendant qu'un banc utilise bin\ChaosEngine.exe)
if defined CHAOS_OUT set OUT=%CHAOS_OUT%
set REG=%HERE%..\..\packages\schemas\src\chaos-registry.json
if not exist "%OUT%" mkdir "%OUT%"
set CSC="%FW%\csc.exe" /nologo /platform:x64 /optimize+ /warn:4
set WINRT=/r:"%WM%\Windows.Foundation.winmd" /r:"%WM%\Windows.Graphics.winmd" /r:"%WM%\Windows.Security.winmd" /r:"%FW%\System.Runtime.dll" /r:"%FW%\System.Runtime.WindowsRuntime.dll" /r:"%FW%\System.Runtime.InteropServices.WindowsRuntime.dll"
set NET=/r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll
set RES=/resource:"%REG%",chaos-registry.json

%CSC% /target:exe /out:"%OUT%\chaos-unit.exe" %NET% %RES% /recurse:"%HERE%src\Model\*.cs" "%HERE%src\Interop\Json.cs" "%HERE%tests\BenchStats.cs" "%HERE%tests\UnitTests.cs" "%HERE%tests\UnitMain.cs" || exit /b 1
if /i "%1"=="unit" goto done
%CSC% /target:winexe /out:"%OUT%\ChaosEngine.exe" %WINRT% %NET% %RES% /recurse:"%HERE%src\*.cs" || exit /b 1
%CSC% /target:exe /out:"%OUT%\chaos-checks.exe" %NET% "%HERE%tests\Checks.cs" "%HERE%src\Interop\Native.cs" "%HERE%src\Interop\Json.cs" || exit /b 1
rem banc de comparaison des methodes (visible : jamais lance automatiquement, garde de jeu)
%CSC% /target:exe /out:"%OUT%\chaos-bench.exe" /main:Raptoru.Chaos.Bench %WINRT% %NET% %RES% /recurse:"%HERE%src\*.cs" "%HERE%tests\Checks.cs" "%HERE%tests\Bench.cs" "%HERE%tests\BenchStats.cs" "%HERE%tests\CaptureCompat.cs" || exit /b 1
:done
echo OK : %OUT%
