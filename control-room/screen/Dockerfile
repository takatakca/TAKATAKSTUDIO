# TAKATAK Control Room — one screen: a complete KDE Plasma desktop (the same
# linuxserver/Selkies family as the Food Hub screens), pinned. Each screen is
# its own container with its own home folder (/config), so nothing one person
# does reaches another screen or the server.
#
# Inside: Chromium with the "IA TAKATAK" bookmarks, the Discover app store
# (Flathub, installs for the desktop user), files (Dolphin), editors (Kate,
# VS Code, Cursor), terminal (Konsole), git + GitHub CLI, Node 22 with the
# Claude Code and Codex command-line tools, and the screen recorder.
ARG BASE=lscr.io/linuxserver/webtop@sha256:c5f9ce2a045d9bf4ed34993ad72c327c4b66e2e97ca8b021af9f95f1c70ea46a
FROM ${BASE}

ARG CURSOR_DEB_URL=https://api2.cursor.sh/updates/download/golden/linux-x64-deb/cursor/latest
ARG VSCODE_DEB_URL=https://update.code.visualstudio.com/latest/linux-deb-x64/stable

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ffmpeg flatpak plasma-discover plasma-discover-backend-flatpak \
      git gh nodejs curl ca-certificates \
 && curl -fsSL -o /tmp/cursor.deb "$CURSOR_DEB_URL" \
 && curl -fsSL -o /tmp/vscode.deb "$VSCODE_DEB_URL" \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends /tmp/cursor.deb /tmp/vscode.deb \
 && npm install -g --no-fund --no-audit @anthropic-ai/claude-code @openai/codex \
 && (apt-get purge -y plasma-discover-backend-packagekit packagekit 2>/dev/null || true) \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* /tmp/* /root/.npm

COPY root/ /
RUN chmod +x /etc/s6-overlay/s6-rc.d/svc-recorder/run /custom-cont-init.d/*
