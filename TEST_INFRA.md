# E2E Test Infra: 润笔 (Runbi) Multi-Platform Architecture

## Test Philosophy
- Opaque-box, requirement-driven, multi-platform verification.
- Covers Shared Core logic, Platform Adapters, Chrome Extension MV3, and Tauri 2.x + Rust Desktop Client.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial + Real-World Workloads + White-Box Adversarial Stress (Tier 5).

---

## Feature Inventory & Test Mapping

| # | Feature | Requirement Source | Tier 1 (Coverage) | Tier 2 (Boundaries) | Tier 3 (Cross-Platform) | Tier 4 (Workloads) |
|---|---------|-------------------|:-----------------:|:-------------------:|:------------------------:|:------------------:|
| F1 | Myers CJK Diff Engine | Shared Core §1.1 | 5 tests | 5 tests | ✓ | ✓ |
| F2 | Selection Validation & Normalization | Shared Core §1.1 | 5 tests | 5 tests | ✓ | ✓ |
| F3 | Prompt Presets & Custom Instructions | Shared Core §1.1 | 5 tests | 5 tests | ✓ | ✓ |
| F4 | Mock Streaming Generator | Shared Core §1.1 | 5 tests | 5 tests | ✓ | ✓ |
| F5 | Viewport & Multi-Monitor Math | Shared Core §1.1 | 5 tests | 5 tests | ✓ | ✓ |
| F6 | Platform Adapter Contracts | Adapters §1.2 | 5 tests | 5 tests | ✓ | ✓ |
| F7 | Shared React UI Components | Shared UI §1.3 | 5 tests | 5 tests | ✓ | ✓ |
| F8 | Extension DOM Selection Provider | Extension §2.1 | 5 tests | 5 tests | ✓ | ✓ |
| F9 | Extension DOM Text Replacer | Extension §2.1 | 5 tests | 5 tests | ✓ | ✓ |
| F10 | Extension Storage & LLM Port | Extension §2.1 | 5 tests | 5 tests | ✓ | ✓ |
| F11 | Extension Shadow DOM Isolation | Extension §2.2 | 5 tests | 5 tests | ✓ | ✓ |
| F12 | Desktop Tauri Window & Lifecycle | Desktop §3.1 | 5 tests | 5 tests | ✓ | ✓ |
| F13 | Desktop Win32 Selection Grab | Desktop §3.2 | 5 tests | 5 tests | ✓ | ✓ |
| F14 | Desktop Win32 Text Replacement | Desktop §3.2 | 5 tests | 5 tests | ✓ | ✓ |
| F15 | Desktop Multi-Monitor Cursor Clamp | Desktop §3.3 | 5 tests | 5 tests | ✓ | ✓ |
| F16 | Desktop Adapters & IPC Transport | Desktop §3.4 | 5 tests | 5 tests | ✓ | ✓ |
| F17 | Desktop Raycast Glassmorphism UI | Desktop §3.5 | 5 tests | 5 tests | ✓ | ✓ |

---

## Test Architecture

### Test Runner & Invocation
- Vitest configuration running across all workspaces.
- Node.js & TypeScript static typechecks (`tsc --noEmit`).
- Rust cargo checks (`cargo check --manifest-path desktop/src-tauri/Cargo.toml`).
- Execution Command: `npm test` or `npx vitest run`

### Directory Layout
```
tests/
├── unit/
│   ├── shared-diff.test.ts
│   ├── shared-selection.test.ts
│   ├── shared-prompts.test.ts
│   ├── shared-mockStream.test.ts
│   ├── shared-position.test.ts
│   ├── adapters-contract.test.ts
│   └── components.test.tsx
├── e2e/
│   ├── tier1-feature-coverage.test.ts
│   ├── tier2-boundary-corner.test.ts
│   ├── tier3-cross-platform.test.ts
│   ├── tier4-real-world-workloads.test.ts
│   └── tier5-adversarial-stress.test.ts
```

---

## Test Coverage Thresholds
- **Tier 1 (Feature Coverage)**: ≥ 85 test cases (≥5 per feature across 17 features)
- **Tier 2 (Boundary & Corner Cases)**: ≥ 85 test cases (empty strings, extreme unicode, multi-monitor negative coordinates, CJK mixed punctuation, rapid cancellation, etc.)
- **Tier 3 (Cross-Feature & Cross-Platform Interactions)**: ≥ 20 test cases
- **Tier 4 (Real-World Workloads)**: ≥ 10 realistic end-to-end scenarios (Academic paper revision, Business email rewrite, Code diff annotation, Multilingual translation, etc.)
- **Tier 5 (Adversarial Stress & White-box Hardening)**: ≥ 15 stress tests
- **Total Minimum Test Count**: ≥ 215 automated tests
