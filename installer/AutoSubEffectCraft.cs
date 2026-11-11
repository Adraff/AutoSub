// AutoSub para EffectCraft: puente local entre el panel de AutoSub y EffectCraft.
//
// EffectCraft no tiene paneles HTML como After Effects, pero se puede controlar desde fuera por su
// "canal de control" (TCP en 127.0.0.1, una linea JSON por mensaje). Este programa:
//   1. Sirve los archivos del panel en http://127.0.0.1:<puerto aleatorio>/ (solo en este equipo).
//   2. Abre el panel en una ventana propia (Microsoft Edge en modo aplicacion, incluido en Windows).
//   3. Expone una pequena API protegida con un token aleatorio: archivos, HTTPS hacia Google Gemini,
//      cifrado DPAPI de la API key, dialogo "Guardar como" y el puente hacia EffectCraft.
//   4. Si EffectCraft no esta abierto, lo abre con el canal de control activado.
// Se cierra solo cuando se cierra la ventana del panel.
//
// Se compila con el csc.exe de .NET Framework 4 (incluido en Windows). Sin dependencias externas.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("AutoSub para EffectCraft")]
[assembly: AssemblyProduct("AutoSub")]
[assembly: AssemblyVersion("1.4.0.0")]
[assembly: AssemblyFileVersion("1.4.0.0")]

namespace AutoSubEffectCraft
{
    static class Program
    {
        const int EcPort = 9877;
        static readonly byte[] Entropy = Encoding.UTF8.GetBytes("AutoSub-AE-v1");
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 256 };

        static string webRoot;
        static string token;
        static int port;
        static DateTime lastPing = DateTime.MinValue;
        static readonly object ecLock = new object();
        static TcpClient ecClient;
        static StreamReader ecReader;
        static StreamWriter ecWriter;
        static int ecId;

        [STAThread]
        static int Main(string[] args)
        {
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            webRoot = Path.Combine(baseDir, "web");
            if (!File.Exists(Path.Combine(webRoot, "index.html")))
            {
                MessageBox.Show("No se encuentran los archivos del panel (carpeta web). Reinstala AutoSub.", "AutoSub");
                return 1;
            }

            bool created;
            using (var mutex = new Mutex(true, "AutoSub-EffectCraft-Bridge", out created))
            {
                string stateFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AutoSub", "effectcraft-bridge.txt");
                if (!created)
                {
                    // Ya hay un puente abierto: solo se vuelve a mostrar la ventana del panel
                    try { OpenWindow(File.ReadAllText(stateFile).Trim()); } catch { }
                    return 0;
                }

                token = RandomHex(24);
                port = FreePort();
                var listener = new HttpListener();
                listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
                listener.Start();
                string url = "http://127.0.0.1:" + port + "/index.html#token=" + token;
                Directory.CreateDirectory(Path.GetDirectoryName(stateFile));
                File.WriteAllText(stateFile, url);

                EnsureEffectCraft(false);
                OpenWindow(url);

                var t = new Thread(delegate () { Serve(listener); });
                t.IsBackground = true;
                t.Start();

                // Se cierra cuando el panel deja de dar senales de vida
                DateTime started = DateTime.Now;
                while (true)
                {
                    Thread.Sleep(2000);
                    if (lastPing == DateTime.MinValue && (DateTime.Now - started).TotalMinutes > 2) break;
                    if (lastPing != DateTime.MinValue && (DateTime.Now - lastPing).TotalSeconds > 25) break;
                }
                try { listener.Stop(); } catch { }
                try { File.Delete(stateFile); } catch { }
            }
            return 0;
        }

        static string RandomHex(int bytes)
        {
            var b = new byte[bytes];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            var sb = new StringBuilder();
            foreach (byte x in b) sb.Append(x.ToString("x2"));
            return sb.ToString();
        }

