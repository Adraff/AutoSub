// AutoSub - Instalador propio para Windows.
// Se compila con el compilador de C# que ya trae Windows (.NET Framework 4), sin herramientas de terceros.
// Lleva incrustados: el panel ("payload.zip") y el puente para EffectCraft ("bridge.exe").
//
// After Effects:
//   1. Copia el panel a %APPDATA%\Adobe\CEP\extensions\com.autosub.ae (solo para el usuario actual, sin admin).
//   2. Activa PlayerDebugMode en HKCU\Software\Adobe\CSXS.* para que After Effects cargue extensiones sin firmar.
// EffectCraft:
//   1. Copia el panel y "AutoSub para EffectCraft" a %LOCALAPPDATA%\AutoSub\EffectCraft.
//   2. Crea accesos directos en el menu Inicio y en el Escritorio.
// Desinstalar elimina todo lo anterior.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("AutoSub Installer")]
[assembly: AssemblyProduct("AutoSub")]
[assembly: AssemblyVersion("1.4.1.0")]
[assembly: AssemblyFileVersion("1.4.1.0")]

namespace AutoSubInstaller
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            // Modo silencioso: AutoSub-Installer.exe /install  o  /uninstall
            if (args.Length > 0)
            {
                string a = args[0].ToLowerInvariant().TrimStart('/', '-');
                try
                {
                    if (a == "install")
                    {
                        Core.InstallAE(null);
                        if (Core.FindEffectCraft() != null) Core.InstallEC(null);
                        Console.WriteLine("AutoSub instalado.");
                        return 0;
                    }
                    if (a == "uninstall") { Core.Uninstall(); Console.WriteLine("AutoSub desinstalado."); return 0; }
                }
                catch (Exception ex) { Console.Error.WriteLine(ex.Message); return 1; }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
            return 0;
        }
    }

    static class Core
    {
        public const string ExtensionId = "com.autosub.ae";
        public static readonly int[] CsxsVersions = { 8, 9, 10, 11, 12, 13, 14, 15 };

        public static string AeDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Adobe", "CEP", "extensions", ExtensionId); }
        }
        public static string EcDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AutoSub", "EffectCraft"); }
        }
        public static string EcExe { get { return Path.Combine(EcDir, "AutoSub-EffectCraft.exe"); } }
        static string ShortcutStart
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "AutoSub para EffectCraft.lnk"); }
        }
        static string ShortcutDesktop
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "AutoSub para EffectCraft.lnk"); }
        }

        public static bool AeInstalled { get { return File.Exists(Path.Combine(AeDir, "CSXS", "manifest.xml")); } }
        public static bool EcInstalled { get { return File.Exists(EcExe); } }

        public static List<string> DetectAfterEffects()
        {
            var found = new List<string>();
            var roots = new List<string>();
            roots.Add(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles));
            string pf = Environment.GetEnvironmentVariable("ProgramW6432");
            if (!string.IsNullOrEmpty(pf) && !roots.Contains(pf)) roots.Add(pf);
            foreach (string r in roots)
            {
                string adobe = Path.Combine(r, "Adobe");
                if (!Directory.Exists(adobe)) continue;
                foreach (string d in Directory.GetDirectories(adobe, "Adobe After Effects*"))
                {
                    string name = Path.GetFileName(d);
                    if (!found.Contains(name)) found.Add(name);
                }
            }
            found.Sort();
            return found;
        }

        /// <summary>Ruta de effectcraft.exe si EffectCraft esta instalado.</summary>
        public static string FindEffectCraft()
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
                                string guess = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"ArtCraft\EffectCraft\effectcraft.exe");
                                if (File.Exists(guess)) return guess;
                                return "(instalado)";
                            }
                        }
                    }
                }
            }
            string g2 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"ArtCraft\EffectCraft\effectcraft.exe");
            return File.Exists(g2) ? g2 : null;
        }

        public static bool AfterEffectsRunning() { return Process.GetProcessesByName("AfterFX").Length > 0; }
        public static bool BridgeRunning() { return Process.GetProcessesByName("AutoSub-EffectCraft").Length > 0; }

        static void ExtractPayload(string targetDir, Action<int, string> progress, int p0, int p1)
        {
            Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip");
            if (payload == null) throw new Exception("El instalador está dañado: no contiene los archivos del panel.");
            using (payload)
            using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
            {
                int total = zip.Entries.Count, i = 0;
                string rootFull = Path.GetFullPath(targetDir) + Path.DirectorySeparatorChar;
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    i++;
                    string rel = entry.FullName.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
                    string dest = Path.GetFullPath(Path.Combine(targetDir, rel));
                    if (!dest.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase)) continue; // seguridad
                    if (rel.EndsWith(Path.DirectorySeparatorChar.ToString()) || entry.Name.Length == 0) { Directory.CreateDirectory(dest); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    entry.ExtractToFile(dest, true);
                    progress(p0 + (int)((p1 - p0) * (double)i / Math.Max(1, total)), "Copiando " + entry.Name);
                }
            }
        }

        public static void InstallAE(Action<int, string> progress)
        {
            if (progress == null) progress = delegate (int p, string s) { };
            progress(5, "After Effects: preparando carpeta de extensiones...");
            if (Directory.Exists(AeDir)) Directory.Delete(AeDir, true);
            Directory.CreateDirectory(AeDir);
            ExtractPayload(AeDir, progress, 10, 45);
            progress(48, "After Effects: activando extensiones sin firmar (PlayerDebugMode)...");
            foreach (int v in CsxsVersions)
            {
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\Adobe\CSXS." + v))
                {
                    if (k != null) k.SetValue("PlayerDebugMode", "1", RegistryValueKind.String);
                }
            }
            progress(50, "After Effects: listo.");
        }

        public static void InstallEC(Action<int, string> progress)
        {
            if (progress == null) progress = delegate (int p, string s) { };
            progress(52, "EffectCraft: copiando AutoSub para EffectCraft...");
            if (Directory.Exists(EcDir)) Directory.Delete(EcDir, true);
            string web = Path.Combine(EcDir, "web");
            Directory.CreateDirectory(web);
            ExtractPayload(web, progress, 55, 85);
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("bridge.exe"))
            {
                if (s == null) throw new Exception("El instalador está dañado: falta AutoSub para EffectCraft.");
                using (var f = File.Create(EcExe)) s.CopyTo(f);
            }
            progress(90, "EffectCraft: creando accesos directos...");
            CreateShortcut(ShortcutStart, EcExe, "AutoSub: subtítulos automáticos con IA para EffectCraft");
            CreateShortcut(ShortcutDesktop, EcExe, "AutoSub: subtítulos automáticos con IA para EffectCraft");
            progress(100, "EffectCraft: listo.");
        }

        static void CreateShortcut(string lnk, string target, string description)
        {
            // WScript.Shell viene con Windows; se usa por reflexion (sin referencias externas)
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(t);
            object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
            Type st = sc.GetType();
            st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
            st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { Path.GetDirectoryName(target) });
            st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { description });
            st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
        }

        public static void Uninstall()
        {
            if (Directory.Exists(AeDir)) Directory.Delete(AeDir, true);
            foreach (var p in Process.GetProcessesByName("AutoSub-EffectCraft")) { try { p.Kill(); p.WaitForExit(3000); } catch { } }
            if (Directory.Exists(EcDir)) Directory.Delete(EcDir, true);
            if (File.Exists(ShortcutStart)) File.Delete(ShortcutStart);
            if (File.Exists(ShortcutDesktop)) File.Delete(ShortcutDesktop);
        }
    }

    class MainForm : Form
    {
        static readonly Color Bg = Color.FromArgb(30, 30, 32);
        static readonly Color Card = Color.FromArgb(40, 40, 44);
        static readonly Color Fg = Color.FromArgb(225, 225, 225);
        static readonly Color Muted = Color.FromArgb(150, 150, 155);
        static readonly Color Accent = Color.FromArgb(74, 140, 255);

        Label status, stateLabel;
        ProgressBar bar;
        Button btnInstall, btnUninstall, btnClose;
        CheckBox chkAE, chkEC;

        public MainForm()
        {
            Text = "Instalar AutoSub";
            ClientSize = new Size(560, 470);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Bg;
            ForeColor = Fg;
            Font = new Font("Segoe UI", 9.5f);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            var logo = new Panel { Location = new Point(28, 26), Size = new Size(56, 56) };
            logo.Paint += delegate (object s, PaintEventArgs e)
            {
                e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                using (var br = new System.Drawing.Drawing2D.LinearGradientBrush(new Rectangle(0, 0, 56, 56),
                    Color.FromArgb(74, 140, 255), Color.FromArgb(154, 92, 255), 45f))
                using (var path = RoundRect(new Rectangle(0, 0, 55, 55), 12))
                    e.Graphics.FillPath(br, path);
                TextRenderer.DrawText(e.Graphics, "AS", new Font("Segoe UI", 16f, FontStyle.Bold),
                    new Rectangle(0, 0, 56, 56), Color.White, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            };
            Controls.Add(logo);
            Controls.Add(new Label { Text = "AutoSub", Font = new Font("Segoe UI", 18f, FontStyle.Bold), Location = new Point(98, 24), AutoSize = true, ForeColor = Color.White });
            Controls.Add(new Label { Text = "Subtítulos automáticos con IA (Google Gemini) · libre y gratuito", Location = new Point(100, 60), AutoSize = true, ForeColor = Muted });

            var card = new Panel { Location = new Point(28, 104), Size = new Size(504, 206), BackColor = Card };
            Controls.Add(card);
            card.Controls.Add(new Label { Text = "¿Dónde quieres instalarlo?", Location = new Point(14, 10), AutoSize = true, ForeColor = Color.White, Font = new Font("Segoe UI", 10f, FontStyle.Bold) });

            List<string> ae = Core.DetectAfterEffects();
            chkAE = new CheckBox
            {
                Location = new Point(16, 38), Size = new Size(476, 22), Checked = ae.Count > 0 || Core.AeInstalled, ForeColor = Fg,
                Text = "Adobe After Effects" + (ae.Count > 0 ? "  (" + string.Join(", ", ae.ToArray()) + ")" : "  (no detectado)")
            };
            card.Controls.Add(chkAE);
            card.Controls.Add(new Label { Location = new Point(34, 60), Size = new Size(460, 18), ForeColor = Muted, Text = "Ventana > Extensiones > AutoSub - Subtítulos IA" });

            bool ecFound = Core.FindEffectCraft() != null;
            chkEC = new CheckBox
            {
                Location = new Point(16, 88), Size = new Size(476, 22), Checked = ecFound || Core.EcInstalled, ForeColor = Fg,
                Text = "EffectCraft" + (ecFound ? "  (detectado)" : "  (no detectado)")
            };
            card.Controls.Add(chkEC);
            card.Controls.Add(new Label { Location = new Point(34, 110), Size = new Size(460, 34), ForeColor = Muted, Text = "Se abre como ventana propia con el acceso directo \"AutoSub para EffectCraft\" (menú Inicio y Escritorio)." });

            stateLabel = new Label { Location = new Point(14, 152), Size = new Size(476, 44), ForeColor = Muted };
            card.Controls.Add(stateLabel);

            bar = new ProgressBar { Location = new Point(28, 326), Size = new Size(504, 8), Style = ProgressBarStyle.Continuous };
            Controls.Add(bar);
            status = new Label { Location = new Point(28, 342), Size = new Size(504, 60), ForeColor = Fg };
            Controls.Add(status);

            btnInstall = MakeButton("Instalar", new Point(28, 410), 160, true);
            btnInstall.Click += OnInstall;
            Controls.Add(btnInstall);
            btnUninstall = MakeButton("Desinstalar", new Point(198, 410), 130, false);
            btnUninstall.Click += OnUninstall;
            Controls.Add(btnUninstall);
            btnClose = MakeButton("Cerrar", new Point(432, 410), 100, false);
            btnClose.Click += delegate { Close(); };
            Controls.Add(btnClose);

            RefreshState();
        }

        static System.Drawing.Drawing2D.GraphicsPath RoundRect(Rectangle r, int rad)
        {
            var p = new System.Drawing.Drawing2D.GraphicsPath();
            int d = rad * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        Button MakeButton(string text, Point loc, int width, bool primary)
        {
            var b = new Button
            {
                Text = text, Location = loc, Size = new Size(width, 38), FlatStyle = FlatStyle.Flat,
                BackColor = primary ? Accent : Color.FromArgb(55, 55, 60), ForeColor = Color.White, Cursor = Cursors.Hand
            };
            b.FlatAppearance.BorderSize = 0;
            if (primary) b.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            return b;
        }

        void RefreshState()
        {
            var parts = new List<string>();
            if (Core.AeInstalled) parts.Add("After Effects");
            if (Core.EcInstalled) parts.Add("EffectCraft");
            stateLabel.Text = parts.Count > 0
                ? "Ya instalado en: " + string.Join(" y ", parts.ToArray()) + ". Pulsa \"Instalar\" para actualizar."
                : "Estado: no instalado.";
            btnInstall.Text = parts.Count > 0 ? "Actualizar" : "Instalar";
            btnUninstall.Enabled = parts.Count > 0;
        }

        bool CheckClosed()
        {
            while ((chkAE.Checked && Core.AfterEffectsRunning()) || Core.BridgeRunning())
            {
                var r = MessageBox.Show(this,
                    "Cierra After Effects y la ventana de AutoSub para EffectCraft para continuar (guarda tu trabajo antes).\n\nPulsa Reintentar cuando estén cerrados.",
                    "AutoSub", MessageBoxButtons.RetryCancel, MessageBoxIcon.Warning);
                if (r == DialogResult.Cancel) return false;
            }
            return true;
        }

        void OnInstall(object sender, EventArgs e)
        {
            if (!chkAE.Checked && !chkEC.Checked) { MessageBox.Show(this, "Elige al menos un programa.", "AutoSub"); return; }
            if (!CheckClosed()) return;
            SetButtons(false);
            Action<int, string> prog = delegate (int p, string s) { bar.Value = Math.Max(0, Math.Min(100, p)); status.Text = s; Application.DoEvents(); };
            try
            {
                var done = new List<string>();
                if (chkAE.Checked) { Core.InstallAE(prog); done.Add("After Effects: Ventana > Extensiones > AutoSub - Subtítulos IA."); }
                if (chkEC.Checked) { Core.InstallEC(prog); done.Add("EffectCraft: abre \"AutoSub para EffectCraft\" desde el menú Inicio o el Escritorio."); }
                bar.Value = 100;
                status.ForeColor = Color.FromArgb(63, 191, 127);
                status.Text = "✔ Instalado.\n" + string.Join("\n", done.ToArray());
                MessageBox.Show(this, "AutoSub se ha instalado correctamente.\n\n" + string.Join("\n", done.ToArray()) +
                    "\n\nLa primera vez, el panel te guiará para cargar tu API key gratuita de Google Gemini.",
                    "AutoSub", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                status.ForeColor = Color.FromArgb(229, 86, 79);
                status.Text = "✖ Error: " + ex.Message;
            }
            SetButtons(true);
            RefreshState();
        }

        void OnUninstall(object sender, EventArgs e)
        {
            if (MessageBox.Show(this, "¿Quieres desinstalar AutoSub (After Effects y EffectCraft)?\n\nTus subtítulos ya creados en tus proyectos no se borran.",
                "AutoSub", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            if (!CheckClosed()) return;
            try
            {
                Core.Uninstall();
                bar.Value = 0;
                status.ForeColor = Fg;
                status.Text = "AutoSub se ha desinstalado.";
            }
            catch (Exception ex)
            {
                status.ForeColor = Color.FromArgb(229, 86, 79);
                status.Text = "✖ Error: " + ex.Message;
            }
            RefreshState();
        }

        void SetButtons(bool on) { btnInstall.Enabled = on; btnUninstall.Enabled = on; btnClose.Enabled = on; }
    }
}
