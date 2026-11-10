// AutoSub - Instalador propio para Windows.
// Se compila con el compilador de C# que ya trae Windows (.NET Framework 4), sin herramientas de terceros.
// El panel va incrustado dentro del .exe como recurso "payload.zip".
//
// Que hace:
//   1. Copia la extension a %APPDATA%\Adobe\CEP\extensions\com.autosub.ae (solo para el usuario actual, sin admin).
//   2. Activa PlayerDebugMode en HKCU\Software\Adobe\CSXS.* para que After Effects cargue extensiones sin firmar.
// Desinstalar elimina la carpeta de la extension.

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
[assembly: AssemblyProduct("AutoSub para After Effects")]
[assembly: AssemblyVersion("1.3.0.0")]
[assembly: AssemblyFileVersion("1.3.0.0")]

namespace AutoSubInstaller
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            // Modo silencioso opcional: AutoSub-Installer.exe /install  o  /uninstall
            if (args.Length > 0)
            {
                string a = args[0].ToLowerInvariant().TrimStart('/', '-');
                try
                {
                    if (a == "install") { Core.Install(null); Console.WriteLine("AutoSub instalado en " + Core.TargetDir); return 0; }
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

        public static string ExtensionsRoot
        {
            get
            {
                return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                                    "Adobe", "CEP", "extensions");
            }
        }

        public static string TargetDir { get { return Path.Combine(ExtensionsRoot, ExtensionId); } }

        public static bool IsInstalled { get { return File.Exists(Path.Combine(TargetDir, "CSXS", "manifest.xml")); } }

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

        public static bool AfterEffectsRunning()
        {
            return Process.GetProcessesByName("AfterFX").Length > 0;
        }

        public static void Install(Action<int, string> progress)
        {
            if (progress == null) progress = delegate (int p, string s) { };

            progress(5, "Preparando carpeta de extensiones...");
            Directory.CreateDirectory(ExtensionsRoot);
            if (Directory.Exists(TargetDir)) Directory.Delete(TargetDir, true);
            Directory.CreateDirectory(TargetDir);

            progress(15, "Copiando archivos del panel...");
            Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip");
            if (payload == null) throw new Exception("El instalador está dañado: no contiene los archivos del panel.");
            using (payload)
            using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
            {
                int total = zip.Entries.Count, i = 0;
                string rootFull = Path.GetFullPath(TargetDir) + Path.DirectorySeparatorChar;
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    i++;
                    string rel = entry.FullName.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
                    string dest = Path.GetFullPath(Path.Combine(TargetDir, rel));
                    if (!dest.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase)) continue; // seguridad
                    if (rel.EndsWith(Path.DirectorySeparatorChar.ToString()) || entry.Name.Length == 0)
                    {
                        Directory.CreateDirectory(dest);
                        continue;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    entry.ExtractToFile(dest, true);
                    progress(15 + (int)(70.0 * i / Math.Max(1, total)), "Copiando " + entry.Name);
                }
            }

            progress(90, "Activando extensiones sin firmar en After Effects (PlayerDebugMode)...");
            foreach (int v in CsxsVersions)
            {
                using (RegistryKey k = Registry.CurrentUser.CreateSubKey(@"Software\Adobe\CSXS." + v))
                {
                    if (k != null) k.SetValue("PlayerDebugMode", "1", RegistryValueKind.String);
                }
            }
            progress(100, "Instalación completada.");
        }

        public static void Uninstall()
        {
            if (Directory.Exists(TargetDir)) Directory.Delete(TargetDir, true);
        }
    }

    class MainForm : Form
    {
        static readonly Color Bg = Color.FromArgb(30, 30, 32);
        static readonly Color Card = Color.FromArgb(40, 40, 44);
        static readonly Color Fg = Color.FromArgb(225, 225, 225);
        static readonly Color Muted = Color.FromArgb(150, 150, 155);
        static readonly Color Accent = Color.FromArgb(74, 140, 255);

        Label status;
        ProgressBar bar;
        Button btnInstall, btnUninstall, btnClose;
        Label aeLabel, stateLabel;

        public MainForm()
        {
            Text = "Instalar AutoSub para After Effects";
            ClientSize = new Size(560, 430);
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
                    new Rectangle(0, 0, 56, 56), Color.White,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            };
            Controls.Add(logo);

            Controls.Add(new Label
            {
                Text = "AutoSub", Font = new Font("Segoe UI", 18f, FontStyle.Bold),
                Location = new Point(98, 24), AutoSize = true, ForeColor = Color.White
            });
            Controls.Add(new Label
            {
                Text = "Subtítulos automáticos con IA (Google Gemini) para After Effects",
                Location = new Point(100, 60), AutoSize = true, ForeColor = Muted
            });

            var card = new Panel { Location = new Point(28, 104), Size = new Size(504, 168), BackColor = Card };
            Controls.Add(card);

            List<string> ae = Core.DetectAfterEffects();
            aeLabel = new Label
            {
                Location = new Point(14, 12), Size = new Size(476, 40), ForeColor = Fg,
                Text = ae.Count > 0
                    ? "After Effects detectado: " + string.Join(", ", ae.ToArray())
                    : "No se detectó After Effects en Archivos de programa (se instalará igualmente)."
            };
            card.Controls.Add(aeLabel);

            card.Controls.Add(new Label
            {
                Location = new Point(14, 56), Size = new Size(476, 52), ForeColor = Muted,
                Text = "Se instalará en:\n" + Core.TargetDir
            });

            stateLabel = new Label { Location = new Point(14, 112), Size = new Size(476, 44), ForeColor = Muted };
            card.Controls.Add(stateLabel);

            bar = new ProgressBar { Location = new Point(28, 288), Size = new Size(504, 8), Style = ProgressBarStyle.Continuous };
            Controls.Add(bar);

            status = new Label { Location = new Point(28, 304), Size = new Size(504, 52), ForeColor = Fg };
            Controls.Add(status);

            btnInstall = MakeButton("Instalar", new Point(28, 368), 160, true);
            btnInstall.Click += OnInstall;
            Controls.Add(btnInstall);

            btnUninstall = MakeButton("Desinstalar", new Point(198, 368), 130, false);
            btnUninstall.Click += OnUninstall;
            Controls.Add(btnUninstall);

            btnClose = MakeButton("Cerrar", new Point(432, 368), 100, false);
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
                BackColor = primary ? Accent : Color.FromArgb(55, 55, 60), ForeColor = Color.White,
                Cursor = Cursors.Hand
            };
            b.FlatAppearance.BorderSize = 0;
            if (primary) b.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            return b;
        }

        void RefreshState()
        {
            bool inst = Core.IsInstalled;
            stateLabel.Text = inst
                ? "Estado: AutoSub ya está instalado. Pulsa \"Instalar\" para actualizarlo/reinstalarlo."
                : "Estado: no instalado.";
            btnInstall.Text = inst ? "Reinstalar" : "Instalar";
            btnUninstall.Enabled = inst;
        }

        bool CheckAfterEffectsClosed()
        {
            while (Core.AfterEffectsRunning())
            {
                var r = MessageBox.Show(this,
                    "After Effects está abierto. Ciérralo para continuar (guarda tu trabajo antes).\n\nPulsa Reintentar cuando lo hayas cerrado.",
                    "AutoSub", MessageBoxButtons.RetryCancel, MessageBoxIcon.Warning);
                if (r == DialogResult.Cancel) return false;
            }
            return true;
        }

        void OnInstall(object sender, EventArgs e)
        {
            if (!CheckAfterEffectsClosed()) return;
            SetButtons(false);
            try
            {
                Core.Install(delegate (int p, string s)
                {
                    bar.Value = Math.Max(0, Math.Min(100, p));
                    status.Text = s;
                    Application.DoEvents();
                });
                status.ForeColor = Color.FromArgb(63, 191, 127);
                status.Text = "✔ Instalado. Abre After Effects y ve a  Ventana > Extensiones > AutoSub - Subtítulos IA.\nLa primera vez el panel te guiará para cargar tu API key gratuita de Gemini.";
                MessageBox.Show(this,
                    "AutoSub se ha instalado correctamente.\n\n" +
                    "1. Abre After Effects.\n" +
                    "2. Menú Ventana > Extensiones > AutoSub - Subtítulos IA.\n" +
                    "3. Sigue la guía para cargar tu API key gratuita de Google Gemini.",
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
            if (MessageBox.Show(this, "¿Quieres desinstalar AutoSub?\n\nTus subtítulos ya creados en proyectos de After Effects no se borran.",
                "AutoSub", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            if (!CheckAfterEffectsClosed()) return;
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

        void SetButtons(bool on)
        {
            btnInstall.Enabled = on; btnUninstall.Enabled = on; btnClose.Enabled = on;
        }
    }
}
