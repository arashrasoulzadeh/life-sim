// Room objects the agent (or the start/end-of-day conversation) can add or
// remove. Each has a tiny passive effect applied while the agent is working in
// that room, and its own pixel drawing. The catalog is a closed whitelist — the
// LLM can only ever toggle ids that appear here.

export const OBJECTS = {
  // --- desk ---
  lamp: {
    room: "desk",
    label: "a desk lamp",
    effect: { focus: 0.5 },
    draw(c) {
      c.fillStyle = "#2a2a2a";
      c.fillRect(214, 236, 4, 14);
      c.fillRect(214, 234, 14, 3);
      c.fillStyle = "#e0b45c";
      c.fillRect(224, 234, 8, 6);
    },
  },
  plant: {
    room: "desk",
    label: "a small plant",
    effect: { curiosity: 0.4, focus: 0.15 },
    draw(c) {
      c.fillStyle = "#6b4a2f";
      c.fillRect(372, 240, 12, 10);
      c.fillStyle = "#4c8a4c";
      c.fillRect(370, 230, 16, 10);
      c.fillRect(375, 224, 6, 8);
    },
  },
  secondScreen: {
    room: "desk",
    label: "a second monitor",
    effect: { focus: 0.6, energy: -0.1 },
    draw(c) {
      c.fillStyle = "#111";
      c.fillRect(236, 222, 54, 32);
      c.fillStyle = "#6b8fae";
      c.fillRect(240, 226, 46, 24);
    },
  },
  mug: {
    room: "desk",
    label: "a coffee mug",
    effect: { energy: 0.45 },
    draw(c) {
      c.fillStyle = "#c9c2b8";
      c.fillRect(282, 242, 9, 8);
      c.fillRect(291, 244, 3, 4);
    },
  },

  // --- kitchen ---
  kettle: {
    room: "kitchen",
    label: "a kettle",
    effect: { energy: 0.4 },
    draw(c) {
      c.fillStyle = "#8a8f98";
      c.fillRect(198, 220, 16, 16);
      c.fillRect(212, 216, 6, 4);
    },
  },
  fruitBowl: {
    room: "kitchen",
    label: "a bowl of fruit",
    effect: { energy: 0.5, focus: 0.2 },
    draw(c) {
      c.fillStyle = "#b7b2a8";
      c.fillRect(140, 228, 26, 8);
      c.fillStyle = "#d76a55";
      c.fillRect(143, 222, 8, 8);
      c.fillStyle = "#c7a63a";
      c.fillRect(153, 223, 8, 7);
    },
  },
  radio: {
    room: "kitchen",
    label: "a radio",
    effect: { social: 0.5, curiosity: 0.2 },
    draw(c) {
      c.fillStyle = "#4a3f38";
      c.fillRect(90, 222, 22, 14);
      c.fillStyle = "#d98555";
      c.fillRect(93, 225, 6, 8);
    },
  },

  // --- window ---
  telescope: {
    room: "window",
    label: "a telescope",
    effect: { curiosity: 0.9 },
    draw(c) {
      c.strokeStyle = "#9aa3b3";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(392, 320);
      c.lineTo(404, 300);
      c.moveTo(400, 320);
      c.lineTo(408, 302);
      c.stroke();
      c.fillStyle = "#c8ccd4";
      c.fillRect(402, 288, 12, 6);
    },
  },
  windowChair: {
    room: "window",
    label: "a chair by the glass",
    effect: { energy: 0.3, curiosity: 0.3 },
    draw(c) {
      c.fillStyle = "#5a4632";
      c.fillRect(300, 292, 18, 4);
      c.fillRect(300, 296, 4, 18);
      c.fillRect(314, 296, 4, 18);
      c.fillRect(314, 274, 4, 22);
    },
  },
  windowPlants: {
    room: "window",
    label: "a row of plants",
    effect: { curiosity: 0.4, focus: 0.2 },
    draw(c) {
      for (let i = 0; i < 4; i++) {
        c.fillStyle = "#6b4a2f";
        c.fillRect(150 + i * 26, 300, 10, 8);
        c.fillStyle = "#4c8a4c";
        c.fillRect(148 + i * 26, 292, 14, 9);
      }
    },
  },

  // --- couch ---
  blanket: {
    room: "couch",
    label: "a blanket",
    effect: { energy: 0.45 },
    draw(c) {
      c.fillStyle = "#8f6bd0";
      c.fillRect(300, 282, 90, 14);
    },
  },
  recordPlayer: {
    room: "couch",
    label: "a record player",
    effect: { social: 0.5, curiosity: 0.3 },
    draw(c) {
      c.fillStyle = "#2e2440";
      c.fillRect(246, 296, 26, 18);
      c.fillStyle = "#c98bd0";
      c.fillRect(252, 300, 14, 10);
    },
  },
  cat: {
    room: "couch",
    label: "a cat",
    effect: { social: 0.7, focus: -0.1 },
    draw(c) {
      c.fillStyle = "#3a3540";
      c.fillRect(292, 262, 16, 8);
      c.fillRect(290, 258, 4, 5);
      c.fillRect(306, 256, 3, 6);
    },
  },

  // --- bed ---
  nightlight: {
    room: "bed",
    label: "a nightlight",
    effect: { energy: 0.3, focus: 0.2 },
    draw(c) {
      c.fillStyle = "#6b78b0";
      c.fillRect(356, 300, 8, 14);
      c.fillStyle = "rgba(255,230,160,0.25)";
      c.fillRect(348, 292, 24, 24);
    },
  },
  journal: {
    room: "bed",
    label: "a journal",
    effect: { curiosity: 0.3, focus: 0.35 },
    draw(c) {
      c.fillStyle = "#7a5a3a";
      c.fillRect(330, 300, 16, 12);
      c.fillStyle = "#d8cfc0";
      c.fillRect(332, 302, 12, 8);
    },
  },
  photos: {
    room: "bed",
    label: "photos on the wall",
    effect: { social: 0.45 },
    draw(c) {
      c.fillStyle = "#c8ccd4";
      c.fillRect(196, 120, 16, 12);
      c.fillRect(220, 116, 12, 16);
      c.fillRect(240, 122, 14, 10);
    },
  },
};

export const OBJECT_IDS_BY_ROOM = (() => {
  const m = {};
  for (const [id, o] of Object.entries(OBJECTS)) (m[o.room] ??= []).push(id);
  return m;
})();

export const DEFAULT_OBJECTS = {
  desk: ["lamp"],
  kitchen: ["kettle"],
  window: ["windowChair"],
  couch: ["blanket"],
  bed: ["nightlight"],
};
