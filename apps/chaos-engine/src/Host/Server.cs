// Entrées-sorties et chiens de garde de l'hôte. Toute sortie passe par Quit : TerminateProcess, donc Windows détruit
// immédiatement les fenêtres des effets et rétablit l'écran retourné par la couche Entrées (mode temporaire lié au
// processus) : restauration par construction, rien à défaire.
//   - stdin fermé ou parent mort        → sortie ;
//   - aucun message depuis heartbeatMs  → sortie (le client ne répond plus) ;
//   - boucle de rendu figée > 2 s pendant qu'une fenêtre est visible ou qu'un écran est retourné (sinon > 10 s) → sortie ;
//   - gardien (processus séparé) : raccourci d'urgence et arrêt forcé si le moteur est figé (classe Guardian).
// Mémoire partagée avec le gardien ("Local\RaptoruChaos-<pid>", 64 octets) :
//   [0] tick de la dernière boucle (GetTickCount64) · [8] surfaces visibles · [12] arrêt d'urgence demandé ·
//   [16] état du raccourci (0 inconnu, 1 actif, 2 indisponible) · [20] pid du gardien · [24] écrans retournés ·
//   [28] curseur matériel masqué par le moteur (le gardien le rétablit si le moteur meurt ou gèle).
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.Text;
using System.Threading;

namespace Raptoru.Chaos
{
    sealed class Server
    {
        public const int LoopStallVisibleMs = 2000, LoopStallMs = 10000;
        readonly Stopwatch clock;
        readonly int heartbeatMs, parentPid;
        readonly bool guardian;
        readonly object outLock = new object(), quitLock = new object();
        readonly ConcurrentQueue<string> lines = new ConcurrentQueue<string>();
        public readonly AutoResetEvent CommandEvt = new AutoResetEvent(false);
        StreamWriter stdout;
        long lastLine, lastLoop;
        volatile int visible, inputs;
        volatile bool cursorHidden;
        bool quitting;
        MemoryMappedFile mmf;
        MemoryMappedViewAccessor view;
        Process guardianProc;
        long nextGuardianCheck;
        public int GuardianRestarts;
        public Action<string> BeforeQuit;

        public Server(Stopwatch clock, int heartbeatMs, int parentPid, bool guardian)
        {
            this.clock = clock; this.heartbeatMs = heartbeatMs; this.parentPid = parentPid; this.guardian = guardian;
        }

        public static string SharedName(int pid) { return "Local\\RaptoruChaos-" + pid; }

        public void Start()
        {
            stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
            int pid = Process.GetCurrentProcess().Id;
            mmf = MemoryMappedFile.CreateOrOpen(SharedName(pid), 64);
            view = mmf.CreateViewAccessor(0, 64);
            // Le gardien d'abord : le premier battement ne doit pas en lancer un second (deux gardiens se disputaient
            // Ctrl+Maj+F11, et celui qui perdait pouvait afficher « raccourci indisponible »).
            if (guardian) SpawnGuardian();
            Beat(0, 0, false);
            Thread("stdin", ReadStdin);
            Thread("watchdog", Watchdog);
            if (parentPid > 0) Thread("parent", WatchParent);
        }

        static void Thread(string name, ThreadStart f) { new Thread(f) { IsBackground = true, Name = name }.Start(); }

        public void Send(Dictionary<string, object> msg)
        {
            string line = J.Write(msg);
            // Jamais bloquant au-delà de 250 ms : un client qui ne lit plus ne doit pas empêcher l'arrêt.
            if (!Monitor.TryEnter(outLock, 250)) return;
            try { stdout.WriteLine(line); } catch (Exception) { } finally { Monitor.Exit(outLock); }
        }

        public bool TryTake(out string line) { return lines.TryDequeue(out line); }

        /// Battement de la boucle de rendu (chien de garde interne et gardien) : surfaces visibles, écrans retournés,
        /// curseur matériel masqué.
        public void Beat(int visibleSurfaces, int heldInputs, bool cursor)
        {
            Interlocked.Exchange(ref lastLoop, clock.ElapsedMilliseconds);
            visible = visibleSurfaces;
            inputs = heldInputs;
            cursorHidden = cursor;
            view.Write(0, (long)N.GetTickCount64());
            view.Write(8, visibleSurfaces);
            view.Write(24, heldInputs);
            view.Write(28, cursor ? 1 : 0);
            long now = clock.ElapsedMilliseconds;
            if (guardian && now >= nextGuardianCheck)
            {
                nextGuardianCheck = now + 1000;
                if (guardianProc == null || guardianProc.HasExited) { SpawnGuardian(); GuardianRestarts++; }
            }
        }

        public bool TakeEmergencyStop()
        {
            if (view.ReadInt32(12) == 0) return false;
            view.Write(12, 0);
            return true;
        }

        public string HotkeyState
        {
            get { int s = view.ReadInt32(16); return s == 1 ? "active" : s == 2 ? "unavailable" : guardian ? "starting" : "disabled"; }
        }
        public int GuardianPid { get { return guardianProc != null && !guardianProc.HasExited ? guardianProc.Id : 0; } }

