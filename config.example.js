// Copy to config.js (git-ignored) and fill in as needed.
// SimYou runs fully offline without any of this.
window.SIMYOU_CONFIG = {
  // start/end-of-day conversations: leave blank for the offline voice,
  // or paste a GapGPT key to have them written by the model.
  gapgptKey: "",
  gapgptBase: "https://api.gapgpt.app/v1",
  model: "gpt-4o-mini",

  // default seed when the URL has no ?seed= (blank / null = random each run)
  seed: null,
};
