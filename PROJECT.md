# Project: 润笔 (Runbi) Multi-Platform Architecture

## Architecture

Runbi is an AI-powered text polishing tool built on a **"Shared Core + Platform Adapters"** architecture supporting both **Chrome Extension (Manifest V3)** and **Desktop Client (Tauri 2.x + Rust)**, with forward compatibility for Web SaaS and CLI.

### System Architecture Diagram
```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     Presentation Layer (UI)                                     │
│  ┌──────────────────────────────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │ Chrome Extension (Shadow DOM / MV3 Injected UI)  │  │ Tauri 2.x Desktop (Raycast Window)  │  │
│  └──────────────────────────┬───────────────────────┘  └──────────────────┬──────────────────┘  │
│                             │                                             │                     │
│                             ▼                                             ▼                     │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                     Shared UI Components (@runbi/shared/components)                       │  │
│  │  - PolishPanel        - StyleTabs          - StreamingView     - DiffViewer               │  │
│  │  - InstructionInput   - ActionBar          - Toast             - OriginalPreview          │  │
│  └──────────────────────────────────────────┬────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────┼───────────────────────────────────────────────────┘
                                              │ depends on
┌─────────────────────────────────────────────▼───────────────────────────────────────────────────┐
│                                     Core Pure Logic Layer                                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                     Shared Core Engines (@runbi/shared/core)                              │  │
│  │  - CJK Myers Diff Engine        - Selection Validator     - Prompt Preset Builder         │  │
│  │  - Mock Streaming Generator     - Token Counter           - Viewport/Monitor Clamp Math   │  │
│  └──────────────────────────────────────────┬────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────┼───────────────────────────────────────────────────┘
                                              │ depends on abstractions
┌─────────────────────────────────────────────▼───────────────────────────────────────────────────┐
│                                 Platform Adapter Contracts                                      │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                     Abstract Interfaces (@runbi/shared/adapters)                          │  │
│  │  - ISelectionProvider       - ITextReplacer       - IStorageProvider     - ILLMTransport  │  │
│  └──────────────────────────▲─────────────────────────────────────────────▲──────────────────┘  │
└─────────────────────────────┼─────────────────────────────────────────────┼─────────────────────┘
                              │ implemented by                              │ implemented by
┌─────────────────────────────┴─────────────────────────┐ ┌─────────────────┴─────────────────────┐
│               Chrome Extension Adapters               │ │             Tauri Desktop Adapters            │
│  - ChromeDOMSelectionProvider                         │ │  - TauriSelectionProvider (Win32 / SendInput) │
│  - DOMTextReplacer (Input, Textarea, ContentEditable) │ │  - TauriTextReplacer (Win32 Clipboard/Paste)  │
│  - ChromeStorageProvider (chrome.storage.local)        │ │  - TauriStorageProvider (tauri-plugin-store)  │
│  - ChromePortLLMTransport (Service Worker Port)       │ │  - TauriIPCLLMTransport (Rust Reqwest / SSE)  │
└───────────────────────────────────────────────────────┘ └───────────────────────────────────────┘
```

---

## Feature Inventory

