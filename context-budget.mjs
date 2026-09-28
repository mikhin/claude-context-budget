#!/usr/bin/env node
// UserPromptSubmit hook: past the threshold, warns the user every prompt and asks Claude to offer a handoff at 1× and again at 2× the threshold.
// With --status, prints the context size against the threshold for the status line instead.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const THRESHOLD = Number(process.env.CONTEXT_WARN_TOKENS ?? 200_000);
const HANDOFF = process.env.CONTEXT_HANDOFF ?? "~/Desktop/handoff-<topic>.txt";

async function readInput() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text || "{}");
}

function contextSize(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"usage"')) continue;
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const usage = entry.type === "assistant" && !entry.isSidechain && entry.message?.usage;
    if (usage)
      return (
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0)
      );
  }
  return 0;
}

const sessionSize = (input) => contextSize(readFileSync(input.transcript_path, "utf8").split("\n"));

const kilo = (tokens) => `${Math.round(tokens / 1000)}K`;

function statusText(size) {
  const text = `ctx ${kilo(size)}/${kilo(THRESHOLD)}`;
  return size >= THRESHOLD ? `\x1b[31m${text}\x1b[0m` : text;
}

const handoffRequest = (k) =>
  `Session context is ${k} — answer quality degrades from here. First answer the prompt as usual. ` +
  `At the end of the answer, offer to end the session: a 2–3 line recap (what is done, what is left). ` +
  `If the task is nearly done, offer to finish it first. If the user agrees, write a summary ` +
  `to ${HANDOFF}: the goal, decisions made and why, changed files, the next step, open questions. ` +
  `Then give the command for a new session: claude "read ${HANDOFF} and continue".`;

async function main() {
  const input = await readInput();
  if (!input.transcript_path) return;
  const size = sessionSize(input);
  if (size < THRESHOLD) return;
  const k = kilo(size);
  const marker = join(input.scratchpad_dir ?? tmpdir(), `context-budget-${input.session_id}`);
  const step = size >= 2 * THRESHOLD ? 2 : 1;
  const announced = existsSync(marker) ? Number(readFileSync(marker, "utf8")) : 0;
  const ask = step > announced;
  if (ask) writeFileSync(marker, String(step));
  console.log(
    JSON.stringify({
      systemMessage: `Context ${k} — time to wrap up`,
      ...(ask && {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: handoffRequest(k),
        },
      }),
    }),
  );
}

async function status() {
  const input = await readInput();
  if (input.transcript_path) console.log(statusText(sessionSize(input)));
}

if (process.argv[2] === "--test") {
  const line = (usage, extra = {}) =>
    JSON.stringify({ type: "assistant", message: { usage }, ...extra });
  const main = line({ input_tokens: 2, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 60_000 });
  const side = line({ input_tokens: 5, cache_read_input_tokens: 10 }, { isSidechain: true });
  assert.equal(contextSize([main, side, "", "{broken"]), 210_002);
  assert.equal(contextSize([JSON.stringify({ type: "user" })]), 0);
  assert.equal(statusText(THRESHOLD - 1_000), `ctx ${kilo(THRESHOLD - 1_000)}/${kilo(THRESHOLD)}`);
  assert.equal(statusText(THRESHOLD), `\x1b[31mctx ${kilo(THRESHOLD)}/${kilo(THRESHOLD)}\x1b[0m`);
  console.log("ok");
} else {
  // fail open: a broken hook must not get in the way
  (process.argv[2] === "--status" ? status() : main()).catch((error) =>
    console.error(`context-budget: ${error.message}`),
  );
}
