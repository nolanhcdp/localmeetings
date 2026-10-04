#!/bin/bash
# Vote Tracker: pulls new Howard County meeting transcripts from YouTube and sends them to the site.
# Runs daily from launchd (installed by install.sh). Safe to run by hand any time.
DIR="$HOME/Library/Application Support/VoteTracker"
source "$DIR/config" || { echo "Missing $DIR/config"; exit 1; }   # sets SITE and ADMIN_CODE
YTDLP="$DIR/yt-dlp"
CHANNEL="https://www.youtube.com/@howardcountygovernmentindi4259"
SEEN="$DIR/seen.txt"; touch "$SEEN"
START_DATE="${START_DATE:-20260101}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
log() { echo "$(date '+%Y-%m-%d %H:%M') $*" >> "$DIR/log.txt"; echo "$*"; }

"$YTDLP" -U >/dev/null 2>&1   # keep yt-dlp current; YouTube changes often

# First run looks further back to fill in the year; after that, the latest uploads are enough.
if [ -s "$SEEN" ]; then LIMIT=20; else LIMIT=150; fi
IDS=$( { "$YTDLP" --flat-playlist --playlist-end $LIMIT --print "%(id)s" "$CHANNEL/streams"; "$YTDLP" --flat-playlist --playlist-end $LIMIT --print "%(id)s" "$CHANNEL/videos"; } 2>/dev/null | sort -u)

sent=0
for id in $IDS; do
  grep -qx "$id" "$SEEN" && continue
  info=$("$YTDLP" --skip-download --print "%(release_date,upload_date)s|%(duration)s|%(live_status)s|%(title)s" "https://www.youtube.com/watch?v=$id" 2>/dev/null | head -1)
  [ -z "$info" ] && continue
  IFS='|' read -r vdate dur live title <<< "$info"
  case "$live" in is_live|is_upcoming|post_live) continue;; esac   # captions come after the stream is processed
  if [[ "$vdate" < "$START_DATE" ]] || [ "${dur%.*}" -lt 120 ] 2>/dev/null; then echo "$id" >> "$SEEN"; continue; fi
  # Budget hearings run 8+ hours; too big to send and not part of the tracker yet.
  if echo "$title" | grep -qi "budget"; then echo "$id" >> "$SEEN"; log "skipped budget hearing $id $vdate"; continue; fi
  t=${title//\\/\\\\}; t=${t//\"/\\\"}
  meta="{\"videoId\":\"$id\",\"title\":\"$t\",\"date\":\"$vdate\",\"duration\":${dur%.*}}"
  "$YTDLP" --skip-download --write-auto-subs --write-subs --sub-langs "en.*" --sub-format json3 -o "$TMP/$id.%(ext)s" "https://www.youtube.com/watch?v=$id" >/dev/null 2>&1
  f=$(ls "$TMP/$id".*json3 2>/dev/null | head -1)
  if [ -n "$f" ]; then
    out=$(curl -sS --max-time 60 -H "x-admin-code: $ADMIN_CODE" --form-string "meta=$meta" -F "subs=@$f;type=application/json" "$SITE/api/transcript")
    if echo "$out" | grep -q '"ok":true'; then echo "$id" >> "$SEEN"; sent=$((sent+1)); log "sent $id $vdate $title -> $out"; else log "FAILED $id: $out"; fi
  else
    # No captions yet. YouTube can take a day; after a week, record it as having none.
    age=$(( ( $(date +%s) - $(date -j -f %Y%m%d "$vdate" +%s 2>/dev/null || date +%s) ) / 86400 ))
    if [ "$age" -gt 7 ]; then
      meta="${meta%\}},\"noCaptions\":true}"
      curl -sS --max-time 30 -H "x-admin-code: $ADMIN_CODE" -H "content-type: application/json" -d "$meta" "$SITE/api/transcript" >/dev/null && echo "$id" >> "$SEEN"
      log "no captions $id $vdate $title"
    fi
  fi
done
log "done: sent $sent"
