import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KEY_PREFIX, bearerToken, hashKey, newKey, parseSellerKeys, sellerForToken } from "../mcp/keys";

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

describe("keys sellers make on their dashboard", () => {
  it("are long, random and prefixed, and only their hash is kept", () => {
    const a = newKey();
    const b = newKey();
    assert.ok(a.key.startsWith(KEY_PREFIX));
    assert.ok(a.key.length >= KEY_PREFIX.length + 43, "32 random bytes in base64url");
    assert.notEqual(a.key, b.key);
    assert.equal(a.hash, hashKey(a.key));
    assert.match(a.hash, /^[0-9a-f]{64}$/);
    assert.ok(!a.hash.includes(a.key.slice(KEY_PREFIX.length)));
  });

  it("show only a short prefix, which cannot be used as the key", () => {
    const { key, prefix } = newKey();
    assert.equal(prefix, key.slice(0, KEY_PREFIX.length + 6));
    assert.ok(prefix.length < 12);
  });

  it("are read from a bearer header and nothing else", () => {
    assert.equal(bearerToken("Bearer fbk_abc"), "fbk_abc");
    assert.equal(bearerToken("bearer   fbk_abc"), "fbk_abc");
    assert.equal(bearerToken("Basic fbk_abc"), null);
    assert.equal(bearerToken("Bearer fbk_abc extra"), null);
    assert.equal(bearerToken(null), null);
  });
});