Every feature required for the multi-platform Runbi project is mapped below:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Shared Types & Models | Unified interfaces for selection, diff, stream messages, polish styles, settings | M1 | Survey |
| 2 | Pure Algorithmic Core | Myers CJK Diff, Selection validator, Prompt templates builder, Mock streaming generator, Viewport/Monitor math | M1 | Survey |
| 3 | Platform Adapter Contracts | `ISelectionProvider`, `ITextReplacer`, `IStorageProvider`, `ILLMTransport` interfaces | M1 | Survey |
| 4 | Platform-Agnostic React Components | `PolishPanel`, `StyleTabs`, `StreamingView`, `DiffViewer`, `ActionBar`, `InstructionInput`, `Toast`, `OriginalPreview` | M1 | Survey |
| 5 | Monorepo & TSConfig Path Aliases | Root workspace configuration, `@runbi/shared` path mapping, build scripts | M1 | Survey |
| 6 | Chrome Extension Adapter Implementations | `ChromeDOMSelectionProvider`, `DOMTextReplacer`, `ChromeStorageProvider`, `ChromePortLLMTransport` | M2 | Survey |
| 7 | Chrome Extension App Refactor | Update `src/content/App.tsx`, `src/popup/`, `src/options/` to consume `@runbi/shared` and extension adapters | M2 | Survey |
| 8 | Chrome MV3 Scaffolding & Hostile Testbed | Verify Extension build, CSS isolation in `#shadow-root`, and testbed functionality | M2 | Survey |
| 9 | Tauri 2.x Project Scaffolding | `desktop/` directory setup with React 18, Vite 5, Tailwind CSS, `@runbi/shared` integration | M3 | Survey |
| 10 | Tauri 2.x Window & Tray Configuration | `tauri.conf.json` with frameless, transparent, alwaysOnTop, skipTaskbar, hidden on start, system tray | M3 | Survey |
| 11 | Rust Backend Global Shortcut & Lifecycle | `tauri-plugin-global-shortcut` (Alt+Space), window show/hide toggle, focus loss (`Focused(false)`) auto-hide | M3 | Survey |
| 12 | Rust Win32 Selection Grab & Text Replacer | Simulated `Ctrl+C` text grab with clipboard preservation; `Ctrl+V` text replace via `SendInput` | M3 | Survey |
| 13 | Rust Multi-Monitor Cursor Positioning | `GetCursorPos` + `MonitorFromPoint` work area boundary clamping to prevent off-screen clipping | M3 | Survey |
| 14 | Desktop Adapters Implementation | `TauriSelectionProvider`, `TauriTextReplacer`, `TauriStorageProvider`, `TauriIPCLLMTransport` | M3 | Survey |
| 15 | Raycast / Spotlight Glassmorphic UI | Dark glassmorphism floating window with jade glowing accents, keyboard navigation, smooth transitions | M3 | Survey |
| 16 | Comprehensive E2E Test Pass (Tiers 1-4) | 100% test pass on feature coverage, edge cases, cross-platform interactions, and realistic workloads | M4 | Survey |
| 17 | Adversarial Hardening (Tier 5) | White-box stress tests for diff edge cases, unicode/emoji handling, concurrency, and error recovery | M4 | Survey |
| 18 | Documentation & Git Deliverables | `desktop/README.md`, root `README.md`, architecture documentation, clean atomic Git commits, push guide | M4 | Survey |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Shared Core & Platform Adapter Interfaces | Extract `shared/` package (types, core algorithms, adapter interfaces, platform-agnostic React components), configure root tsconfig path aliases (`@runbi/shared`), and verify shared unit tests | none | DONE |
| M2 | Extension Platform Adapters & Refactor | Implement Chrome MV3 adapters (`src/adapters/`), refactor extension to use `@runbi/shared`, verify extension build and tests | M1 | DONE |
| M3 | Tauri 2.x + Rust Desktop Client | Construct `desktop/` (Tauri 2.x backend, Rust Win32 WH_MOUSE_LL mouse hook selection grab/replace, Reqwest SSE streaming IPC, cursor clamp, tray, global shortcut, Raycast UI, desktop adapters), verify typecheck and build | M1 | DONE |
| M4 | E2E Integration, Hardening, Docs & Git Deliverable | Run full E2E test suite (Tiers 1-4), Tier 5 adversarial hardening, complete `desktop/README.md` and root docs, initialize git repository with atomic commits | M1, M2, M3 | DONE |

---

## Interface Contracts

### 1. Selection Provider Interface (`shared/adapters/selection.ts`)
```typescript
import { SelectionInfo } from '../types/selection';

export interface ISelectionProvider {
  /**
   * Retrieves current text selection and its bounding coordinates / context.
   */
  getSelection(): Promise<SelectionInfo | null>;

  /**
   * Subscribes to selection change events (optional for push-based selection like browser DOM).
   */
  subscribeToSelectionChange?(callback: (selection: SelectionInfo | null) => void): () => void;

  /**
   * Clears or cancels the active selection.
   */
  clearSelection(): Promise<void>;
}
```

