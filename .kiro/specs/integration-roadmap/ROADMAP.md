# Integration Roadmap State

## Phase 0 — M0 基座就绪
- [x] voice-interaction-loop — status: Done
      upstreams: (none)
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: n/a
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z
- [x] model-management — status: Done
      upstreams: (none)
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: n/a
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z
- [x] ui-internationalization — status: Done
      upstreams: (none)
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: n/a
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z
- [x] appearance-theme-mode — status: Done
      upstreams: (none)
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: n/a
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z

## Phase 1 — M1 持久化与库基座
- [x] chat-session-persistence — status: Done
      upstreams: voice-interaction-loop
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: pass
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z
- [x] voice-library-management — status: Done
      upstreams: voice-interaction-loop
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: pass
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z
- [x] command-palette — status: Done
      upstreams: appearance-theme-mode, ui-internationalization
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: pass
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z

## Phase 2 — M2 对话核心增强
- [x] streaming-chat-output — status: Done
      upstreams: chat-session-persistence
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: pass
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z
- [x] chat-history-search — status: Done
      upstreams: chat-session-persistence
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: pass
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z
- [x] conversation-export-import — status: Done
      upstreams: chat-session-persistence
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: pass
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z
- [x] character-persona-management — status: Done
      upstreams: voice-library-management
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: pass
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z

## Phase 3 — M3 交互与参数
- [x] chat-session-organization — status: Done
      upstreams: chat-history-search
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: pass
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z
- [x] chat-message-actions — status: Done
      upstreams: streaming-chat-output
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: pass
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z
- [x] chat-generation-parameters — status: Done
      upstreams: model-management, streaming-chat-output
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: pass
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z
- [x] prompt-preset-management — status: Done
      upstreams: character-persona-management
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: pass
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z

## Phase 4 — M4 全功能完成
- [x] markdown-message-rendering — status: Done
      upstreams: chat-message-actions
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: pass
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z
- [x] context-window-management — status: Done
      upstreams: model-management, chat-generation-parameters
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: pass
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z
- [x] chat-input-slash-commands — status: Done
      upstreams: prompt-preset-management, chat-message-actions
      gate.build: pass
      gate.test: pass
      gate.regression: pass
      gate.integration: pass
      blocker: (none)
      attempts: 1
      updatedAt: 2026-06-28T03:52:11.509Z
