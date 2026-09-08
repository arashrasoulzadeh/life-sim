// Thin client for a GapGPT (OpenAI-compatible) chat endpoint. Used only for the
// optional start/end-of-day conversations. No key configured → hasKey() is false
// and the sim never calls out; everything still runs offline.

let cfg = {
  key: "",
  base: "https://api.gapgpt.app/v1",
  model: "gpt-4o-mini",
};

export function configure(c = {}) {
  for (const k of ["key", "base", "model"]) if (c[k]) cfg[k] = c[k];
}

export function hasKey() {
  return !!cfg.key;
}

export function info() {
  return { base: cfg.base, model: cfg.model, hasKey: !!cfg.key };
}

export async function chatJSON(system, user, { temperature = 0.85, timeoutMs = 15000 } = {}) {
  if (!cfg.key) throw new Error("no api key");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    let txt = data?.choices?.[0]?.message?.content ?? "";
    txt = txt.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return JSON.parse(txt);
  } finally {
    clearTimeout(timer);
  }
}
