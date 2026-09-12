import { test } from "node:test";
import assert from "node:assert/strict";
import { KERNELS, KERNEL_IDS, nudgeSpec, randomSpec, validateSpec, describeSpec } from "../src/game/kernels.js";
import { Rng } from "../src/engine/rng.js";

test("every kernel has a description and at least one param, each param internally consistent", () => {
  for (const [id, def] of Object.entries(KERNELS)) {
    assert.ok(def.desc && def.desc.length > 0, `${id} needs a description`);
    assert.ok(Object.keys(def.params).length > 0, `${id} should have at least one param`);
    for (const [k, s] of Object.entries(def.params)) {
      if (s.type === "int" || s.type === "num") {
        assert.ok(s.min <= s.max, `${id}.${k} min<=max`);
        assert.ok(s.def >= s.min && s.def <= s.max, `${id}.${k} default within range`);
      } else if (s.type === "enum") {
        assert.ok(Array.isArray(s.values) && s.values.length > 0, `${id}.${k} enum needs values`);
        assert.ok(s.values.includes(s.def), `${id}.${k} default must be one of its own values`);
      } else if (s.type === "bool") {
        assert.equal(typeof s.def, "boolean");
      } else {
        assert.fail(`${id}.${k} has an unknown param type ${s.type}`);
      }
    }
  }
});

test("KERNEL_IDS matches the KERNELS keys exactly, at least 30 kernels", () => {
  assert.deepEqual(KERNEL_IDS, Object.keys(KERNELS));
  assert.ok(KERNEL_IDS.length >= 30);
});

test("validateSpec rejects an unknown kernel", () => {
  assert.equal(validateSpec({ kernel: "not-real", params: {} }), null);
  assert.equal(validateSpec(null), null);
  assert.equal(validateSpec({}), null);
});

test("validateSpec clamps every param type to its declared range/enum/type and fills in defaults for missing ones", () => {
  for (const id of KERNEL_IDS) {
    const def = KERNELS[id];
    const wildParams = {};
    for (const [k, s] of Object.entries(def.params)) {
      if (s.type === "int" || s.type === "num") wildParams[k] = s.max + 99999;
      else if (s.type === "bool") wildParams[k] = "not-a-bool";
      else if (s.type === "enum") wildParams[k] = "not-a-real-value";
    }
    const clean = validateSpec({ kernel: id, params: wildParams });
    assert.ok(clean, `${id} should validate`);
    for (const [k, s] of Object.entries(def.params)) {
      const v = clean.params[k];
      if (s.type === "int") { assert.ok(Number.isInteger(v)); assert.ok(v >= s.min && v <= s.max); }
      else if (s.type === "num") assert.ok(v >= s.min && v <= s.max);
      else if (s.type === "bool") assert.equal(v, s.def, "invalid bool falls back to default");
      else if (s.type === "enum") assert.equal(v, s.def, "invalid enum falls back to default");
    }

    const missing = validateSpec({ kernel: id, params: {} });
    for (const [k, s] of Object.entries(def.params)) {
      if (s.type === "num") {
        // num defaults pass through the same "round to 2 decimals" step as any
        // other value, so a very small default (e.g. 0.002) can round to 0 —
        // that's consistent behaviour, just not byte-exact equality
        assert.ok(Math.abs(missing.params[k] - s.def) <= 0.01, `${id}.${k}: ${missing.params[k]} should be close to default ${s.def}`);
      } else {
        assert.equal(missing.params[k], s.def);
      }
    }
  }
});

test("nudgeSpec keeps every param within range and returns the same kernel", () => {
  for (const id of KERNEL_IDS) {
    const rng = new Rng(1);
    let spec = { kernel: id, params: Object.fromEntries(Object.entries(KERNELS[id].params).map(([k, s]) => [k, s.def])) };
    for (let i = 0; i < 20; i++) {
      spec = nudgeSpec(spec, rng);
      assert.equal(spec.kernel, id);
      for (const [k, s] of Object.entries(KERNELS[id].params)) {
        const v = spec.params[k];
        if (s.type === "int" || s.type === "num") assert.ok(v >= s.min && v <= s.max, `${id}.${k}=${v} out of range after nudging`);
        else if (s.type === "enum") assert.ok(s.values.includes(v));
        else if (s.type === "bool") assert.equal(typeof v, "boolean");
      }
    }
  }
});

test("nudgeSpec is a no-op passthrough for an unknown kernel", () => {
  const spec = { kernel: "not-real", params: { x: 1 } };
  assert.deepEqual(nudgeSpec(spec, new Rng(1)), spec);
});

test("randomSpec always produces a validateSpec-clean spec for a real kernel", () => {
  for (let i = 0; i < 200; i++) {
    const spec = randomSpec(new Rng(i));
    assert.ok(KERNEL_IDS.includes(spec.kernel));
    const revalidated = validateSpec(spec);
    assert.deepEqual(revalidated, spec, "a freshly randomized spec should already be in clamped/canonical form");
  }
});

test("describeSpec renders a human-readable summary, 'unknown' for a bad kernel", () => {
  const spec = validateSpec({ kernel: "orbit", params: { count: 5 } });
  const desc = describeSpec(spec);
  assert.ok(desc.includes("orbit"));
  assert.ok(desc.includes("count 5"));
  assert.equal(describeSpec({ kernel: "nope", params: {} }), "unknown");
});
