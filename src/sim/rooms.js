const FLOOR = { x: 32, y: 232, w: 448, h: 188 };

export const ROOMS = {
  desk: {
    id: "desk",
    name: "the desk",
    floor: FLOOR,
    spot: { x: 256, y: 300 },
    palette: { wall: "#20303a", floor: "#3a4a3f", accent: "#e0b45c" },
  },
  kitchen: {
    id: "kitchen",
    name: "the kitchen",
    floor: FLOOR,
    spot: { x: 150, y: 320 },
    palette: { wall: "#3a2a2a", floor: "#4a4038", accent: "#d98555" },
  },
  window: {
    id: "window",
    name: "the window",
    floor: FLOOR,
    spot: { x: 256, y: 250 },
    palette: { wall: "#1a2740", floor: "#33405a", accent: "#8fd0e8" },
  },
  couch: {
    id: "couch",
    name: "the couch",
    floor: FLOOR,
    spot: { x: 350, y: 330 },
    palette: { wall: "#2e2440", floor: "#463a56", accent: "#c98bd0" },
  },
  bed: {
    id: "bed",
    name: "bed",
    floor: FLOOR,
    spot: { x: 256, y: 310 },
    palette: { wall: "#161a2a", floor: "#28304a", accent: "#6b78b0" },
  },
  game: {
    id: "game",
    name: "the game room",
    floor: FLOOR,
    spot: { x: 256, y: 320 },
    palette: { wall: "#1a2620", floor: "#28382f", accent: "#7ad0a0" },
  },
};

export const ROOM_IDS = ["window", "kitchen", "desk", "couch", "bed", "game"];
