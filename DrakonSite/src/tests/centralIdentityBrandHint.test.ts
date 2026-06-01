import test from "node:test";
import assert from "node:assert/strict";

import { extractCentralIdentityGrantBrandHint } from "../worker/centralIdentityBrandHint";

function encodeBase64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf-8").toString("base64url");
}

function buildGrantToken(payload: Record<string, unknown>): string {
  return [
    encodeBase64UrlJson({ alg: "none", typ: "JWT" }),
    encodeBase64UrlJson(payload),
    "signature",
  ].join(".");
}

test("extractCentralIdentityGrantBrandHint returns the brand from the stored grant payload", () => {
  const token = buildGrantToken({
    public_id: "user-public-id",
    brand_id: "perceptrum",
  });

  assert.equal(
    extractCentralIdentityGrantBrandHint(token, {
      expectedPublicId: "user-public-id",
    }),
    "perceptrum"
  );
});

test("extractCentralIdentityGrantBrandHint rejects tokens from a different public id", () => {
  const token = buildGrantToken({
    public_id: "owner-public-id",
    brand_id: "perceptrum",
  });

  assert.equal(
    extractCentralIdentityGrantBrandHint(token, {
      expectedPublicId: "operator-public-id",
    }),
    null
  );
});

test("extractCentralIdentityGrantBrandHint ignores unsupported brand ids", () => {
  const token = buildGrantToken({
    public_id: "user-public-id",
    brand_id: "unknown-brand",
  });

  assert.equal(extractCentralIdentityGrantBrandHint(token), null);
});
