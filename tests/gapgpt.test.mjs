import { test } from "node:test";
import assert from "node:assert/strict";
import * as Gap from "../src/engine/gapgpt.js";

function withMockFetch(handler, fn) {
  const orig = global.fetch;
  global.fetch = handler;
  return Promise.resolve(fn()).finally(() => {
    global.fetch = orig;
  });
}

test("hasKey/info reflect configure(), and chatJSON refuses to call out with no key", async () => {
  Gap.configure({ key: "", base: "https://x.test/v1", model: "test-model" });
  assert.equal(Gap.hasKey(), false);
  assert.equal(Gap.info().model, "test-model");
  await assert.rejects(() => Gap.chatJSON("sys", "usr"), /no api key/);
});

test("chatJSON posts the right shape, parses a fenced JSON reply, and logs the transcript", async () => {
  Gap.configure({ key: "test-key-123", base: "https://x.test/v1", model: "m1" });
  let seenReq = null;
  const log = [];
  Gap.configure({
    onLog: (rec) => log.push(rec),
  });
  await withMockFetch(
    async (url, opts) => {
      seenReq = { url, body: JSON.parse(opts.body) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '```json\n{"line":"hi"}\n```' } }] }),
      };
    },
    async () => {
      const out = await Gap.chatJSON("system prompt", "user prompt", { meta: { phase: "test" } });
      assert.deepEqual(out, { line: "hi" });
    },
  );
  assert.equal(seenReq.url, "https://x.test/v1/chat/completions");
  assert.equal(seenReq.body.model, "m1");
  assert.equal(seenReq.body.messages[0].content, "system prompt");
  assert.equal(seenReq.body.messages[1].content, "user prompt");
  assert.equal(log.length, 1);
  assert.equal(log[0].meta.phase, "test");
  assert.deepEqual(log[0].parsed, { line: "hi" });
});

test("chatJSON throws and logs an error on a non-OK HTTP response", async () => {
  Gap.configure({ key: "test-key", base: "https://x.test/v1" });
  const log = [];
  Gap.configure({ onLog: (rec) => log.push(rec) });
  await withMockFetch(
    async () => ({ ok: false, status: 500, text: async () => "server exploded" }),
    async () => {
      await assert.rejects(() => Gap.chatJSON("s", "u"), /HTTP 500/);
    },
  );
  assert.equal(log[log.length - 1].error, "HTTP 500");
});

test("chatJSON throws on unparseable content but still logs the raw content", async () => {
  Gap.configure({ key: "test-key", base: "https://x.test/v1" });
  const log = [];
  Gap.configure({ onLog: (rec) => log.push(rec) });
  await withMockFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "not json at all" } }] }) }),
    async () => {
      await assert.rejects(() => Gap.chatJSON("s", "u"));
    },
  );
  assert.equal(log[log.length - 1].content, "not json at all");
});

test("a logging callback that itself throws never breaks the call's own success/failure", async () => {
  Gap.configure({ key: "test-key", base: "https://x.test/v1" });
  Gap.configure({
    onLog: () => {
      throw new Error("logging exploded");
    },
  });
  await withMockFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) }),
    async () => {
      const out = await Gap.chatJSON("s", "u");
      assert.deepEqual(out, { ok: true });
    },
  );
});
