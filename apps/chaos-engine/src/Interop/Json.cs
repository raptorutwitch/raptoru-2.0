// Lecture typée des objets JSON (JavaScriptSerializer rend Dictionary<string, object>, ArrayList, int, decimal, bool…).
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Web.Script.Serialization;

namespace Raptoru.Chaos
{
    static class J
    {
        static readonly JavaScriptSerializer serializer = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        public static Dictionary<string, object> Parse(string text)
        {
            var d = serializer.DeserializeObject(text) as Dictionary<string, object>;
            if (d == null) throw new FormatException("objet JSON attendu");
            return d;
        }
        public static string Write(object o) { return serializer.Serialize(o); }

        public static bool Has(Dictionary<string, object> d, string k) { return d != null && d.ContainsKey(k) && d[k] != null; }
        public static string Str(Dictionary<string, object> d, string k, string def)
        {
            return Has(d, k) ? Convert.ToString(d[k], Inv) : def;
        }
        public static double Num(Dictionary<string, object> d, string k, double def)
        {
            if (!Has(d, k)) return def;
            double v;
            return IsNumber(d[k], out v) ? v : def;
        }
        public static bool IsNumber(object o, out double v)
        {
            v = 0;
            if (o is string || o is bool || o == null) return false;
            try { v = Convert.ToDouble(o, Inv); return !double.IsNaN(v) && !double.IsInfinity(v); } catch (Exception) { return false; }
        }
        public static bool Bool(Dictionary<string, object> d, string k, bool def) { return Has(d, k) && d[k] is bool ? (bool)d[k] : def; }
        public static Dictionary<string, object> Obj(Dictionary<string, object> d, string k)
        {
            return Has(d, k) ? d[k] as Dictionary<string, object> : null;
        }
        public static List<object> Arr(Dictionary<string, object> d, string k)
        {
            if (!Has(d, k)) return new List<object>();
            var a = d[k] as IEnumerable;
            return a == null || d[k] is string ? new List<object>() : a.Cast<object>().ToList();
        }
        public static List<string> Strs(Dictionary<string, object> d, string k)
        {
            return Arr(d, k).Select(x => Convert.ToString(x, Inv)).ToList();
        }
        public static Dictionary<string, object> Map(params object[] kv)
        {
            var d = new Dictionary<string, object>();
            for (int i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
            return d;
        }
        public static Dictionary<string, object> Copy(Dictionary<string, object> d)
        {
            return d == null ? new Dictionary<string, object>() : new Dictionary<string, object>(d);
        }
    }
}
