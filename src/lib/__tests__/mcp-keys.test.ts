import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSellerKeys, sellerForToken } from "../mcp/keys";

const KEY_A = "a".repeat(32);
const KEY_B = "b".repeat(32);

describe("seller API keys", () => {
  const keys = parseSellerKeys(`seller-a:${KEY_A}, seller-b:${KEY_B},seller-c:short,:${"x".repeat(30)},junk`);

  it("keeps well-formed pairs and drops short keys and junk", () => {
    assert.deepEqual([...keys.values()].sort(), ["seller-a", "seller-b"]);
  });

  it("maps a bearer token to its seller", () => {
    assert.equal(sellerForToken(`Bearer ${KEY_B}`, keys), "seller-b");
    assert.equal(sellerForToken(`bearer ${KEY_A}`, keys), "seller-a");
  });

  it("refuses a missing, malformed or unknown token", () => {
    assert.equal(sellerForToken(null, keys), null);
    assert.equal(sellerForToken(KEY_A, keys), null);
    assert.equal(sellerForToken(`Bearer ${"c".repeat(32)}`, keys), null);
    assert.equal(sellerForToken("Bearer short", keys), null);
  });

  it("refuses everything when no keys are configured", () => {
    assert.equal(sellerForToken(`Bearer ${KEY_A}`, parseSellerKeys(undefined)), null);
  });
});
