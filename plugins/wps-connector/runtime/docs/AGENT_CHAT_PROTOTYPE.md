# Agent Chat Prototype

Branch: `codex/agent-chat-feasibility`

## Scope

- Adds an `Agent 对话` Ribbon button.
- Reuses the existing per-document TaskPane with an Agent chat view.
- Reads recent messages from the Codex thread saved in the current document
  binding.
- Uses the same local Codex App Server daemon as Codex Desktop.
- Sends messages with `thread/resume` and `turn/start`.
- Displays `item/agentMessage/delta` output while the turn is running.
- Supports stopping the active turn with `turn/interrupt`.
- Refuses to start a turn while Codex Desktop is still using its private
  App Server process, preventing invisible background execution.

## Local API

- `GET /api/agent/:sessionId/history`
- `POST /api/agent/:sessionId/message`
- `GET /api/agent/:sessionId/status`
- `POST /api/agent/:sessionId/interrupt`

The API resolves `threadId` from the saved WPS document binding. It does not
accept a caller-selected thread identifier.

## Current Limits

- Interactive Codex approval and user-input requests are not rendered in WPS.
- Codex Desktop must be restarted once after installation so it reconnects
  through the shared daemon.
- Only plain-text message rendering is implemented.
- The prototype keeps one active Agent turn per bound thread.
