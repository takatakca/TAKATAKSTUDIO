# TAKATAK Control Room — one virtual screen: the same Chromium image as the
# Food Hub screens (takatakca/foodhubca deploy/screens), pinned, plus ffmpeg
# and a recorder service that records the screen while someone holds it.
FROM lscr.io/linuxserver/chromium@sha256:59d1bfa98a6ab759fce078e5a714de3920f4c618b8939a0df6e1dec7d25c7aba

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* /tmp/*

COPY root/ /
RUN chmod +x /etc/s6-overlay/s6-rc.d/svc-recorder/run /custom-cont-init.d/*
