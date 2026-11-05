# Run TAKATAKSTUDIO

Requires Python 3.10 or newer. No third-party packages are required for this foundation.

```sh
python3 server.py
```

Open http://127.0.0.1:8787 on the same computer. This first version intentionally binds to loopback; it is not yet an online Android-accessible deployment.

1. Create a production with a title, brief, language and intended audience.
2. The engine creates independent video, book and music jobs in one transaction.
3. Define Macyna, Mariella and Matthys under Characters; unknown attributes start blank.
4. Enter a script, manuscript or lyrics and save it.
5. Request editorial review, then approve after reviewing. Editing clears approval.
6. Set a target date to add the track to the planning calendar.
7. Export a production request pack as JSON for provider handoff.

“Check generation readiness” records the current missing-provider blocker. It does not call an AI provider, incur a charge or produce assets. Approval is approval of a text draft only. The calendar does not schedule a YouTube upload. Connections are status information rather than working OAuth buttons.

## Persistence

SQLite records live in `data/studio.sqlite3` by default. Keep that directory backed up and out of Git. `STUDIO_DB` can select another database path; `STUDIO_PORT` can change the port. Close the server before copying the database or use SQLite's online backup API (WAL mode can have data in sidecar files).

## Verify

```sh
python3 -m unittest discover -s tests -v
```

Tests use temporary databases and an ephemeral loopback HTTP server. They do not contact external providers.

## Next implementation milestones

- Production identity and access controls, durable object storage and deployment.
- Character revisions pinned to jobs; track dependencies and immutable asset records.
- Provider interface with idempotency, bounded retries, job leasing/recovery and cost limits.
- Real generation and rendering: script/image/narration/music adapters, video worker, print-ready layout.
- Authorized YouTube OAuth and upload receipts with reconciliation after timeout.
- Book export proofs and KDP submission workflow.

Signed: STUDIO-ENGINE — Codex, 2026-11-05.
