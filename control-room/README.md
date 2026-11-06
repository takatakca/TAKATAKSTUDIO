# TAKATAK — Salle de contrôle

Six virtual screens for the TAKATAK team (**takatak**, **sheroz**, **abdullah**). Each screen is a **complete, separate computer**: a KDE desktop with its own folders, its own apps and its own signed-in ChatGPT, Claude, GitHub and Cursor accounts. It reuses the Food Hub screens technology (`takatakca/foodhubca`, `deploy/screens`):

- the same family of images, `linuxserver` + Selkies streaming (here `webtop` KDE, pinned);
- the same `/s01/` … `/s06/` addresses;
- the same wall: 1, 2, 3, 4 or 6 screens, **Onglets**, and **Personnalisé** (a 12 × 12 board where you move and resize each screen);
- the same shared layout.

In each screen:

- **App store**: Discover, connected to Flathub (thousands of apps: Slack, Discord, Zoom, Obsidian, LibreOffice, GIMP, OBS…). Installs go to the screen's user folder, no administrator needed.
- **Already installed**:
  - **Chromium**, opening on ChatGPT, Claude, GitHub and Cursor, with the **"IA TAKATAK"** bar of 53 AI sites (assistants, code, images, video, voice, API consoles). Any of them can be installed as its own window (⋮ → "Install the app").
  - **Cursor** and **VS Code** (desktop apps), **git** and **GitHub CLI** (`gh`) to save, edit and push.
  - **Claude Code** (`claude`) and **Codex** (`codex`) in the terminal (Konsole).
  - Dolphin (files), Kate (text).
- **Folders**: Desktop, Documents, Downloads, Projets, Images, Vidéos. Everything is kept in the screen's volume (`screen-N`) across restarts and updates.
- **Separate**: one screen = one container. What happens in one never touches the others or the server.
- Official ChatGPT, Claude and Copilot desktop apps exist only for Windows and Mac; their web versions have the same features. A Windows screen (Microsoft Store) remains possible later, at higher cost.

Added for the team:

- 3 accounts only. Each person chooses their own password, and **a code is sent by SMS at every login**.
- A screen belongs to whoever takes it ("Prendre"). Nobody else sees it until they release it. The administrator can force a release or block a screen.
- **Recording**: the webcam must be on to work, and every screen held is recorded (video of the screen). Notes and an access log are kept as well.
- **After 30 days**, the recordings go to Google Drive and are deleted from the server, only after the upload is verified.

> Recording people requires informing them (Québec, Law 25). The login page shows the notice. Keep each person's written consent.

## Contents

| Folder | What it is |
|---|---|
| `app/` | The Salle de contrôle web app (Node 22, no dependencies): accounts, SMS, locks, camera, notes, wall, protected relay to the screens. |
| `screen/` | A screen's image: KDE desktop + Discover/Flathub + Cursor, VS Code, git/gh, Claude Code, Codex + the recorder. |
| `archiver/` | rclone: 30 days on the server, then Google Drive. |
| `docker-compose.yml` | The whole stack for Coolify. |
| `docker-compose.dev.yml` | Local trial only (codes in the log, 2 screens). Never deploy it. |

## Deploy on Coolify (the second server, never the TAKATAK-V1 one)

1. **New resource → Docker Compose**, source this repository. Compose file: `control-room/docker-compose.yml`.
2. **Domain**: on the `control-room` service only (port 8080), for example `https://salle.takatak.ca`. Screens get no domain.
3. **Variables**: the ones in `.env.example`.
   - `PUBLIC_ORIGIN` = the exact domain.
   - `SCREEN_PASSWORD` = a long random value (`openssl rand -hex 24`).
4. **Twilio Verify**: Twilio Console → Verify → Services → create "TAKATAK Salle de contrôle". Copy its SID into `TWILIO_VERIFY_SERVICE_SID`, along with the account SID and auth token.
5. **Google Drive**:
   - on a computer, run `rclone authorize "drive"`, sign in with the Google account that will hold the archives, and paste the JSON it prints into `GDRIVE_RCLONE_TOKEN`;
   - without it, nothing is archived **and nothing is deleted**.
6. **Server**: about **24–32 GB of RAM and 8 vCPU** for 6 KDE desktops (≈ 3–4 GB each when in use, with Cursor and Chromium open). Plan at least 200 GB of disk: apps installed from the store and 30 days of recordings.
   The screens use `seccomp`, `apparmor` and `systempaths=unconfined`. Flathub's app isolation (bubblewrap) needs these. They stay **unprivileged**: no `--privileged`, no host device, no published port.
7. **Deploy**, then in Coolify → `control-room` → **Terminal**:

   ```sh
   node bin/admin.mjs prepare takatak  <email> <+1XXXXXXXXXX>
   node bin/admin.mjs prepare sheroz   <email> <+1XXXXXXXXXX>
   node bin/admin.mjs prepare abdullah <email> <+1XXXXXXXXXX>
   ```

   Each command prints a one-time link (48 h). Send it to the person: they choose their password there. Then they log in with password + SMS code.
   - `node bin/admin.mjs status` shows the accounts and screens.
   - `node bin/admin.mjs logout-all` signs everyone out.
8. **Accounts inside the screens**: log in, take each screen and **type in the ChatGPT, Claude, GitHub and Cursor accounts yourself**, plus `gh auth login` in the terminal to push to GitHub. Each screen keeps its own sign-ins (`screen-N` volume) after restarts. Never send these passwords by chat or email.
9. **Files**: the Selkies sidebar of each screen (left edge) has the "Upload" and "Download" buttons for sending files from your computer and retrieving them (present in Selkies, to be tested end to end on the server). Inside the screen, Dolphin handles the folders.

## Using it

- **1 / 2 / 3 / 4 / 6**: grid. Drag a screen's title bar onto another to swap them. Double-click a title bar to put that screen on its own in tabs.
- **Onglets**: one large screen, the others as tabs.
- **Personnalisé → Arranger**:
  - move a screen by dragging it, and resize it from its bottom-right corner;
  - from the keyboard: arrows move, Shift + arrows resize;
  - "Grille égale" redistributes the screens; "+ Écran N" adds a screen to the board, ✕ removes it.
- **Partager la disposition** (administrator): the layout becomes the starting point for every device. **Disposition partagée** brings it back to this device.
- **Journal**: notes (everyone). The administrator also sees the access log and recordings.

## Security in brief

- Passwords are scrypt hashes. Sessions and links are stored hashed. Cookies are `HttpOnly; SameSite=Strict; Secure`. Every write checks the Origin. A strict CSP is set.
- 5 failed attempts lock the account for 15 minutes. An SMS code allows 5 attempts and expires after 10 minutes.
- The screens publish no port. They are reachable only through the Salle de contrôle, and only by whoever holds them. The screen password is added by the server and never reaches a browser.
- A screen is released if the camera stops (45 s) or if the page no longer responds (90 s). The open connection is then cut.

## Local test

```sh
cd control-room/app && npm test          # 16 tests, no Docker
cd control-room
printf 'SCREEN_PASSWORD=%s\nPUBLIC_ORIGIN=http://127.0.0.1:8080\n' "$(openssl rand -hex 16)" > /tmp/cr.env
docker compose --env-file /tmp/cr.env -f docker-compose.yml -f docker-compose.dev.yml up -d --build
docker compose --env-file /tmp/cr.env -f docker-compose.yml -f docker-compose.dev.yml exec control-room node bin/admin.mjs prepare takatak you@example.ca +15145550100
# Open http://127.0.0.1:8080 (exactly this address). The SMS code appears in: docker compose ... logs control-room
```
