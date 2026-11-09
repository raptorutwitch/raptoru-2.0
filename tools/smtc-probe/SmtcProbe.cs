// Raptoru 2.0 — SMTC probe (docs/music/SMTC_PROBE.md). A standalone Windows diagnostic, Lab only, never part of Studio:
// it listens to Windows' media sessions (GlobalSystemMediaTransportControlsSessionManager) and prints what Spotify
// Desktop says it plays — title, artist, album, cover, play/pause — on each EVENT, with timestamps. It never calls the
// Spotify Web API, never sends a command to the player, never reads the network: Windows' own local metadata only.
// A local check every 5 s (Windows' state, not Spotify's API) counts the changes no event announced ("manqué").
// Built on the spot by Windows' own C# compiler (no SDK, no package): see run.ps1. C# 5 (csc 4.8).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.Media.Control;

static class SmtcProbe
{
    sealed class State
    {
        public string Title = "", Artist = "", Album = "", Status = "", App = "";
        public double PositionMs, EndMs;
        public DateTimeOffset TimelineUpdated;
        public long ThumbBytes = -1;
        public string Key { get { return Title + "\u001f" + Artist + "\u001f" + Album; } }
    }

    /** A WinRT async operation as a Task (Windows' own C# compiler cannot `await` it directly). */
    static Task<T> W<T>(IAsyncOperation<T> op)
    {
        var tcs = new TaskCompletionSource<T>();
        op.Completed = new AsyncOperationCompletedHandler<T>(delegate (IAsyncOperation<T> o, AsyncStatus status)
        {
            if (status == AsyncStatus.Completed) tcs.TrySetResult(o.GetResults());
            else if (status == AsyncStatus.Error) tcs.TrySetException(o.ErrorCode ?? new Exception("WinRT"));
            else tcs.TrySetCanceled();
        });
        return tcs.Task;
    }

    static readonly SemaphoreSlim Gate = new SemaphoreSlim(1, 1);
    static readonly Stopwatch Since = Stopwatch.StartNew();
    static GlobalSystemMediaTransportControlsSessionManager manager;
    static GlobalSystemMediaTransportControlsSession session;
    static State last; // the state as the events told it
    static long lastEventMs = -1, lastTrackMs = -1;
    static int rawMedia, rawPlayback, rawTimeline, rawSessions, tracks, missed, duplicates, sessionsFound, sessionsLost;
    static StreamWriter log;
    /** Raw media + playback events already handled: the local check never judges while one is still on its way. */
    static int handledRaw;