### 2. Text Replacer Interface (`shared/adapters/replacer.ts`)
```typescript
import { SelectionInfo } from '../types/selection';

export interface ReplacementResult {
  success: boolean;
  error?: string;
}

export interface ITextReplacer {
  /**
   * Replaces the selected text with the new polished text.
   */
  replaceText(newText: string, context?: SelectionInfo | null): Promise<ReplacementResult>;

  /**
   * Checks if in-place text replacement is currently possible.
   */
  canReplace(context?: SelectionInfo | null): Promise<boolean>;
}
```

### 3. Storage Provider Interface (`shared/adapters/storage.ts`)
```typescript
export interface IStorageProvider {
  /**
   * Retrieves a typed value by key.
   */
  get<T>(key: string, defaultValue?: T): Promise<T>;

  /**
   * Stores a typed value by key.
   */
  set<T>(key: string, value: T): Promise<void>;

  /**
   * Removes a key from storage.
   */
  remove(key: string): Promise<void>;

  /**
   * Subscribes to storage changes.
   */
  subscribe<T>(key: string, callback: (newValue: T, oldValue: T) => void): () => void;
}
```

### 4. LLM Transport Interface (`shared/adapters/transport.ts`)
```typescript
import { StreamConfig, StreamServerMessage } from '../types/stream';

export interface LLMStreamRequest {
  text: string;
  config: StreamConfig;
}

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
  onDone: (durationMs: number, totalTokens: number) => void;
  onError: (error: string) => void;
  onAbort?: () => void;
}

export interface ILLMTransport {
  /**
   * Starts a streaming chat completion.
   */
  streamChat(
    request: LLMStreamRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<void>;

  /**
   * Tests connection with given provider configuration.
   */
  testConnection(config: StreamConfig): Promise<{ success: boolean; latencyMs?: number; error?: string }>;
}
```

---

## Code Layout

