import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { createVertexClientOpts, stripFallbacks } from "./index.ts";

describe("createVertexClientOpts", () => {
  it("sets interleaved-thinking header for non-adaptive model with no request headers", () => {
    const opts = createVertexClientOpts(
      "proj",
      "us-east5",
      false,
    );
    assert.deepEqual(opts.defaultHeaders, {
      "anthropic-beta": "interleaved-thinking-2025-05-14",
    });
  });

  it("omits defaultHeaders for adaptive model with no request headers", () => {
    const opts = createVertexClientOpts(
      "proj",
      "us-east5",
      true,
    );
    assert.equal(opts.defaultHeaders, undefined);
  });

  it("preserves non-beta request headers", () => {
    const opts = createVertexClientOpts(
      "proj",
      "us-east5",
      true,
      {
        "x-custom": "value",
      },
    );
    assert.deepEqual(opts.defaultHeaders, { "x-custom": "value" });
  });

  it("merges request beta header with automatic beta", () => {
    const opts = createVertexClientOpts(
      "proj",
      "us-east5",
      false,
      {
        "anthropic-beta": "my-beta",
        "x-other": "keep",
      },
    );
    assert.deepEqual(opts.defaultHeaders, {
      "anthropic-beta": "interleaved-thinking-2025-05-14,my-beta",
      "x-other": "keep",
    });
  });

  it("removes anthropic-beta from headers when empty for adaptive model", () => {
    const opts = createVertexClientOpts(
      "proj",
      "us-east5",
      true,
      {
        "anthropic-beta": "",
        "x-other": "keep",
      },
    );
    assert.deepEqual(opts.defaultHeaders, { "x-other": "keep" });
  });

  it("deduplicates user beta matching automatic beta", () => {
    const opts = createVertexClientOpts(
      "proj",
      "us-east5",
      false,
      {
        "anthropic-beta": "interleaved-thinking-2025-05-14",
      },
    );
    assert.deepEqual(opts.defaultHeaders, {
      "anthropic-beta": "interleaved-thinking-2025-05-14",
    });
  });

  it("trims whitespace and skips empty entries in user betas", () => {
    const opts = createVertexClientOpts(
      "proj",
      "us-east5",
      true,
      {
        "anthropic-beta": " beta-a , , beta-b ",
      },
    );
    assert.deepEqual(opts.defaultHeaders, {
      "anthropic-beta": "beta-a,beta-b",
    });
  });

  it("passes through user beta for adaptive model without adding interleaved-thinking", () => {
    const opts = createVertexClientOpts(
      "proj",
      "us-east5",
      true,
      {
        "anthropic-beta": "custom-beta",
      },
    );
    assert.deepEqual(opts.defaultHeaders, {
      "anthropic-beta": "custom-beta",
    });
  });

  it("passes projectId and region through", () => {
    const opts = createVertexClientOpts(
      "my-project",
      "europe-west1",
      true,
    );
    assert.equal(opts.projectId, "my-project");
    assert.equal(opts.region, "europe-west1");
  });
});

describe("stripFallbacks", () => {
  it("removes allowedFallbackModels and keeps the other compat fields", () => {
    // Shape of claude-opus-5 in pi's first-party Anthropic catalog.
    const input = {
      forceAdaptiveThinking: true,
      supportsTemperature: false,
      allowedFallbackModels: [
        { provider: "anthropic", model: "claude-opus-4-8" },
      ],
    } as unknown as Model<Api>["compat"];

    assert.deepEqual(stripFallbacks(input), {
      forceAdaptiveThinking: true,
      supportsTemperature: false,
    });
  });

  it("leaves compat without allowedFallbackModels untouched", () => {
    const compat = { forceAdaptiveThinking: true, supportsTemperature: false };
    assert.deepEqual(stripFallbacks(compat), compat);
  });

  it("passes undefined compat through", () => {
    assert.equal(stripFallbacks(undefined), undefined);
  });
});
