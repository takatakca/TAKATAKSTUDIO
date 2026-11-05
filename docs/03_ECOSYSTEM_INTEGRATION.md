# 03 — TAKATAKSTUDIO ecosystem integration

Date: 2026-11-05 (America/Toronto)
Signed: STUDIO-ENGINE — Codex
Status: implementation prepared; no production activation.

## Owner direction

TAKATAKSTUDIO is a resellable SaaS for client marketing and media production. TAKATAK V1 is the central account, workspace, permissions and commercial platform. TAK-TAK is the existing AI execution engine. KnowledgeAI supplies governed knowledge. Triple M is the owner's pilot, with Macyna, Mariella and Matthys; other clients supply their own cast and creative data.

## Discovery coverage

Inventoried 83 connected repositories. Inspected source/instructions in TAKATAKSTUDIO, takatak-v1, knowledgeAI and takatak-automate, plus README-level integration evidence in M4RKETING, SEOTAKATAK, Facturations and takatakbackend. This is not an exhaustive code audit of all 83 repositories. No private repository content was copied into this public dossier.

Inspected source heads:
- takatak-v1: 728e16f1cf72a33795a291d2f40dde53badb3182
- knowledgeAI: f2d48bd9ef51c3ea495cb5a8a7a8c0a981cdd9dd
- takatak-automate: 17c3a5ab29ce3845ccc8c4d35e4da37215c88150
- TAKATAKSTUDIO initial foundation: 0ba90a46674b5c87f374b28688f38ee09d18c947

## Reuse map

| Product | Actual inspected capability | Studio role |
| --- | --- | --- |
| takatak-v1 | Workspace auth, effective permissions, encrypted provider store, TAK-TAK routing, credits/refunds, saved AI outputs, social connections/approval queue | Canonical customer control plane and drafting gateway |
| knowledgeAI | Public curated search; isolated private scoped PostgreSQL/JWT service code and tests | Public engineering knowledge now; private client context after canonical grant/issuer and deployment verified |
| TAKATAKSTUDIO | Local projects, characters, three tracks, review, persistent events | Media production orchestration and request-pack exchange; local foundation is not a customer identity service |
| takatak-automate | Service intake, marketplace/contract orchestration, webhooks | Potential managed-service/freelancer escalation; do not use as another customer master |
| M4RKETING | Clover merchant segmentation, managed discounts and approval-oriented campaign drafts | Optional customer campaign distribution context, not a universal publishing engine |
| SEOTAKATAK | Tenant-scoped SEO sites, opportunities, briefs, reviewed service token contract | Optional SEO briefs and feedback integration; real deployment must be verified separately |
| Facturations | Dedicated draft/invoice/provider evidence lifecycle | Keep invoicing separate; no Studio-created invoice issuance or payment authority |
| takatakbackend | Legacy Express/Mongo API with identity cutover pending | Do not use legacy registration as Studio's identity authority |

Readiness is source evidence, not a live production audit. Provider catalog presence and saved keys do not prove working provider access or commercial resale rights. The inspected catalogue marks some tools non-client-billable; Studio must retain those exclusions. Exact Songer/Songr account/product still needs identification.

## Private KnowledgeAI integration discovery

Open V1 PR #194 (feature/knowledgeai-issuer-20261016) and #195 (feat/knowledgeai-private-auth-20261016) define conflicting grants/token/JWKS contracts. Neither is on inspected main. Do not merge both or create a competing issuer. Prefer a reviewed V1 server-side private search proxy after canonical consolidation. Confidential retrieval, private runtime and real tenant grants were not verified here. The public KnowledgeAI API must never receive customer briefs, private files or tokens.

## Implemented V1 candidate

Branch: feat/takatakstudio-v1-workspace-20261105.
New customer page `/dashboard/studio` and workspace-scoped `/api/studio/projects`, `/api/studio/generate` use existing V1 auth, provider routing, credits and saved outputs. Independent actions draft a video script, storybook outline/opening spread, and lyrics/composition brief. No new schema migration. Rollout flag off by default; Studio-specific SKU/entitlements remain a commercialization milestone.

Request-pack v1 imports/exports carry creative data only. V1 ignores imported tenant IDs and job/approval states. Studio import creates new queued tracks and pins imported character snapshots per project without changing global character profiles. This is explicit two-way FILE EXCHANGE, not continuous automatic server-to-server synchronization.

## Verification

PASS: 11 V1 contract/service tests with mock relay, pure-module strict semantic check, TS/TSX syntax checks. PASS: 8 Studio engine/HTTP tests, including imported-authority rejection and snapshot preservation; browser script syntax check. No browser QA, complete V1 framework build, live DB/provider, render/upload or publishing test performed.

Automatic approval review rejected dependency installation with lifecycle scripts, citing supply-chain risk and its classification of the request as read-only. No installation workaround was attempted. Candidate commits use `[skip ci]` to avoid indirectly triggering the same installation through remote workflows. Full dependency/typecheck/build authorization is an explicit outstanding validation step.

## Next build sequence

1. Review candidate and authorize full dependency/framework checks; verify exact source revision.
2. Define per-client Studio SKU, entitlement, plan allowances and concurrency/spend reservations in V1.
3. Consolidate KnowledgeAI #194/#195; test two real staging workspaces and revocation before private retrieval.
4. Implement authenticated service job exchange, durable leases, artifact storage, render workers and reconciliation.
5. Produce one end-to-end pilot across video, book and music; proof commercial rights and export quality.
6. Add authorized YouTube upload, KDP-ready export review and unattended schedules with bounded cost/volume.

Signed: STUDIO-ENGINE — Codex
