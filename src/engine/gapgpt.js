// Thin client for a GapGPT (OpenAI-compatible) chat endpoint. Used only for the
// optional start/end-of-day conversations. No key configured → hasKey() is false
// and the sim never calls out; everything still runs offline.

let cfg = {
  key: "",
  base: "https://api.gapgpt.app/v1",
  model: "gpt-4o-mini",
  onLog: null, // (record) => void — where to send the request/response transcript
};

export function configure(c = {}) {
  for (const k of ["key", "base", "model"]) if (c[k]) cfg[k] = c[k];
  if (typeof c.onLog === "function") cfg.onLog = c.onLog;
}

export function hasKey() {
  return !!cfg.key;
}

export function info() {
  return { base: cfg.base, model: cfg.model, hasKey: !!cfg.key };
}

export async function chatJSON(system, user, { temperature = 0.85, timeoutMs = 15000, meta = {} } = {}) {
  if (!cfg.key) throw new Error("no api key");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const requestBody = {
    model: cfg.model,
    temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  const rec = { kind: "gapgpt", meta, request: requestBody };
  try {
    const res = await fetch(`${cfg.base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(requestBody),
      signal: ctrl.signal,
    });
    rec.status = res.status;
    if (!res.ok) {
      rec.error = `HTTP ${res.status}`;
      rec.body = await res.text().catch(() => "");
      throw new Error(rec.error);
    }
    const data = await res.json();
    rec.response = data;
    let txt = data?.choices?.[0]?.message?.content ?? "";
    rec.content = txt;
    txt = txt.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(txt);
    rec.parsed = parsed;
    return parsed;
  } catch (e) {
    if (!rec.error) rec.error = e.message;
    throw e;
  } finally {
    clearTimeout(timer);
    try {
      cfg.onLog?.(rec);
    } catch {
      /* logging must never break the call */
    }
  }
}
