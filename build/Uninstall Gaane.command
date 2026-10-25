#!/bin/bash
# Removes Gaane from this Mac. Your data is only deleted if you say yes to the second question.
APP="/Applications/Gaane.app"
DATA="$HOME/Library/Application Support/Gaane"
clear
echo "Gaane uninstall"
echo "---------------"
ans=$(osascript -e 'button returned of (display dialog "Remove Gaane from this Mac?" buttons {"Cancel", "Uninstall"} default button "Cancel" with icon caution)' 2>/dev/null)
[ "$ans" != "Uninstall" ] && { echo "Cancelled."; exit 0; }
osascript -e 'tell application "Gaane" to quit' >/dev/null 2>&1
sleep 1
pkill -f "/Applications/Gaane.app/" 2>/dev/null
if [ -d "$APP" ]; then
  osascript -e 'tell application "Finder" to delete POSIX file "/Applications/Gaane.app"' >/dev/null 2>&1
fi
if [ -d "$DATA" ]; then
  d=$(osascript -e 'button returned of (display dialog "Also delete your Gaane data (favorites, history, downloads cache, YouTube Music login)?" buttons {"Keep my data", "Delete data"} default button "Keep my data" with icon caution)' 2>/dev/null)
  if [ "$d" = "Delete data" ]; then
    osascript -e 'tell application "Finder" to delete POSIX file "'"$DATA"'"' >/dev/null 2>&1
  fi
fi
for v in /Volumes/Gaane\ [0-9]*; do
  [ -d "$v/Gaane.app" ] && hdiutil detach "$v" -force >/dev/null 2>&1
done
echo "Gaane has been moved to the Bin."
osascript -e 'display dialog "Gaane has been moved to the Bin." buttons {"OK"} default button "OK"' >/dev/null 2>&1
