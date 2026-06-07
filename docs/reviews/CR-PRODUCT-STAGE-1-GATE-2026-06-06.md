# Product Stage 1 Gate Review - 2026-06-06

## Scope

This review verifies the first-stage product improvement boundary and the follow-up narrowing: product contract, user validation script, safer sharing defaults, local result feedback, public deployment safety and Agent API positioning. A 2026-06-07 follow-up records residual gate checks that do not require billable image generation or a fresh deployment, plus the remaining local Docker smoke blocker.

## Evidence

| Check | Command | Exit | Result |
| --- | --- | --- | --- |
| Full local gate | `npm run verify` | 0 | `version:check`, `test`, `lint`, `lint:scripts`, `build`, `diff-check` and `diff-cached-check` passed. |
| Local browser check | `http://localhost:4784` | 0 | Recent history card rendered `结果反馈`, `可用`, `需修改` and the matching mark buttons on a real browser page. |
| Targeted result feedback tests | `node --test --import tsx src/components/history-panel.test.tsx src/lib/history-metadata.test.ts` | 0 | 22 tests passed, covering local result feedback markers and history metadata helpers. |
| Share dialog defaults | `node --test --import tsx src/components/share-dialog.test.tsx` | 0 | 2 tests passed, covering default 1-day expiry and no-access-code risk copy. |
| Share API contract | `node --test --import tsx src/app/api/shares/route.test.ts` | 0 | 21 tests passed, covering share creation, access-code behavior, expiry and content serving. |
| Script tests | `npm run test:scripts` | 0 | 187 tests passed. |
| HF Space local doctor | `npm run doctor:hf-space -- --skip-remote` | 0 | Local checks passed; remote Space checks were intentionally skipped. |
| HF Space remote doctor | `npm run doctor:hf-space` | 0 | 2026-06-07 follow-up passed. Remote Space was accessible; remote variables matched the Space-free runtime contract; `remote-secrets` confirmed `APP_PASSWORD` and `AGENT_API_TOKEN`; generation credential was configured. |
| Repository status | `npm run status` | 0 | 2026-06-07 follow-up passed. Branch was `codex/product-improvement-planning-only`, `head=4ea14f3`, `dirty=false`, and all 5 independent real-smoke cases were configured. |
| Agent API non-billable doctor | `npm run agent:doctor` | 0 | 2026-06-07 follow-up passed. Capabilities, contract check, runtime backend and state backend passed; billable smoke checks were skipped with `requires --allow-billable`. |
| Independent upstream dry-run readiness | `npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local` | 0 | 2026-06-07 follow-up passed without billable calls. The report returned `ok=true`, `billable=false`, `configuration_complete=true` and five configured independent targets, but all five cases were skipped with `requires --allow-billable`; `final_gate_satisfied=false`. |
| Independent upstream final gate without billable authorization | `npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --require-independent-targets` | 1 | Expected failure. The report returned `billable=false`, `configuration_complete=true`, `missing_required_count=5` and `skipped_required_cases` for `original-images-json`, `gaoren-images-sse`, `sub2api-images-sse`, `sub2api-responses-json` and `gpt2image-responses-sse`; no real image generation was authorized. |
| Local upstream fixture final gate | `npm run smoke:image-upstream-local` | 0 | 2026-06-07 follow-up passed. Local fixture covered all 5 independent cases and returned `local_fixture=true`, `configuration_complete=true`, `final_gate_satisfied=true`; this verifies the final-gate script path, not third-party upstream availability. |
| HF Space local container smoke | `npm run smoke:hf-space` | 1 | 2026-06-07 follow-up failed during Docker build before app smoke execution. BuildKit and legacy builder both failed at `apk add --no-cache python3 make g++ pkgconfig` with Alpine package `I/O error` or `TLS: unspecified error`; a separate `docker run --rm node:24-alpine ... apk add ...` probe returned `apk-ok`. |
| Diff check | `git diff --check` | 0 | No whitespace or patch-format issues. |

## Product Contract

- First user: `docs/product/product-contract.md` now defines the first real user as a Chinese content operator who repeatedly produces first publish visuals for Xiaohongshu notes, product detail pages or campaign posters.
- Non-goals: public SaaS, enterprise asset approval systems, autonomous Agent scheduling and generic OpenAI-compatible benchmarking are explicitly outside Stage 1.
- Core workflow: choose a real publish topic, write prompt, generate or edit, inspect the central preview, mark recent output as `可用` or `需修改`, then continue editing, reuse or download.
- Metrics: the contract records third-minute generation, thirtieth-minute reuse, third-day return, result quality marking and explicit failure-recovery expectations.
- Evidence standard: `docs/product/user-validation-script.md` uses past-behavior and task evidence rather than opinion prompts.

## Share Safety

- Default expiry: `src/components/share-dialog.tsx` exports `DEFAULT_SHARE_EXPIRY_VALUE = '1440'`, making new share links default to a 1-day expiry.
- No-access-code warning: `share.publicRiskHint` appears in both Chinese and English copy and is rendered below the access-code input.
- Server-side protected content behavior: the share route test suite still covers access-code validation, expiry handling and image-content serving behavior; no server response contract was changed in this stage.

## Public Deployment

- `APP_PASSWORD` gate: README, customer instructions and HF Space docs all state that public customer-visible deployments must configure page access protection.
- `AGENT_API_TOKEN` gate: Agent-facing automation must configure an Agent token when exposed publicly; the full remote doctor confirmed the target Space currently has this secret.
- Free-tier persistence boundary: HF Space docs keep `memory` mode and temporary file-system behavior visible; this is not represented as production-grade persistence.
- Remote Space evidence: the 2026-06-07 `npm run doctor:hf-space` follow-up returned `remote-secrets` pass for `APP_PASSWORD` and `AGENT_API_TOKEN`, but `npm run deploy:space` plus a real browser check are still required for customer-visible readiness.
- Local container smoke evidence: `npm run smoke:hf-space` did not reach the app smoke assertions because Docker build failed while installing Alpine packages. The minimal `node:24-alpine` container can install the same packages, so this is recorded as a local Docker build-layer blocker rather than an application contract failure.

## Agent API Boundary

- Automation API wording: README and skill docs describe Agent API as a machine interface for automation clients.
- Non-goals: docs explicitly say this is not an autonomous Agent platform, long-running scheduler, cross-instance persistent queue or production orchestration layer.
- Existing contract preserved: this stage did not modify `/api/agent/*` schema or Agent route implementation files.

## Residual Risks

- Real 5 to 10 user validation has not been executed. The script exists, but the evidence table is not populated with actual target-user sessions.
- Independent real upstream configuration is complete, but real billable upstream image generation has not been executed in this gate. The final command remains `npm run smoke:image-upstream-real -- --env-file-if-exists .env.real-smoke.local --require-independent-targets --allow-billable`, which requires explicit user authorization because it can trigger billable image generation.
- `npm run deploy:space` and a real browser check were not executed for the follow-up narrowing. The remote doctor confirms configuration and accessibility, but it does not prove a fresh deployment from this branch or a customer-visible Space session.
- HF Space local container smoke remains blocked in this workstation's Docker build path by Alpine `apk` I/O/TLS errors before app startup. This still needs a clean Docker build environment or Docker Desktop/build cache repair before it can be used as evidence.
- The new local result feedback loop is client-side metadata only; it does not change server contracts or persist beyond the current history storage path.
- Multi-instance persistence, production object storage and customer SaaS readiness remain outside Stage 1 by product contract.