    static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        string logPath = args.Length > 0 ? args[0] : null;
        if (logPath != null)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(logPath)));
            log = new StreamWriter(logPath, false, new UTF8Encoding(false)) { AutoFlush = true };
        }
        Console.CancelKeyPress += delegate (object s, ConsoleCancelEventArgs e) { e.Cancel = true; Summary(); Environment.Exit(0); };
        try { Run().Wait(); }
        catch (Exception e) { Line("ERREUR", (e.InnerException ?? e).Message, null); return 1; }
        return 0;
    }

    static async Task Run()
    {
        Line("DÉPART", "Sonde SMTC : écoute des sessions multimédia Windows (aucun appel à Spotify). Ctrl+C pour le bilan.", null);
        manager = await W(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());

        manager.SessionsChanged += (new TypedEventHandler<GlobalSystemMediaTransportControlsSessionManager, SessionsChangedEventArgs>(
            delegate (GlobalSystemMediaTransportControlsSessionManager m, SessionsChangedEventArgs a)
            {
                Interlocked.Increment(ref rawSessions);
                Fire("sessions");
            }));
        await Rescan("départ");
        // Local check (Windows' state, never Spotify's API): a change that no event announced is counted as missed.
        while (true)
        {
            await Task.Delay(5000);
            await Check();
        }
    }

    static void Fire(string what)
    {
        long at = Since.ElapsedMilliseconds;
        Task.Run(async delegate
        {
            await Gate.WaitAsync();
            try
            {
                if (what == "sessions") await Rescan("événement SessionsChanged");
                else await Report(what, at);
            }
            catch (Exception e) { Line("ERREUR", what + " : " + e.Message, null); }
            finally { Gate.Release(); }
        });
    }

    static bool IsSpotify(GlobalSystemMediaTransportControlsSession s)
    {
        string id = s.SourceAppUserModelId ?? "";
        // Classic installer: "Spotify.exe"; Microsoft Store: "SpotifyAB.SpotifyMusic_…!Spotify". Never a browser tab.
        return id.IndexOf("spotify", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    static async Task Rescan(string why)
    {
        GlobalSystemMediaTransportControlsSession found = null;
        var others = new List<string>();
        foreach (var s in manager.GetSessions())
        {
            if (found == null && IsSpotify(s)) found = s;
            else others.Add(s.SourceAppUserModelId);
        }
        if (found == null)
        {
            if (session != null)
            {
                Interlocked.Increment(ref sessionsLost);
                Line("PERDUE", "La session Spotify a disparu (" + why + ").", null);
            }
            else if (why == "départ") Line("ATTENTE", "Aucune session Spotify pour l'instant (autres : " + (others.Count == 0 ? "aucune" : string.Join(", ", others)) + "). Lance Spotify Desktop.", null);
            session = null;
            last = null;
            return;
        }
        if (ReferenceEquals(found, session)) return;
        session = found;
        Interlocked.Increment(ref sessionsFound);
        found.MediaPropertiesChanged += (new TypedEventHandler<GlobalSystemMediaTransportControlsSession, MediaPropertiesChangedEventArgs>(
            delegate (GlobalSystemMediaTransportControlsSession s, MediaPropertiesChangedEventArgs a)
            {
                if (!ReferenceEquals(s, session)) return;
                Interlocked.Increment(ref rawMedia);
                Fire("media");
            }));
        found.PlaybackInfoChanged += (new TypedEventHandler<GlobalSystemMediaTransportControlsSession, PlaybackInfoChangedEventArgs>(
            delegate (GlobalSystemMediaTransportControlsSession s, PlaybackInfoChangedEventArgs a)
            {
                if (!ReferenceEquals(s, session)) return;
                Interlocked.Increment(ref rawPlayback);
                Fire("playback");
            }));
        found.TimelinePropertiesChanged += (new TypedEventHandler<GlobalSystemMediaTransportControlsSession, TimelinePropertiesChangedEventArgs>(
            delegate (GlobalSystemMediaTransportControlsSession s, TimelinePropertiesChangedEventArgs a)
            {
                if (!ReferenceEquals(s, session)) return;
                Interlocked.Increment(ref rawTimeline);
            }));
        Line("TROUVÉE", "Session Spotify : " + found.SourceAppUserModelId + " (" + why + ")" + (others.Count > 0 ? " · ignorées : " + string.Join(", ", others) : ""), null);
        last = null;
        await Report("start", Since.ElapsedMilliseconds);
    }

    static async Task<State> Read(GlobalSystemMediaTransportControlsSession s, bool thumb)
    {
        var st = new State { App = s.SourceAppUserModelId };
        var p = await W(s.TryGetMediaPropertiesAsync());
        if (p != null)
        {
            st.Title = p.Title ?? "";
            st.Artist = p.Artist ?? "";
            st.Album = p.AlbumTitle ?? "";
            if (thumb && p.Thumbnail != null)
            {
                try
                {
                    var stream = await W(p.Thumbnail.OpenReadAsync());
                    st.ThumbBytes = (long)stream.Size;
                    var closable = stream as IDisposable;
                    if (closable != null) closable.Dispose();
                }
                catch { st.ThumbBytes = -2; }
            }
        }
        var info = s.GetPlaybackInfo();
        st.Status = info != null ? info.PlaybackStatus.ToString() : "?";
        var tl = s.GetTimelineProperties();
        if (tl != null)
        {
            st.TimelineUpdated = tl.LastUpdatedTime;
            st.EndMs = tl.EndTime.TotalMilliseconds;
            double pos = tl.Position.TotalMilliseconds;
            // « Position as of LastUpdatedTime »: extrapolated while playing.
            if (st.Status == "Playing" && tl.LastUpdatedTime.Year > 2000)
                pos += Math.Max(0, (DateTimeOffset.Now - tl.LastUpdatedTime).TotalMilliseconds);
            st.PositionMs = pos;
        }
        return st;
    }

    static async Task Report(string what, long firedAt)
    {
        var s = session;
        if (s == null) return;
        var now = Since.ElapsedMilliseconds;
        handledRaw = Volatile.Read(ref rawMedia) + Volatile.Read(ref rawPlayback);
        var st = await Read(s, what != "playback");
        var prev = last;
        string kind;
        if (st.Title.Length == 0) kind = "TRANSITION";
        else if (prev == null || prev.Key != st.Key) kind = what == "start" ? "EN COURS" : "PISTE";
        else if (prev.PositionMs > 10000 && st.PositionMs < 3000) kind = "REJOUÉ";
        else if (prev.Status != st.Status) kind = st.Status == "Playing" ? "LECTURE" : st.Status == "Paused" ? "PAUSE" : st.Status.ToUpperInvariant();
        else { duplicates++; kind = "DOUBLON"; }
        if (kind == "PISTE" || kind == "REJOUÉ") { tracks++; lastTrackMs = now; }
        if (kind != "TRANSITION") last = st;
        lastEventMs = now;
        var extra = new StringBuilder();
        extra.AppendFormat(CultureInfo.InvariantCulture, "reçu +{0} ms après l'événement", now - firedAt);
        if (st.TimelineUpdated.Year > 2000)
        {
            var age = (DateTimeOffset.Now - st.TimelineUpdated).TotalMilliseconds;
            if (age >= 0 && age < 15000) extra.AppendFormat(CultureInfo.InvariantCulture, " · Spotify a mis à jour sa position il y a {0:0} ms", age);
        }
        Line(kind, Describe(st), extra.ToString(), st, what);
    }

    static async Task Check()
    {
        await Gate.WaitAsync();
        try
        {
            if (session == null)
            {
                // No event said Spotify came back? Look once (local).
                foreach (var s in manager.GetSessions())
                    if (IsSpotify(s)) { Interlocked.Increment(ref missed); Line("MANQUÉ", "Spotify est là mais aucun événement ne l'a annoncé.", null); await Rescan("contrôle local"); break; }
                return;
            }
            // An event arrived but is not handled yet: it will tell the change itself (never a false « manqué »).
            if (Volatile.Read(ref rawMedia) + Volatile.Read(ref rawPlayback) != handledRaw) return;
            var st = await Read(session, false);
            if (last == null || st.Title.Length == 0) return;
            bool changed = st.Key != last.Key || st.Status != last.Status || (last.PositionMs > 10000 && st.PositionMs < 3000);
            if (changed)
            {
                Interlocked.Increment(ref missed);
                Line("MANQUÉ", "Changement vu au contrôle local sans événement : " + Describe(st), null, st, "check");
                last = st;
            }
            else last.PositionMs = st.PositionMs;
        }
        catch (Exception e) { Line("ERREUR", "contrôle : " + e.Message, null); }
        finally { Gate.Release(); }
    }

    static string Describe(State st)
    {
        string status = st.Status == "Playing" ? "lecture" : st.Status == "Paused" ? "pause" : st.Status;
        string thumb = st.ThumbBytes >= 0 ? string.Format(CultureInfo.InvariantCulture, " · pochette {0:0.0} Ko", st.ThumbBytes / 1024.0) : st.ThumbBytes == -2 ? " · pochette illisible" : "";
        return string.Format(CultureInfo.InvariantCulture, "« {0} » — {1}{2} [{3}, {4}/{5}]{6}",
            st.Title, st.Artist, st.Album.Length > 0 ? " (" + st.Album + ")" : "", status, Clock(st.PositionMs), Clock(st.EndMs), thumb);
    }

    static string Clock(double ms)
    {
        if (ms <= 0) return "0:00";
        var t = TimeSpan.FromMilliseconds(ms);
        return string.Format(CultureInfo.InvariantCulture, "{0}:{1:00}", (int)t.TotalMinutes, t.Seconds);
    }

    static void Line(string kind, string text, string extra) { Line(kind, text, extra, null, null); }

    static readonly object Out = new object();
    static void Line(string kind, string text, string extra, State st, string source)
    {
        var at = DateTimeOffset.Now;
        string human = string.Format(CultureInfo.InvariantCulture, "{0:HH:mm:ss.fff}  {1,-10} {2}{3}", at, kind, text, string.IsNullOrEmpty(extra) ? "" : "  · " + extra);
        lock (Out)
        {
            Console.WriteLine(human);
            if (log != null)
            {
                var j = new StringBuilder("{");
                j.Append("\"at\":").Append(Q(at.ToString("o", CultureInfo.InvariantCulture)));
                j.Append(",\"kind\":").Append(Q(kind)).Append(",\"text\":").Append(Q(text));
                if (source != null) j.Append(",\"source\":").Append(Q(source));
                if (st != null)
                {
                    j.Append(",\"app\":").Append(Q(st.App)).Append(",\"title\":").Append(Q(st.Title)).Append(",\"artist\":").Append(Q(st.Artist));
                    j.Append(",\"album\":").Append(Q(st.Album)).Append(",\"status\":").Append(Q(st.Status));
                    j.AppendFormat(CultureInfo.InvariantCulture, ",\"position_ms\":{0:0},\"end_ms\":{1:0},\"thumb_bytes\":{2}", st.PositionMs, st.EndMs, st.ThumbBytes);
                }
                if (!string.IsNullOrEmpty(extra)) j.Append(",\"extra\":").Append(Q(extra));
                j.Append("}");
                log.WriteLine(j.ToString());
            }
        }
    }

    static string Q(string s)
    {
        var b = new StringBuilder("\"");
        foreach (char c in s ?? "")
        {
            if (c == '"' || c == '\\') b.Append('\\').Append(c);
            else if (c < ' ') b.AppendFormat(CultureInfo.InvariantCulture, "\\u{0:x4}", (int)c);
            else b.Append(c);
        }
        return b.Append('"').ToString();
    }

    static void Summary()
    {
        Line("BILAN", string.Format(CultureInfo.InvariantCulture,
            "{0:0} s d'écoute · {1} changements de piste · {2} événements média, {3} lecture/pause, {4} position, {5} sessions · {6} doublons ignorés · {7} MANQUÉS · session trouvée {8} fois, perdue {9} fois",
            Since.Elapsed.TotalSeconds, tracks, rawMedia, rawPlayback, rawTimeline, rawSessions, duplicates, missed, sessionsFound, sessionsLost), null);
        if (log != null) log.Flush();
    }
}
