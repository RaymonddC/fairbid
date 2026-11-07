import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeNext } from "../safe-next";

describe("safeNext", () => {
  it("keeps a same-site path", () => {
    assert.equal(safeNext("/tender/1?tab=bids"), "/tender/1?tab=bids");
  });

  it("refuses anything that leaves the site", () => {
    for (const next of ["//evil.example", "/\\evil.example", "/\\\\evil.example", "https://evil.example", "evil", "", null, undefined, 7]) {
      assert.equal(safeNext(next), "/", String(next));
    }
  });
});
