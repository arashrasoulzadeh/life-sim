// SimYou — optional config for the start/end-of-day conversations.
//
// Without a key, those conversations still happen with an offline "voice" and
// can still add/remove room objects; with a key they're written by GapGPT.
//
// To keep your key out of git after editing this file:
//   git update-index --skip-worktree config.js
// (a localStorage value `simyou_gapgpt_key` overrides this and never touches git.)

window.SIMYOU_CONFIG = {
  gapgptKey: "",
  gapgptBase: "https://api.gapgpt.app/v1",
  model: "gpt-4o-mini",
};
