#!/bin/bash
# Fixes the "Gaane is damaged / can't be opened" warning and cleans up the installer disk.
APP="/Applications/Gaane.app"
clear
echo "Gaane repair"
echo "------------"
if [ ! -d "$APP" ]; then
  osascript -e 'display dialog "Gaane is not in your Applications folder yet. Drag Gaane into Applications first, then run Repair." buttons {"OK"} default button "OK" with icon caution' >/dev/null 2>&1
  exit 1
fi
xattr -cr "$APP" 2>/dev/null
chmod -R u+rwX "$APP" 2>/dev/null
for v in /Volumes/Gaane\ [0-9]*; do
  [ -d "$v/Gaane.app" ] && hdiutil detach "$v" -force >/dev/null 2>&1
done
echo "Done. You can open Gaane now."
osascript -e 'display dialog "Gaane has been repaired. You can open it from Applications." buttons {"OK"} default button "OK"' >/dev/null 2>&1
