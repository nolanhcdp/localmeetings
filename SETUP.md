# Vote Tracker — setup

One Vercel project, same pattern as Tally:

- **The review page** (`/admin.html`): every meeting Claude drafted, with the video and transcript beside it. You edit and approve.
- **The daily check** (`/api/cron`, every morning): finds new agenda packets on the county site and drafts up to two meetings that have everything they need.
- **The Mac job** (`mac/`): pulls new meeting transcripts from the county's YouTube channel every morning and sends them to the site. YouTube blocks this from servers, so it has to come from your home connection.
- **The browser button**: a backup for the Mac job. On a YouTube meeting video, one click sends the transcript.

What it covers for now: County Council and Board of Commissioners (agenda packet + official minutes + video), and Plan Commission (video only; the county doesn't post its agendas or minutes online). Budget hearings, the Drainage Board, BZA and other boards are recognized and set aside.

## 1. Deploy
1. Put this folder in a new private GitHub repo. The `data/` folder is test material and stays out (see `.gitignore`).
2. vercel.com: **Add New → Project**, import the repo, Framework Preset **Other**, deploy.
3. **Storage → Create Database → Upstash for Redis** (free plan), connect it to this project.

## 2. Settings
**Settings → Environment Variables:**

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your Claude key (a new one named `vote-tracker` makes costs easy to see) |
| `ADMIN_CODE` | a long private code for the review page and the Mac job |
| `CRON_SECRET` | any long random string; Vercel sends it with the daily check |
| `MODEL` | optional; defaults to `claude-sonnet-5-5` |

Then **Deployments → ⋯ → Redeploy**.

## 3. Load 2026
1. Open `your-site/admin.html`, enter your admin code, and click **Check county site now**. That creates the ~29 Council and Commissioners meetings that have packets.
2. In Terminal, run the Mac installer once:
   ```
   bash ~/Documents/"Vote Tracker"/mac/install.sh
   ```
   It asks for your site address and admin code, then sends every 2026 transcript (about 10 minutes the first time). After that it runs at 7:40 each morning, or when your Mac wakes.
3. Back on the review page, click **Draft all ready**. Each meeting takes about a minute; keep the tab open. Cost is roughly 25¢ per meeting, so about $8 for the year so far and under $1 a month after that.
4. Check **Unsorted videos**. A few untitled "LIVE" streams are other boards (Drainage, Stormwater, BZA). Mark them **Other board** so they stop showing up.

## Reviewing
- **To review** lists drafts oldest first. **Approve** saves the record and opens the next one.
- Yellow boxes are things Claude wants you to check (unclear audio, minutes and video disagree, a name it wasn't sure of).
- The ▶ buttons jump the video to that item. The transcript search on the right also jumps the video.
- **Issue key** ties items across meetings (e.g. `data-center-moratorium`). Approved items with the same key build one timeline under **Issues**; those become the public issue pages.
- Votes: names only go in "Voted yes" when there was a roll call. For voice votes, the note says how it went and anyone heard voting no.
- When official minutes show up after a draft (they come in the *next* meeting's packet), the daily check redrafts it automatically if you haven't edited it. If you have, the meeting shows a note and a **Redraft** button.

## Browser button
**Settings** on the review page has a **Send to Vote Tracker** link. Drag it to your bookmarks bar. On a meeting video on YouTube, click it; a small window confirms where it went.

## Files
- `lib/county.js`: the bodies, board members, the plain-language background Claude gets, and the starting glossary. Edit board members on the Settings page instead.
- `lib/claude.js`: the drafting instructions and the record format.
- `lib/pipeline.js`: finding packets, matching videos to meetings, drafting, approving, issue timelines.
- `mac/fetch-transcripts.sh`: the daily transcript job. Its log is at `~/Library/Application Support/VoteTracker/log.txt`.
- To stop the Mac job: `launchctl bootout gui/$(id -u)/com.votetracker.transcripts`
