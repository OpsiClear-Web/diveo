import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signWbi } from "./wbi";

// Fixed keys used to derive the mixin key. These are stable inputs so the
// resulting w_rid signatures are reproducible.
const IMG_KEY = "7cd084941338484aae1ad9425b84077c";
const SUB_KEY = "4932caff0ff746eab6f01bf08b70ac45";

// signWbi reads Date.now() internally to build the `wts` field, so it is only
// deterministic once the clock is pinned. 1_700_000_000_000 ms -> 1_700_000_000 s.
const FIXED_NOW_MS = 1_700_000_000_000;
const FIXED_WTS = 1_700_000_000;

describe("signWbi", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Golden/characterization values below were produced by executing the real
  // signWbi with Date.now pinned to FIXED_NOW_MS. They lock in current
  // MD5 + mixin-key + sorted-query behavior.

  it("signs a typical param set with a deterministic w_rid", () => {
    expect(signWbi({ foo: "114", bar: "514", baz: "1919810" }, IMG_KEY, SUB_KEY)).toEqual({
      foo: "114",
      bar: "514",
      baz: "1919810",
      wts: FIXED_WTS,
      w_rid: "efcb2ff452f5bc617792e9bc1c092c4f",
    });
  });

  it("signs an empty param set (only wts contributes)", () => {
    expect(signWbi({}, IMG_KEY, SUB_KEY)).toEqual({
      wts: FIXED_WTS,
      w_rid: "fa8bc5281f7826e95568a65f99b1e101",
    });
  });

  it("appends wts and a w_rid to the returned object", () => {
    const signed = signWbi({ foo: "1" }, IMG_KEY, SUB_KEY);
    expect(signed.wts).toBe(FIXED_WTS);
    expect(typeof signed.w_rid).toBe("string");
    // MD5 hex digest is always 32 lowercase hex chars.
    expect(signed.w_rid).toMatch(/^[0-9a-f]{32}$/);
  });

  it("preserves original param values (including numbers) in the output", () => {
    const signed = signWbi({ z: "last", a: "first", m: 42 }, IMG_KEY, SUB_KEY);
    expect(signed).toEqual({
      z: "last",
      a: "first",
      m: 42,
      wts: FIXED_WTS,
      w_rid: "3846192217c6386c2b1ac384c2640eea",
    });
  });

  it("sorts params by key when building the signed query (order-independent)", () => {
    // The same logical params supplied in different insertion orders must
    // produce the same w_rid because the query is sorted before hashing.
    const a = signWbi({ b: "2", a: "1", c: "3" }, IMG_KEY, SUB_KEY);
    const b = signWbi({ c: "3", a: "1", b: "2" }, IMG_KEY, SUB_KEY);
    expect(a.w_rid).toBe(b.w_rid);
  });

  it("filters !'()* from values before hashing but keeps them in the output", () => {
    const withSpecial = signWbi({ name: "ab!c'd(e)f*g" }, IMG_KEY, SUB_KEY);
    const preFiltered = signWbi({ name: "abcdefg" }, IMG_KEY, SUB_KEY);

    // Filtering only affects the hashed query; the returned value is untouched.
    expect(withSpecial.name).toBe("ab!c'd(e)f*g");
    // Hashing the filtered value yields an identical signature.
    expect(withSpecial.w_rid).toBe(preFiltered.w_rid);
    expect(withSpecial.w_rid).toBe("9fc62ad90cfc1d342976bb1cf0913da2");
  });

  it("overrides any caller-supplied wts with the current timestamp", () => {
    const signed = signWbi({ b: 2, a: 1, wts: "ignored-input" }, IMG_KEY, SUB_KEY);
    expect(signed.wts).toBe(FIXED_WTS);
    expect(signed).toEqual({
      b: 2,
      a: 1,
      wts: FIXED_WTS,
      w_rid: "ea94b54d19b1fed4fc11466aa87c5304",
    });
  });

  it("produces a different w_rid when the timestamp changes", () => {
    const atFixed = signWbi({ foo: "114", bar: "514", baz: "1919810" }, IMG_KEY, SUB_KEY);

    vi.spyOn(Date, "now").mockReturnValue(1_699_999_999_000);
    const atOther = signWbi({ foo: "114", bar: "514", baz: "1919810" }, IMG_KEY, SUB_KEY);

    expect(atOther.wts).toBe(1_699_999_999);
    expect(atOther.w_rid).toBe("88c99e044638c23736043c7408327cf6");
    expect(atOther.w_rid).not.toBe(atFixed.w_rid);
  });

  it("produces a different w_rid when the signing keys change", () => {
    const withKeys = signWbi({ foo: "1" }, IMG_KEY, SUB_KEY);
    const swapped = signWbi({ foo: "1" }, SUB_KEY, IMG_KEY);
    expect(withKeys.w_rid).not.toBe(swapped.w_rid);
  });
});
