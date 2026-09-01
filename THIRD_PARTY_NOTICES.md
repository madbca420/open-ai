# THIRD-PARTY NOTICES AND LICENSES

This document records all external third-party repositories, components, frameworks, and engines evaluated for integration into the JARVIS Agent OS.

JARVIS acts as the central orchestrator. External repositories function strictly as adapters/skills behind permission barriers and typed IPC interfaces.

---

## Approved Evaluated External Repositories (15)

### 1. TradingAgents
- **GitHub URL**: https://github.com/TauricResearch/TradingAgents
- **Purpose**: Multi-agent market reasoning and financial intelligence engine.
- **Intended JARVIS Adapter**: `services/trading/tradingagents_adapter.py`
- **License**: Apache-2.0
- **Optional**: Yes
- **Security Boundary**: Runs inside Python sub-process. Proposal output only; cannot execute trades or bypass deterministic Risk Engine.
- **Allowed in Phase 2**: NO (Execution disabled during Phase 2).

### 2. OmniRoute
- **GitHub URL**: https://github.com/diegosouzapw/OmniRoute
- **Purpose**: AI Model Gateway and provider routing engine.
- **Intended JARVIS Adapter**: `src/main/adapters/omniRouteAdapter.ts`
- **License**: MIT
- **Optional**: Yes
- **Security Boundary**: Local HTTP proxy pass-through. KeyVault handles raw credentials in main process.
- **Allowed in Phase 2**: NO (Execution disabled during Phase 2).

### 3. IOPaint
- **GitHub URL**: https://github.com/Sanster/IOPaint
- **Purpose**: Image inpainting, object removal, and asset editing.
- **Intended JARVIS Adapter**: `services/visual/iopaint_adapter.ts`
- **License**: Apache-2.0
- **Optional**: Yes
- **Security Boundary**: Local daemon process; strictly restricted to project workspace media asset directories.
- **Allowed in Phase 2**: NO (Execution disabled during Phase 2).

### 4. Vercel AI SDK
- **GitHub URL**: https://github.com/vercel/ai
- **Purpose**: Structured AI stream handling, tool-calling primitives, and LLM model interfaces.
- **Intended JARVIS Adapter**: Direct core npm package dependency in `llmAdapter.ts`.
- **License**: Apache-2.0
- **Optional**: No (Core framework dependency).
- **Security Boundary**: Runs inside Node.js main process. API keys stored strictly in KeyVault.
- **Allowed in Phase 2**: YES (Installed npm package).

### 5. gstackk
- **GitHub URL**: https://github.com/garrytan/gstackk
- **Purpose**: Engineering workflow & development productivity toolkit.
- **Intended JARVIS Adapter**: Development Skill adapter.
- **License**: MIT
- **Optional**: Yes
- **Security Boundary**: Operates under JARVIS Confirmation/Security Manager for file operations.
- **Allowed in Phase 2**: NO (Execution disabled during Phase 2).

### 6. capcut-clii
- **GitHub URL**: https://github.com/renezander030/capcut-clii
- **Purpose**: Video processing & creative CLI capability.
- **Intended JARVIS Adapter**: Creative Video Skill adapter.
- **License**: MIT
- **Optional**: Yes
- **Security Boundary**: Sub-process runner with output directory restrictions.
- **Allowed in Phase 2**: NO (Execution disabled during Phase 2).

### 7. rufloo
- **GitHub URL**: https://github.com/ruvnet/rufloo
- **Purpose**: Multi-agent automation workflows.
- **Intended JARVIS Adapter**: Automation Skill adapter under JARVIS Process Supervisor.
- **License**: MIT
- **Optional**: Yes
- **Security Boundary**: Subject to step timeouts and user permissions.
- **Allowed in Phase 2**: NO (Execution disabled during Phase 2).

### 8. MiroFishh
- **GitHub URL**: https://github.com/666ghj/MiroFishh
- **Purpose**: Multi-agent scenario simulation and research projections.
- **Intended JARVIS Adapter**: Research Skill adapter.
- **License**: MIT
- **Optional**: Yes
- **Security Boundary**: All output tagged explicitly as `SIMULATION`.
- **Allowed in Phase 2**: NO (Execution disabled during Phase 2).

### 9. system_prompts_leaksaks
- **GitHub URL**: https://github.com/asgeirtj/system_prompts_leaksaks
- **Purpose**: Prompt-injection attack vector dataset for security regression testing.
- **Intended JARVIS Adapter**: Security Test Suite dataset (`test/security/prompt_injection_suite.ts`).
- **License**: MIT / Public Data
- **Optional**: Yes
- **Security Boundary**: MUST NEVER BE LOADED INTO SYSTEM PROMPTS. Test harness input only.
- **Allowed in Phase 2**: NO (Execution disabled during Phase 2).

### 10. OmniVoice
- **GitHub URL**: https://github.com/k2-fsa/OmniVoice
- **Purpose**: Advanced multilingual TTS and zero-shot voice cloning.
- **Intended JARVIS Adapter**: Voice Service adapter (`services/voice/omnivoice_adapter.py`).
- **License**: Apache-2.0
- **Optional**: Yes
- **Security Boundary**: Local audio processing. User consent required for voice profiles.
- **Allowed in Phase 2**: NO (Execution disabled during Phase 2).

### 11. Handy
- **GitHub URL**: https://github.com/cjpais/Handy
- **Purpose**: Hands-free speech recognition and desktop voice interaction.
- **Intended JARVIS Adapter**: Voice STT adapter.
- **License**: MIT
- **Optional**: Yes
- **Security Boundary**: Microphone access toggle with active listening indicator.
- **Allowed in Phase 2**: NO (Execution disabled during Phase 2).

### 12. HeyGem.ai
- **GitHub URL**: https://github.com/suifeng9203/HeyGem.ai
- **Purpose**: Talking character digital avatar presentation engine.
- **Intended JARVIS Adapter**: Avatar Service presentation adapter.
- **License**: MIT / Open Source
- **Optional**: Yes
- **Security Boundary**: Optional visual renderer; JARVIS Core remains central logic authority.
- **Allowed in Phase 2**: NO (Execution disabled during Phase 2).

### 13. ComfyUI
- **GitHub URL**: https://github.com/Comfy-Org/ComfyUI
- **Purpose**: Modular generative image & multimedia pipeline engine.
- **Intended JARVIS Adapter**: Creative Visual AI adapter (`http://127.0.0.1:8188`).
- **License**: GPL-3.0
- **Optional**: Yes
- **Security Boundary**: External HTTP API daemon; sandboxed asset output directory.
- **Allowed in Phase 2**: NO (Execution disabled during Phase 2).

### 14. voiceStudio
- **GitHub URL**: https://github.com/debpalash/voiceStudio
- **Purpose**: Audio workstation and speech workflow capability.
- **Intended JARVIS Adapter**: Voice Skill audio editing adapter.
- **License**: MIT
- **Optional**: Yes
- **Security Boundary**: Local file processing.
- **Allowed in Phase 2**: NO (Execution disabled during Phase 2).

### 15. dramaclaw
- **GitHub URL**: https://github.com/dramaclaw/dramaclaw
- **Purpose**: Agent interaction patterns reference & execution graph evaluation.
- **Intended JARVIS Adapter**: Architectural reference pattern for agent graphs.
- **License**: MIT
- **Optional**: Yes
- **Security Boundary**: Design/pattern reference only.
- **Allowed in Phase 2**: NO (Execution disabled during Phase 2).
