@echo off
rem Compile le prototype Chaos avec le compilateur C# fourni par Windows (.NET Framework 4.8) : rien a installer.
rem Sortie : bin\ChaosPresenter.exe (panneau + lecteur) et bin\chaos-checks.exe (controles automatiques).
setlocal
set FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319
set WM=%WINDIR%\System32\WinMetadata
set OUT=%~dp0bin
if not exist "%OUT%" mkdir "%OUT%"
set REFS=/r:"%WM%\Windows.Foundation.winmd" /r:"%WM%\Windows.Graphics.winmd" /r:"%WM%\Windows.Security.winmd" /r:"%FW%\System.Runtime.dll" /r:"%FW%\System.Runtime.WindowsRuntime.dll" /r:"%FW%\System.Runtime.InteropServices.WindowsRuntime.dll" /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll
"%FW%\csc.exe" /nologo /platform:x64 /optimize+ /warn:4 /target:winexe /out:"%OUT%\ChaosPresenter.exe" %REFS% "%~dp0src\*.cs" || exit /b 1
"%FW%\csc.exe" /nologo /platform:x64 /optimize+ /warn:4 /target:exe /out:"%OUT%\chaos-checks.exe" %REFS% "%~dp0tests\Checks.cs" "%~dp0src\Native.cs" || exit /b 1
echo OK : %OUT%\ChaosPresenter.exe