        void SpawnGuardian()
        {
            try
            {
                var psi = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "--guardian " + Process.GetCurrentProcess().Id)
                { UseShellExecute = false, CreateNoWindow = true };
                guardianProc = Process.Start(psi);
                view.Write(20, guardianProc.Id);
            }
            catch (Exception) { guardianProc = null; }
        }

        public void Quit(string reason, int code)
        {
            lock (quitLock) { if (quitting) return; quitting = true; }
            try { if (BeforeQuit != null) BeforeQuit(reason); } catch (Exception) { }
            Send(Protocol.Event("engine.exit", clock.ElapsedMilliseconds, J.Map("reason", reason, "code", code)));
            try { if (guardianProc != null && !guardianProc.HasExited) guardianProc.Kill(); } catch (Exception) { }
            N.TerminateProcess(N.GetCurrentProcess(), (uint)code);
        }

        void ReadStdin()
        {
            var r = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            while (true)
            {
                string line;
                try { line = r.ReadLine(); } catch (Exception) { line = null; }
                if (line == null) { Quit("stdin_closed", 0); return; }
                Interlocked.Exchange(ref lastLine, clock.ElapsedMilliseconds);
                line = line.Trim().TrimStart('﻿');
                if (line.Length == 0) continue;
                lines.Enqueue(line);
                CommandEvt.Set();
            }
        }

        void Watchdog()
        {
            while (true)
            {
                System.Threading.Thread.Sleep(50);
                long now = clock.ElapsedMilliseconds;
                if (heartbeatMs > 0 && now - Interlocked.Read(ref lastLine) > heartbeatMs) Quit("heartbeat", 0);
                long gap = now - Interlocked.Read(ref lastLoop);
                if (((visible > 0 || inputs > 0 || cursorHidden) && gap > LoopStallVisibleMs) || gap > LoopStallMs) Quit("render_stall", 3);
            }
        }

        void WatchParent()
        {
            IntPtr h = N.OpenProcess(0x00100000, false, (uint)parentPid);
            if (h == IntPtr.Zero) { Quit("parent_missing", 0); return; }
            N.WaitForSingleObject(h, 0xFFFFFFFF);
            Quit("parent_exit", 0);
        }
    }

    /// Gardien : processus séparé, indépendant du moteur et de Studio.
    ///  - Ctrl+Maj+F11 (partout, même en jeu) : arrêt d'urgence ; si le moteur ne l'a pas exécuté en 700 ms, il est tué ;
    ///  - moteur figé (aucun battement depuis 2,5 s) alors qu'une fenêtre est visible ou qu'un écran est retourné : il
    ///    est tué (Windows retire alors les fenêtres et rétablit l'écran) ;
    ///  - le gardien quitte avec le moteur.
    static class Guardian
    {
        public const uint HotkeyMods = 0x2 | 0x4 | 0x4000, HotkeyVk = 0x7A; // Ctrl+Maj+F11, sans répétition

        public static int Run(int enginePid)
        {
            IntPtr engine = N.OpenProcess(0x00100000 | 0x0001 /* SYNCHRONIZE | TERMINATE */, false, (uint)enginePid);
            if (engine == IntPtr.Zero) return 1;
            MemoryMappedViewAccessor view;
            try { view = MemoryMappedFile.OpenExisting(Server.SharedName(enginePid)).CreateViewAccessor(0, 64); }
            catch (Exception) { return 2; }
            view.Write(16, N.RegisterHotKey(IntPtr.Zero, 1, HotkeyMods, HotkeyVk) ? 1 : 2);
            long stopAt = 0;
            bool cursorSeen = false;
            var handles = new[] { engine };
            while (true)
            {
                uint r = N.MsgWaitForMultipleObjectsEx(1, handles, 100, N.QS_ALLINPUT, N.MWMO_INPUTAVAILABLE);
                // Moteur terminé (fin normale, plantage, tué) : s'il masquait le curseur, il est rétabli ici.
                if (r == 0) { if (cursorSeen || view.ReadInt32(28) != 0) CursorLayer.RestoreSystem(); return 0; }
                MSG m;
                while (N.PeekMessageW(out m, IntPtr.Zero, 0, 0, N.PM_REMOVE))
                    if (m.message == N.WM_HOTKEY) { view.Write(12, 1); stopAt = (long)N.GetTickCount64(); }
                long now = (long)N.GetTickCount64();
                int vis = view.ReadInt32(8), held = view.ReadInt32(24);
                bool cur = view.ReadInt32(28) != 0;
                cursorSeen = cur;
                long beat = view.ReadInt64(0);
                bool onScreen = vis > 0 || held > 0 || cur;
                // Moteur gelé avec le curseur masqué : le curseur d'abord (1,2 s), puis l'arrêt forcé (2,5 s).
                if (cur && now - beat > 1200) CursorLayer.RestoreSystem();
                if (onScreen && now - beat > 2500) { N.TerminateProcess(engine, 9); CursorLayer.RestoreSystem(); return 0; }
                if (stopAt > 0 && !onScreen) stopAt = 0;
                if (stopAt > 0 && now - stopAt > 700) { N.TerminateProcess(engine, 9); CursorLayer.RestoreSystem(); return 0; }
            }
        }
    }
}
