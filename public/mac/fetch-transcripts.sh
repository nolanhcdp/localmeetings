#!/bin/bash
# Vote Tracker: pulls new Howard County meeting transcripts from YouTube and sends them to the site.
# Runs daily from launchd (installed by mac/install.sh). Safe to run by hand any time.
# This file is served at /mac/fetch-transcripts.sh; the installed copy updates itself from there.
DIR="$HOME/Library/Application Support/VoteTracker"
source "$DIR/config" || { echo "Missing $DIR/config"; exit 1; }   # sets SITE and ADMIN_CODE
YTDLP="$DIR/yt-dlp"
# Where meetings are posted: Howard County (streams and uploads) and the City of Kokomo (KGOV2 streams)
SOURCES="https://www.youtube.com/@howardcountygovernmentindi4259/streams https://www.youtube.com/@howardcountygovernmentindi4259/videos https://www.youtube.com/@KGOV2/streams"
SEEN="$DIR/seen.txt"; touch "$SEEN"
START_DATE="${START_DATE:-20260101}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
log() { echo "$(date '+%Y-%m-%d %H:%M') $*" >> "$DIR/log.txt"; echo "$*"; }

# Keep this script current: the site serves the latest copy, so code changes only need a GitHub push.
if [ -z "${VT_UPDATED:-}" ] && curl -fsS --max-time 20 "$SITE/mac/fetch-transcripts.sh" -o "$TMP/latest.sh" 2>/dev/null \
   && head -1 "$TMP/latest.sh" | grep -q '^#!/bin/bash' && ! cmp -s "$TMP/latest.sh" "$DIR/fetch-transcripts.sh"; then
  cp "$TMP/latest.sh" "$DIR/.fetch-new.sh" && mv -f "$DIR/.fetch-new.sh" "$DIR/fetch-transcripts.sh"   # replace, don't overwrite in place
  log "updated itself from $SITE"; rm -rf "$TMP"
  VT_UPDATED=1 exec bash "$DIR/fetch-transcripts.sh"
fi

"$YTDLP" -U >/dev/null 2>&1   # keep yt-dlp current; YouTube changes often

# The first time a source is checked, look back far enough to fill in the year; after that, the latest uploads are enough.
IDS=$( for src in $SOURCES; do
  mark="$DIR/backfilled-$(echo "$src" | tr -c 'A-Za-z0-9' '_')"
  if [ -f "$mark" ]; then LIMIT=20; else LIMIT=150; fi
  "$YTDLP" --flat-playlist --playlist-end $LIMIT --print "%(id)s" "$src" 2>/dev/null && echo "$mark" >> "$TMP/marks"
done | sort -u)

# Videos the site still has no transcript for (YouTube sometimes refuses with "too many requests"): try them again.
RETRY=$(curl -fsS --max-time 30 -H "x-admin-code: $ADMIN_CODE" "$SITE/api/transcript?missing=1" 2>/dev/null | grep -oE '"[A-Za-z0-9_-]{11}"' | tr -d '"')

sent=0
for id in $(printf '%s\n' $RETRY $IDS | awk '!seen[$0]++'); do
  if ! printf '%s\n' $RETRY | grep -qxF -- "$id"; then grep -qxF -- "$id" "$SEEN" && continue; fi
  info=$("$YTDLP" --skip-download --print "%(release_date,upload_date)s|%(duration)s|%(live_status)s|%(channel_id)s|%(title)s" "https://www.youtube.com/watch?v=$id" 2>/dev/null | head -1)
  [ -z "$info" ] && continue
  IFS='|' read -r vdate dur live chan title <<< "$info"
  case "$live" in is_live|is_upcoming|post_live) continue;; esac   # captions come after the stream is processed
  if [[ "$vdate" < "$START_DATE" ]] || [ "${dur%.*}" -lt 120 ] 2>/dev/null; then echo "$id" >> "$SEEN"; continue; fi
  # Ceremonies and promo videos on the city channel
  if echo "$title" | grep -qiE "swearing|ceremony|pet of the week|now you know|news brief|spotlight"; then echo "$id" >> "$SEEN"; continue; fi
  # Budget hearings run 8+ hours; too big to send and not part of the tracker yet.
  if echo "$title" | grep -qi "budget"; then echo "$id" >> "$SEEN"; log "skipped budget hearing $id $vdate"; continue; fi
  t=${title//\\/\\\\}; t=${t//\"/\\\"}
  meta="{\"videoId\":\"$id\",\"channelId\":\"$chan\",\"title\":\"$t\",\"date\":\"$vdate\",\"duration\":${dur%.*}}"
  # One caption track: the original-language one first (Kokomo's videos list it as en-orig), then plain English.
  f=""; out=""
  for lang in en-orig en; do
    out=$("$YTDLP" --skip-download --write-auto-subs --write-subs --sub-langs "$lang" --sub-format json3 --sleep-requests 1 -o "$TMP/$id.%(ext)s" "https://www.youtube.com/watch?v=$id" 2>&1)
    f=$(ls "$TMP/$id".*json3 2>/dev/null | head -1)
    if [ -n "$f" ] && [ "$(wc -c < "$f")" -gt 200 ]; then break; else rm -f "$TMP/$id".*json3; f=""; fi
    echo "$out" | grep -qiE "429|too many requests" && break
  done
  if echo "$out" | grep -qiE "429|too many requests" && [ -z "$f" ]; then
    log "YouTube is limiting requests right now; stopping here. The rest will be tried at the next run."
    break
  fi
  if [ -n "$f" ]; then
    out=$(curl -sS --max-time 60 -H "x-admin-code: $ADMIN_CODE" --form-string "meta=$meta" -F "subs=@$f;type=application/json" "$SITE/api/transcript")
    if echo "$out" | grep -q '"ok":true'; then echo "$id" >> "$SEEN"; sent=$((sent+1)); log "sent $id $vdate $title -> $out"; else log "FAILED $id: $out"; fi
  elif echo "$out" | grep -qiE "no subtitles|no automatic captions|There are no subtitles"; then
    # YouTube says this video has no captions. Give it two days to finish processing, then record it as having none.
    age=$(( ( $(date +%s) - $(date -j -f %Y%m%d "$vdate" +%s 2>/dev/null || date -d "$vdate" +%s 2>/dev/null || date +%s) ) / 86400 ))
    if [ "$age" -gt 2 ]; then
      meta="${meta%\}},\"noCaptions\":true,\"confirmed\":true}"
      curl -sS --max-time 30 -H "x-admin-code: $ADMIN_CODE" -H "content-type: application/json" -d "$meta" "$SITE/api/transcript" >/dev/null && echo "$id" >> "$SEEN"
      log "no captions $id $vdate $title"
    fi
  else
    log "couldn't get captions for $id $vdate (will retry): $(echo "$out" | grep -i error | head -1)"
  fi
done
[ -f "$TMP/marks" ] && while read -r m; do touch "$m"; done < "$TMP/marks"   # only after a full pass
log "done: sent $sent"