        static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int p = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return p;
        }

        // ------------------------------------------------------------ ventana del panel
        static void OpenWindow(string url)
        {
            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AutoSub", "effectcraft-window");
            string[] edges = {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe")
            };
            foreach (string e in edges)
            {
                if (!File.Exists(e)) continue;
                Process.Start(e, "--app=\"" + url + "\" --window-size=400,820 --user-data-dir=\"" + profile + "\" --no-first-run");
                return;
            }
            Process.Start(url);
        }

        // ------------------------------------------------------------ EffectCraft
        static string FindEffectCraft()
        {
            string[] keys = { @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" };
            foreach (RegistryKey root in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                foreach (string k in keys)
                {
                    using (RegistryKey u = root.OpenSubKey(k))
                    {
                        if (u == null) continue;
                        foreach (string sub in u.GetSubKeyNames())
                        {
                            using (RegistryKey app = u.OpenSubKey(sub))
                            {
                                string name = app == null ? null : app.GetValue("DisplayName") as string;
                                if (name == null || name.IndexOf("EffectCraft", StringComparison.OrdinalIgnoreCase) < 0) continue;
                                string loc = app.GetValue("InstallLocation") as string;
                                if (!string.IsNullOrEmpty(loc) && File.Exists(Path.Combine(loc, "effectcraft.exe"))) return Path.Combine(loc, "effectcraft.exe");
                            }
                        }
                    }
                }
            }
            string[] guesses = {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"ArtCraft\EffectCraft\effectcraft.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"EffectCraft\effectcraft.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\EffectCraft\effectcraft.exe")
            };
            foreach (string g in guesses) if (File.Exists(g)) return g;
            return null;
        }

        static bool EcRunning() { return Process.GetProcessesByName("effectcraft").Length > 0; }

        static bool EcPortOpen()
        {
            try
            {
                using (var c = new TcpClient())
                {
                    var ar = c.BeginConnect(IPAddress.Loopback, EcPort, null, null);
                    bool ok = ar.AsyncWaitHandle.WaitOne(400);
                    if (ok) c.EndConnect(ar);
                    return ok && c.Connected;
                }
            }
            catch { return false; }
        }

        /// <summary>Abre EffectCraft con el canal de control si no esta abierto. Devuelve el estado.</summary>
        static Dictionary<string, object> EnsureEffectCraft(bool launch)
        {
            var st = new Dictionary<string, object>();
            string exe = FindEffectCraft();
            st["installed"] = exe != null;
            st["running"] = EcRunning();
            st["connected"] = EcPortOpen();
            if (!(bool)st["running"] && exe != null)
            {
                var psi = new ProcessStartInfo(exe, "--control " + EcPort);
                psi.UseShellExecute = false;
                Process.Start(psi);
                st["launched"] = true;
                for (int i = 0; i < 60 && !EcPortOpen(); i++) Thread.Sleep(500);
                st["running"] = EcRunning();
                st["connected"] = EcPortOpen();
            }
            return st;
        }

        static string EcExecute(string command, object prms)
        {
            lock (ecLock)
            {
                for (int attempt = 0; attempt < 2; attempt++)
                {
                    try
                    {
                        if (ecClient == null || !ecClient.Connected)
                        {
                            ecClient = new TcpClient();
                            ecClient.Connect(IPAddress.Loopback, EcPort);
                            ecClient.ReceiveTimeout = 15 * 60 * 1000;
                            var ns = ecClient.GetStream();
                            ecReader = new StreamReader(ns, new UTF8Encoding(false));
                            ecWriter = new StreamWriter(ns, new UTF8Encoding(false));
                            ecWriter.AutoFlush = true;
                        }
                        int id = ++ecId;
                        var msg = new Dictionary<string, object>();
                        msg["id"] = id;
                        msg["method"] = "engine.execute";
                        var p = new Dictionary<string, object>();
                        p["command"] = command;
                        p["params"] = prms ?? new Dictionary<string, object>();
                        msg["params"] = p;
                        ecWriter.Write(Json.Serialize(msg) + "\n");
                        string line = ecReader.ReadLine();
                        if (line == null) throw new IOException("EffectCraft cerro la conexion.");
                        return line;
                    }
                    catch (Exception)
                    {
                        try { if (ecClient != null) ecClient.Close(); } catch { }
                        ecClient = null;
                        if (attempt == 1) throw;
                    }
                }
                return null;
            }
        }

        // ------------------------------------------------------------ servidor HTTP
        static void Serve(HttpListener listener)
        {
            while (listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); } catch { return; }
                ThreadPool.QueueUserWorkItem(delegate { Handle(ctx); });
            }
        }

        static void Handle(HttpListenerContext ctx)
        {
            try
            {
                string path = ctx.Request.Url.AbsolutePath;
                if (path.StartsWith("/api/")) { HandleApi(ctx, path.Substring(5)); return; }
                if (path == "/") path = "/index.html";
                string file = Path.GetFullPath(Path.Combine(webRoot, Uri.UnescapeDataString(path.TrimStart('/')).Replace('/', '\\')));
                if (!file.StartsWith(Path.GetFullPath(webRoot), StringComparison.OrdinalIgnoreCase) || !File.Exists(file))
                {
                    ctx.Response.StatusCode = 404; ctx.Response.Close(); return;
                }
                string ext = Path.GetExtension(file).ToLowerInvariant();
                ctx.Response.ContentType = ext == ".html" ? "text/html; charset=utf-8" : ext == ".css" ? "text/css; charset=utf-8"
                    : (ext == ".js" || ext == ".jsx") ? "application/javascript; charset=utf-8" : "application/octet-stream";
                ctx.Response.Headers["Cache-Control"] = "no-store";
                byte[] data = File.ReadAllBytes(file);
                ctx.Response.OutputStream.Write(data, 0, data.Length);
                ctx.Response.Close();
            }
            catch (Exception ex)
            {
                try { Reply(ctx, 500, Err(ex.Message)); } catch { }
            }
        }

        static Dictionary<string, object> Err(string m) { var d = new Dictionary<string, object>(); d["ok"] = false; d["error"] = m; return d; }
        static Dictionary<string, object> Ok(object data) { var d = new Dictionary<string, object>(); d["ok"] = true; d["data"] = data; return d; }

        static void Reply(HttpListenerContext ctx, int status, object body)
        {
            byte[] b = Encoding.UTF8.GetBytes(Json.Serialize(body));
            ctx.Response.StatusCode = status;
            ctx.Response.ContentType = "application/json; charset=utf-8";
            ctx.Response.OutputStream.Write(b, 0, b.Length);
            ctx.Response.Close();
        }

        static string S(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : null; }

        static void HandleApi(HttpListenerContext ctx, string name)
        {
            // Solo el panel abierto por este programa conoce el token
            if (ctx.Request.Headers["X-AutoSub-Token"] != token) { Reply(ctx, 403, Err("Acceso denegado.")); return; }
            string origin = ctx.Request.Headers["Origin"];
            if (!string.IsNullOrEmpty(origin) && origin != "http://127.0.0.1:" + port) { Reply(ctx, 403, Err("Origen no permitido.")); return; }

            string raw;
            using (var r = new StreamReader(ctx.Request.InputStream, Encoding.UTF8)) raw = r.ReadToEnd();
            var req = string.IsNullOrEmpty(raw) ? new Dictionary<string, object>() : Json.Deserialize<Dictionary<string, object>>(raw);
            try
            {
                switch (name)
                {
                    case "ping": lastPing = DateTime.Now; Reply(ctx, 200, Ok(true)); return;
                    case "env": Reply(ctx, 200, Ok(Env())); return;
                    case "fs": Reply(ctx, 200, Ok(Fs(req))); return;
                    case "http": Reply(ctx, 200, Ok(Http(req))); return;
                    case "ec":
                        {
                            object prms; req.TryGetValue("params", out prms);
                            string line = EcExecute(S(req, "command"), prms);
                            Reply(ctx, 200, Ok(Json.DeserializeObject(line)));
                            return;
                        }
                    case "ecStatus": Reply(ctx, 200, Ok(EnsureEffectCraft(false))); return;
                    case "ecLaunch": Reply(ctx, 200, Ok(EnsureEffectCraft(true))); return;
                    case "protect":
                        Reply(ctx, 200, Ok(Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(S(req, "data") ?? ""), Entropy, DataProtectionScope.CurrentUser))));
                        return;
                    case "unprotect":
                        Reply(ctx, 200, Ok(Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(S(req, "data") ?? ""), Entropy, DataProtectionScope.CurrentUser))));
                        return;
                    case "saveDialog": Reply(ctx, 200, Ok(SaveDialog(S(req, "title"), S(req, "name"), S(req, "ext")))); return;
                    case "openUrl":
                        {
                            string u = S(req, "url") ?? "";
                            if (u.StartsWith("https://") || u.StartsWith("http://")) Process.Start(u);
                            Reply(ctx, 200, Ok(true));
                            return;
                        }
                }
                Reply(ctx, 404, Err("API desconocida: " + name));
            }
            catch (Exception ex)
            {
                Reply(ctx, 200, Err(ex.Message));
            }
        }

        static object Env()
        {
            var d = new Dictionary<string, object>();
            d["platform"] = "win32";
            d["appdata"] = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            d["home"] = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            d["tmp"] = Path.GetTempPath().TrimEnd('\\');
            d["host"] = "effectcraft";
            return d;
        }

        static object Fs(Dictionary<string, object> q)
        {
            string op = S(q, "op"), p = S(q, "path");
            switch (op)
            {
                case "exists": return File.Exists(p) || Directory.Exists(p);
                case "readText": return File.ReadAllText(p, Encoding.UTF8);
                case "readBase64": return Convert.ToBase64String(File.ReadAllBytes(p));
                case "writeText": Directory.CreateDirectory(Path.GetDirectoryName(p)); File.WriteAllText(p, S(q, "data") ?? "", new UTF8Encoding(false)); return true;
                case "writeBase64": Directory.CreateDirectory(Path.GetDirectoryName(p)); File.WriteAllBytes(p, Convert.FromBase64String(S(q, "data") ?? "")); return true;
                case "appendText": File.AppendAllText(p, S(q, "data") ?? "", new UTF8Encoding(false)); return true;
                case "stat": { var d = new Dictionary<string, object>(); d["size"] = new FileInfo(p).Length; return d; }
                case "rename": if (File.Exists(S(q, "to"))) File.Delete(S(q, "to")); File.Move(p, S(q, "to")); return true;
                case "unlink": if (File.Exists(p)) File.Delete(p); return true;
                case "mkdir": Directory.CreateDirectory(p); return true;
            }
            throw new Exception("Operacion de archivo desconocida: " + op);
        }

        static object Http(Dictionary<string, object> q)
        {
            var req = (HttpWebRequest)WebRequest.Create(S(q, "url"));
            req.Method = S(q, "method") ?? "GET";
            req.Timeout = 10 * 60 * 1000;
            req.ReadWriteTimeout = 10 * 60 * 1000;
            req.AllowWriteStreamBuffering = false;
            object hv;
            if (q.TryGetValue("headers", out hv) && hv is Dictionary<string, object>)
            {
                foreach (var kv in (Dictionary<string, object>)hv)
                {
                    string k = kv.Key, v = Convert.ToString(kv.Value);
                    if (string.Equals(k, "Content-Type", StringComparison.OrdinalIgnoreCase)) req.ContentType = v;
                    else if (string.Equals(k, "Content-Length", StringComparison.OrdinalIgnoreCase)) req.ContentLength = long.Parse(v);
                    else req.Headers[k] = v;
                }
            }
            string bodyFile = S(q, "bodyFile"), body = S(q, "body");
            if (bodyFile != null)
            {
                req.ContentLength = new FileInfo(bodyFile).Length;
                using (var rs = req.GetRequestStream())
                using (var fs = File.OpenRead(bodyFile)) fs.CopyTo(rs);
            }
            else if (body != null)
            {
                byte[] b = Encoding.UTF8.GetBytes(body);
                req.ContentLength = b.Length;
                using (var rs = req.GetRequestStream()) rs.Write(b, 0, b.Length);
            }
            HttpWebResponse resp;
            try { resp = (HttpWebResponse)req.GetResponse(); }
            catch (WebException we) { resp = we.Response as HttpWebResponse; if (resp == null) throw; }
            using (resp)
            {
                var d = new Dictionary<string, object>();
                d["status"] = (int)resp.StatusCode;
                var h = new Dictionary<string, object>();
                foreach (string k in resp.Headers.AllKeys) h[k.ToLowerInvariant()] = resp.Headers[k];
                d["headers"] = h;
                using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) d["body"] = sr.ReadToEnd();
                return d;
            }
        }

        static string SaveDialog(string title, string name, string ext)
        {
            string result = "";
            var t = new Thread(delegate ()
            {
                using (var dlg = new SaveFileDialog())
                {
                    dlg.Title = title ?? "Guardar";
                    dlg.FileName = name ?? "";
                    if (!string.IsNullOrEmpty(ext)) dlg.Filter = ext.ToUpperInvariant() + " (*." + ext + ")|*." + ext;
                    var owner = new Form { TopMost = true, ShowInTaskbar = false, Width = 0, Height = 0, FormBorderStyle = FormBorderStyle.None };
                    owner.Show(); owner.Activate();
                    if (dlg.ShowDialog(owner) == DialogResult.OK) result = dlg.FileName;
                    owner.Close();
                }
            });
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            t.Join();
            return result;
        }
    }
}