```
d:/FDE/Runbi/
├── shared/                       # 100% Platform-Agnostic Shared Module (@runbi/shared)
│   ├── index.ts                  # Main barrel export
│   ├── package.json              # Shared package definition
│   ├── adapters/                 # Abstract Interface Definitions
│   │   ├── selection.ts          # ISelectionProvider
│   │   ├── replacer.ts           # ITextReplacer
│   │   ├── storage.ts            # IStorageProvider
│   │   ├── transport.ts          # ILLMTransport
│   │   └── index.ts
│   ├── core/                     # Pure Logic & Algorithmic Engines
│   │   ├── diff.ts               # CJK-Aware Myers Diff
│   │   ├── prompts.ts            # 6+ Scene Prompt Templates & Custom Instruction Builder
│   │   ├── mockStream.ts         # Zero-config Mock Streaming Engine
│   │   ├── selection.ts          # Validation & text cleaning
│   │   ├── position.ts           # Coordinate math & viewport clamping
│   │   └── index.ts
│   ├── components/               # Pure React Presentation Components
│   │   ├── PolishPanel.tsx       # Main polishing modal container
│   │   ├── StyleTabs.tsx         # 6 Scene Style Tabs
│   │   ├── StreamingView.tsx     # Typewriter streaming with token / elapsed stats
│   │   ├── DiffViewer.tsx        # CJK Diff side-by-side / inline viewer
│   │   ├── ActionBar.tsx         # Copy, Replace, Regenerate buttons
│   │   ├── InstructionInput.tsx  # Natural language instruction bar
│   │   ├── OriginalPreview.tsx   # Collapsible original text display
│   │   ├── Toast.tsx             # Popover status feedback
│   │   └── index.ts
│   └── types/                    # Shared TypeScript Types
│       ├── selection.ts
│       ├── diff.ts
│       ├── stream.ts
│       ├── settings.ts
│       └── index.ts
├── src/                          # Chrome Extension Manifest V3 App
│   ├── adapters/                 # Extension-Specific Platform Adapters
│   │   ├── ChromeDOMSelectionProvider.ts
│   │   ├── DOMTextReplacer.ts
│   │   ├── ChromeStorageProvider.ts
│   │   ├── ChromePortLLMTransport.ts
│   │   └── index.ts
│   ├── background/               # MV3 Background Service Worker
│   ├── content/                  # Shadow DOM Host & Trigger Capsule
│   ├── popup/                    # Quick toggle popup UI
│   ├── options/                  # Settings / BYOK configuration UI
│   └── styles/                   # Shadow DOM styles
├── desktop/                      # Tauri 2.x Desktop Application
│   ├── package.json              # Desktop frontend dependencies
│   ├── vite.config.ts            # Desktop Vite build configuration
│   ├── tsconfig.json             # Desktop TypeScript configuration
│   ├── tailwind.config.js        # Desktop Tailwind theme configuration
│   ├── index.html                # Desktop HTML entry
│   ├── README.md                 # Desktop documentation & build guide
│   ├── src/                      # Desktop React Frontend
│   │   ├── main.tsx              # React entry
│   │   ├── App.tsx               # Desktop Raycast floating window
│   │   ├── styles/               # Glassmorphism & acrylic theme CSS
│   │   └── adapters/             # Desktop Platform Adapters
│   │       ├── TauriSelectionProvider.ts
│   │       ├── TauriTextReplacer.ts
│   │       ├── TauriStorageProvider.ts
│   │       ├── TauriIPCLLMTransport.ts
│   │       └── index.ts
│   └── src-tauri/                # Tauri 2.x Rust Native Backend
│       ├── Cargo.toml            # Rust dependencies
│       ├── tauri.conf.json       # Window, tray, and plugin configuration
│       ├── capabilities/         # Tauri 2.x security capabilities
│       │   └── default.json
│       └── src/
│           ├── main.rs           # Rust entry & global shortcut / tray setup
│           ├── tray.rs           # System tray menu and handlers
│           └── commands/         # IPC command handlers
│               ├── selection.rs  # Win32 SendInput selection grab
│               ├── replacer.rs   # Win32 SendInput text replacement
│               ├── position.rs   # Multi-monitor cursor positioning & clamp
│               └── transport.rs  # Rust native Reqwest SSE streaming
├── tests/
│   ├── unit/                     # Unit tests for shared core & adapters
│   └── e2e/                      # Multi-platform E2E test suites (Tiers 1-5)
├── package.json                  # Monorepo root package.json
└── tsconfig.json                 # Monorepo root tsconfig with path aliases
```

---

## Desktop Build Guide (Windows / GNU Toolchain)

Builds the Tauri 2.x desktop client into `desktop/src-tauri/target/release/runbi-desktop.exe` and optional MSI/NSIS installers. A reusable version of this workflow is also available as the project skill `.claude/skills/build-runbi-desktop/SKILL.md`.

### Target environment
- **Rust toolchain: `stable-x86_64-pc-windows-gnu`** (GNU). The MSVC toolchain is NOT usable on a build box that lacks the VS VC++ Build Tools workload — do not switch to MSVC; fix the GNU path instead.
- **MSYS2 MinGW-w64** at `C:\msys64\mingw64\bin` (provides working `windres`/`gcc`/`cpp`, the DLLs `cc1.exe` needs, and `as.exe` for GNU `dlltool`).
- **Node.js** (npm workspaces) for the React/Vite frontend.

### Step 0 — Smart App Control (SAC)
SAC blocks Cargo's unsigned build scripts → `os error 4551 (应用程序控制策略已阻止此文件)`. Check state:
```powershell
(Get-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy).VerifiedAndReputablePolicyState
```
- `1` = SAC active → cannot be bypassed programmatically. Disable via *Windows Security → Device security → Kernel isolation → Smart App Control*, then re-check until it reads `0`.
- `0` = OK, proceed.

