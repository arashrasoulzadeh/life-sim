// Objects the AI can own. The full ~200-item marketplace lives in
// marketplace.js; this file just re-exports it so existing imports keep working.
export {
  OBJECTS,
  OBJECT_IDS_BY_ROOM,
  DEFAULT_OBJECTS,
  MARKET,
  isSellable,
  priceOf,
  sellValue,
  catOf,
} from "./marketplace.js";
