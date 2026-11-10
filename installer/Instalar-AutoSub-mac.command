#!/bin/bash
# Instalador de AutoSub para macOS (sin herramientas de terceros).
# Doble clic en este archivo. Si macOS lo bloquea: clic derecho > Abrir.
# Si no se ejecuta, en Terminal:  chmod +x "Instalar-AutoSub-mac.command"

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/extension"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.autosub.ae"

echo "=============================================="
echo "  AutoSub - Subtitulos IA para After Effects"
echo "=============================================="
echo

if [ ! -f "$SRC/CSXS/manifest.xml" ]; then
  echo "No se encuentra la carpeta 'extension' junto a este instalador."
  read -n 1 -s -r -p "Pulsa una tecla para salir..."
  exit 1
fi

if [ "$1" == "--uninstall" ]; then
  rm -rf "$DEST"
  echo "AutoSub desinstalado."
  exit 0
fi

if pgrep -x "After Effects" >/dev/null 2>&1; then
  echo "After Effects esta abierto. Cierralo y vuelve a ejecutar el instalador."
  read -n 1 -s -r -p "Pulsa una tecla para salir..."
  exit 1
fi

echo "Copiando panel en:"
echo "  $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/" "$DEST/"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "Activando extensiones sin firmar (PlayerDebugMode)..."
for v in 8 9 10 11 12 13 14 15; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done

echo
echo "Instalacion completada."
echo "Abre After Effects > Ventana > Extensiones > AutoSub - Subtitulos IA"
echo
read -n 1 -s -r -p "Pulsa una tecla para cerrar..."
