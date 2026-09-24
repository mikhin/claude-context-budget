# claude-context-budget

A Claude Code hook that warns when a session's context grows past a threshold and asks Claude to
offer a handoff to a fresh session.

Answers get worse long before the context window is full. This one tells you when to stop and
hands the work over instead of letting the session drift.

```
Context 212K — time to wrap up
```

## Install

```sh
curl -o ~/.claude/hooks/context-budget.mjs \
  https://raw.githubusercontent.com/mikhin/claude-context-budget/main/context-budget.mjs
```

Then in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/context-budget.mjs" }] }
    ]
  }
}
```

Needs Node 18+.

## Configure

| Variable              | Default                         | What it is                                  |
| --------------------- | ------------------------------- | ------------------------------------------- |
| `CONTEXT_WARN_TOKENS` | `200000`                        | Context size, in tokens, that starts it     |
| `CONTEXT_HANDOFF`     | `~/Desktop/handoff-<topic>.txt` | Where Claude is asked to write the handoff  |

## How it works

On every prompt: read the session transcript from the end, find the last main-thread assistant
message, and sum its `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` — the
context the model saw on the last turn. Subagent messages are skipped.

Below the threshold nothing happens. Past it:

- every prompt shows `Context <N>K — time to wrap up` in the terminal;
- at 1× and again at 2× the threshold, Claude gets an instruction to answer the prompt first, then
  offer to end the session with a 2–3 line recap. If you agree, it writes the handoff file (goal,
  decisions and why, changed files, next step, open questions) and gives you the command to go on:

```sh
claude "read ~/Desktop/handoff-<topic>.txt and continue"
```

A marker file per session remembers which step was already asked, so Claude asks twice at most.

## Caveats

- The transcript format is not a documented API. It can change without notice.
- The size is the last turn's, so the prompt you are sending now is not counted yet.
- Any failure fails open: the hook prints the error and lets the prompt through.

## Test

```sh
node context-budget.mjs --test
```

## License

MIT
