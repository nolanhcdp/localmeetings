#!/bin/bash
# One-time setup for the daily transcript job. Run:  bash install.sh
set -e
DIR="$HOME/Library/Application Support/VoteTracker"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR"
echo "Downloading yt-dlp (the tool that reads YouTube captions)…"
curl -sSL -o "$DIR/yt-dlp" https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos
chmod +x "$DIR/yt-dlp"; xattr -d com.apple.quarantine "$DIR/yt-dlp" 2>/dev/null || true
cp "$HERE/../public/mac/fetch-transcripts.sh" "$DIR/fetch-transcripts.sh"; chmod +x "$DIR/fetch-transcripts.sh"
if [ ! -f "$DIR/config" ]; then
  read -r -p "Site address (e.g. https://your-site.vercel.app): " SITE
  read -r -s -p "Admin code: " CODE; echo
  printf 'SITE="%s"\nADMIN_CODE="%s"\n' "${SITE%/}" "$CODE" > "$DIR/config"; chmod 600 "$DIR/config"
fi
PLIST="$HOME/Library/LaunchAgents/com.votetracker.transcripts.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.votetracker.transcripts</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/fetch-transcripts.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>40</integer></dict>
  <key>StandardOutPath</key><string>$DIR/launchd.log</string>
  <key>StandardErrorPath</key><string>$DIR/launchd.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/com.votetracker.transcripts" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed. It runs every morning at 7:40 (or when your Mac wakes, if it was asleep)."
echo "Running it once now to fill in 2026. This takes a few minutes…"
bash "$DIR/fetch-transcripts.sh"