### Step 1 — Frontend deps + build
```powershell
cd D:\agent\agv\runbi
npm install --include=dev          # workspace hoists deps to root node_modules
cd desktop
npm run build                       # tsc && vite build -> desktop/dist
```
Verify `desktop/dist/index.html` exists. Tauri CLI is hoisted to `node_modules\@tauri-apps\cli\tauri.js`.

### Step 2 — Set PATH (required for every build command)
Both directories are required, in this order:
```powershell
$env:PATH = "C:\msys64\mingw64\bin;" +
  "C:\Users\54191\.rustup\toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\bin\self-contained;" +
  $env:PATH
```
Why both:
- `mingw64/bin` provides working `windres`/`gcc`/`cpp` **and** the runtime DLLs that `cc1.exe` needs (without them cc1 dies with `STATUS_DLL_NOT_FOUND` and windres reports "preprocessing failed"). It also supplies `as.exe` so GNU `dlltool` can create import libraries.
- `self-contained` provides the Rust-bundled `dlltool.exe`/`ld.exe` used for linking.

### Step 3 — Compile check first (fast)
```powershell
cd D:\agent\agv\runbi\desktop\src-tauri
cargo check --release
```
Fix any `error[...]` before the full build. Fixes already applied to this repo (re-apply if reverted):
- `commands/selection.rs` & `commands/replacer.rs`: add `use tauri_plugin_clipboard_manager::ClipboardExt;`
- `selection.rs`: `clipboard.read_text().unwrap_or_default()` (single call, not doubled)
- `replacer.rs`: clipboard-restore block uses `if !original_clip.is_empty() { ... }` (`original_clip` is a `String`, not `Option`)

### Step 4 — Icons (only if they fail)
`tauri::generate_context!` requires `icons/icon.png` to be RGBA and `icons/icon.ico` to be a real multi-size ICO. If either is broken:
```powershell
cd D:\agent\agv\runbi\desktop\src-tauri\icons
python -c "from PIL import Image; im=Image.open('icon.png').convert('RGBA'); im.save('icon.png')"
python -c "from PIL import Image; s=Image.open('icon.png').convert('RGBA'); [s.resize((x,x)) for x in (16,24,32,48,64,128)]; s.save('icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128)])"
```
Back up originals as `*.bak` first.

### Step 5 — Build
```powershell
cd D:\agent\agv\runbi\desktop
# exe only (skips installer download):
node ..\node_modules\@tauri-apps\cli\tauri.js build --no-bundle
# exe + installers (downloads WiX ~70MB; needs good network):
node ..\node_modules\@tauri-apps\cli\tauri.js build
```

### Step 6 — Verify
```powershell
$p = Start-Process .\target\release\runbi-desktop.exe -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 4
if (-not $p.HasExited) { Write-Host "RUNNING OK"; Stop-Process -Id $p.Id -Force }
else { Write-Host "EXITED $($p.ExitCode)" }
```

### Outputs
- Exe: `desktop/src-tauri/target/release/runbi-desktop.exe`
- Installers: `desktop/src-tauri/target/release/bundle/msi|nsis/`

### Runtime config gotcha
`tauri.conf.json` → `"plugins": { "store": null }` (NOT `{}`). The store plugin `Builder` takes no config; `{}` causes a startup panic `invalid type: map, expected unit`.

### Troubleshooting quick table
| Symptom | Cause | Fix |
|---|---|---|
| `os error 4551` on build-script-build | SAC active | User disables SAC (Step 0) |
| `dlltool not found` | self-contained dir not on PATH | Add it (Step 2) |
| `dlltool could not create import library` | missing `as.exe` | Ensure mingw64/bin on PATH |
| `windres: preprocessing failed` | cc1 missing DLLs | Ensure mingw64/bin on PATH |
| `icon ... is not RGBA` | icon.png lacks alpha | Convert to RGBA (Step 4) |
| `does not contain icon data` | icon.ico corrupt / PNG-in-ico | Regenerate ICO (Step 4) |
| `no method named clipboard()` | missing trait import | Add `ClipboardExt` (Step 3) |
| store panic at launch | `"store": {}` | Set `"store": null` |
