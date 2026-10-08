import { afterEach, describe, expect, it, vi } from "vitest";
import { AIServiceManager } from "../src/services/ai/aiServiceManager.js";
import { AI_ERROR_KINDS, AIProviderError, classifyGeminiFailure, parseRetryAfter } from "../src/services/ai/errors.js";
import { createGeminiProvider } from "../src/services/ai/geminiProvider.js";
import { createOllamaProvider } from "../src/services/ai/ollamaProvider.js";

/** Scriptable fake provider: each call consumes the next behaviour. */
function fakeProvider(label, behaviours, name = label.startsWith("gemini") ? "gemini" : "ollama") {
  const calls = [];
  return {
    name,
    label,
    model: `${label}-model`,
    calls,
    async complete(args) {
      calls.push(args);
      const next = behaviours.length > 1 ? behaviours.shift() : behaviours[0];
      if (next instanceof Error) throw next;
      return next;
    },
    async health() {
      return { available: true };
    }
  };
}

const err = (kind, provider = "x", extra = {}) => new AIProviderError(kind, `${kind} from ${provider}`, { provider, ...extra });

function manager({ ollama, gemini = [], maxRetries = 1, clock } = {}) {
  const instance = new AIServiceManager({ ollama, geminiKeys: [], maxRetries, retryDelayMs: 1, now: clock ?? (() => Date.now()) });
  instance.gemini = gemini;
  return instance;
}

describe("AIServiceManager provider chain", () => {
  it("uses local Ollama first in auto mode and never touches Gemini when Ollama works", async () => {
    const ollama = fakeProvider("ollama", ["local answer"]);
    const g1 = fakeProvider("gemini-key-1", ["cloud answer"]);
    const result = await manager({ ollama, gemini: [g1] }).generate({ prompt: "hi", mode: "auto" });
    expect(result.text).toBe("local answer");
    expect(result.label).toBe("ollama");
    expect(g1.calls).toHaveLength(0);
  });

  it("falls back Ollama -> Gemini key 1 when Ollama is down", async () => {
    const ollama = fakeProvider("ollama", [err(AI_ERROR_KINDS.UNAVAILABLE, "ollama")]);
    const g1 = fakeProvider("gemini-key-1", ["cloud answer"]);
    const result = await manager({ ollama, gemini: [g1] }).generate({ prompt: "hi", mode: "auto" });
    expect(result.label).toBe("gemini-key-1");
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(["failed", "success"]);
  });

  it("rotates Gemini key 1 -> key 2 on a 429 quota error", async () => {
    const ollama = fakeProvider("ollama", [err(AI_ERROR_KINDS.UNAVAILABLE, "ollama")]);
    const g1 = fakeProvider("gemini-key-1", [err(AI_ERROR_KINDS.QUOTA, "gemini-key-1")]);
    const g2 = fakeProvider("gemini-key-2", ["key two answer"]);
    const result = await manager({ ollama, gemini: [g1, g2] }).generate({ prompt: "hi" });
    expect(result.label).toBe("gemini-key-2");
    expect(result.text).toBe("key two answer");
  });

  it("never retries a permanently invalid key again", async () => {
    const ollama = fakeProvider("ollama", [err(AI_ERROR_KINDS.UNAVAILABLE, "ollama")]);
    const g1 = fakeProvider("gemini-key-1", [err(AI_ERROR_KINDS.INVALID_KEY, "gemini-key-1")]);
    const g2 = fakeProvider("gemini-key-2", ["ok"]);
    const instance = manager({ ollama, gemini: [g1, g2] });

    await instance.generate({ prompt: "first" });
    await instance.generate({ prompt: "second" });
    await instance.generate({ prompt: "third" });

    expect(g1.calls).toHaveLength(1);
    expect(g2.calls).toHaveLength(3);
    const status = await instance.status();
    expect(status.gemini[0].state.disabled).toBe(true);
  });

  it("puts a rate-limited key on cooldown and uses it again once the cooldown passes", async () => {
    let now = 1_000_000;
    const ollama = fakeProvider("ollama", [err(AI_ERROR_KINDS.UNAVAILABLE, "ollama")]);
    const g1 = fakeProvider("gemini-key-1", [err(AI_ERROR_KINDS.RATE_LIMIT, "gemini-key-1", { retryAfterMs: 30_000 }), "recovered"]);
    const g2 = fakeProvider("gemini-key-2", ["key two"]);
    const instance = manager({ ollama, gemini: [g1, g2], clock: () => now });

    expect((await instance.generate({ prompt: "a" })).label).toBe("gemini-key-2");
    expect((await instance.generate({ prompt: "b" })).label).toBe("gemini-key-2");
    expect(g1.calls).toHaveLength(1);

    now += 31_000;
    const after = await instance.generate({ prompt: "c" });
    expect(after.label).toBe("gemini-key-1");
    expect(after.text).toBe("recovered");
  });

  it("retries a timeout on the same provider before falling back", async () => {
    const ollama = fakeProvider("ollama", [err(AI_ERROR_KINDS.TIMEOUT, "ollama"), "second try worked"]);
    const result = await manager({ ollama, maxRetries: 1 }).generate({ prompt: "hi" });
    expect(result.text).toBe("second try worked");
    expect(ollama.calls).toHaveLength(2);
    expect(result.attempts[0].outcome).toBe("retrying");
  });

  it("throws a graceful AI_PROVIDER_UNAVAILABLE error when every provider fails", async () => {
    const ollama = fakeProvider("ollama", [err(AI_ERROR_KINDS.UNAVAILABLE, "ollama")]);
    const g1 = fakeProvider("gemini-key-1", [err(AI_ERROR_KINDS.QUOTA, "gemini-key-1")]);
    const g2 = fakeProvider("gemini-key-2", [err(AI_ERROR_KINDS.INVALID_KEY, "gemini-key-2")]);
    await expect(manager({ ollama, gemini: [g1, g2] }).generate({ prompt: "hi" })).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
      statusCode: 503
    });
  });

  it("local-only mode never calls Gemini, even when Ollama fails", async () => {
    const ollama = fakeProvider("ollama", [err(AI_ERROR_KINDS.UNAVAILABLE, "ollama")]);
    const g1 = fakeProvider("gemini-key-1", ["cloud"]);
    await expect(manager({ ollama, gemini: [g1] }).generate({ prompt: "hi", mode: "ollama" })).rejects.toThrow(/unavailable/i);
    expect(g1.calls).toHaveLength(0);
  });

  it("gemini mode tries the keys first and falls back to Ollama", async () => {
    const ollama = fakeProvider("ollama", ["local"]);
    const g1 = fakeProvider("gemini-key-1", [err(AI_ERROR_KINDS.QUOTA, "gemini-key-1")]);
    const g2 = fakeProvider("gemini-key-2", [err(AI_ERROR_KINDS.QUOTA, "gemini-key-2")]);
    const result = await manager({ ollama, gemini: [g1, g2] }).generate({ prompt: "hi", mode: "gemini" });
    expect(result.label).toBe("ollama");
    expect(g1.calls).toHaveLength(1);
    expect(g2.calls).toHaveLength(1);
  });

  it("allowCloud=false keeps private RAG context away from Gemini", async () => {
    const ollama = fakeProvider("ollama", [err(AI_ERROR_KINDS.UNAVAILABLE, "ollama")]);
    const g1 = fakeProvider("gemini-key-1", ["cloud"]);
    await expect(manager({ ollama, gemini: [g1] }).generate({ prompt: "private", allowCloud: false })).rejects.toThrow();
    expect(g1.calls).toHaveLength(0);
  });
});

describe("Gemini error classification", () => {
  it("maps Google's error shapes to kinds", () => {
    expect(classifyGeminiFailure(400, '{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}')).toBe(AI_ERROR_KINDS.INVALID_KEY);
    expect(classifyGeminiFailure(403, "PERMISSION_DENIED")).toBe(AI_ERROR_KINDS.INVALID_KEY);
    expect(classifyGeminiFailure(429, "You exceeded your current quota, please check your plan and billing details")).toBe(AI_ERROR_KINDS.QUOTA);
    expect(classifyGeminiFailure(429, "Resource has been exhausted (e.g. check quota).")).toBe(AI_ERROR_KINDS.QUOTA);
    expect(classifyGeminiFailure(429, "Too many requests")).toBe(AI_ERROR_KINDS.RATE_LIMIT);
    expect(classifyGeminiFailure(404, "models/gemini-2.0-flash is not found")).toBe(AI_ERROR_KINDS.MODEL_NOT_FOUND);
    expect(classifyGeminiFailure(503, "overloaded")).toBe(AI_ERROR_KINDS.SERVER);
    expect(classifyGeminiFailure(400, "Invalid JSON payload")).toBe(AI_ERROR_KINDS.BAD_REQUEST);
  });

  it("reads Google's retry hints", () => {
    expect(parseRetryAfter('"retryDelay": "37s"')).toBe(37000);
    expect(parseRetryAfter("Please retry in 12.5s.")).toBe(12500);
    expect(parseRetryAfter("", "20")).toBe(20000);
    expect(parseRetryAfter("nothing")).toBeUndefined();
  });
});

describe("Gemini provider over HTTP (mocked fetch)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const secretKey = "AIzaSyTESTKEY-0000000000000000000000";

  it("sends the key only in the header and parses the answer", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createGeminiProvider({ apiKey: secretKey, model: "gemini-flash-latest", label: "gemini-key-1" });
    expect(await provider.complete({ system: "s", prompt: "p" })).toBe('{"ok":true}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain(secretKey);
    expect(init.headers["x-goog-api-key"]).toBe(secretKey);
  });

  it("classifies a 429 quota response and never leaks the key in the error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 429, message: "You exceeded your current quota. Please retry in 40s.", status: "RESOURCE_EXHAUSTED" } }), { status: 429 })));
    const provider = createGeminiProvider({ apiKey: secretKey, label: "gemini-key-1" });
    const failure = await provider.complete({ prompt: "p" }).catch((error) => error);
    expect(failure.kind).toBe(AI_ERROR_KINDS.QUOTA);
    expect(failure.retryAfterMs).toBe(40000);
    expect(failure.message).not.toContain(secretKey);
  });

  it("classifies a network failure as UNAVAILABLE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const failure = await createGeminiProvider({ apiKey: secretKey }).complete({ prompt: "p" }).catch((error) => error);
    expect(failure.kind).toBe(AI_ERROR_KINDS.UNAVAILABLE);
  });

  it("reports NOT_CONFIGURED without a key", async () => {
    const failure = await createGeminiProvider({ apiKey: "" }).complete({ prompt: "p" }).catch((error) => error);
    expect(failure.kind).toBe(AI_ERROR_KINDS.NOT_CONFIGURED);
  });
});

describe("Ollama provider (mocked fetch)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends num_ctx so long transcripts are not silently truncated", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ response: "{}" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await createOllamaProvider({ url: "http://ollama.test", model: "llama3", numCtx: 8192 }).complete({ prompt: "p" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.options.num_ctx).toBe(8192);
    expect(body.format).toBe("json");
  });

  it("maps connection refused to UNAVAILABLE and 404 to MODEL_NOT_FOUND", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const down = await createOllamaProvider({ url: "http://ollama.test" }).complete({ prompt: "p" }).catch((error) => error);
    expect(down.kind).toBe(AI_ERROR_KINDS.UNAVAILABLE);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("model not found", { status: 404 })));
    const missing = await createOllamaProvider({ url: "http://ollama.test", model: "nope" }).complete({ prompt: "p" }).catch((error) => error);
    expect(missing.kind).toBe(AI_ERROR_KINDS.MODEL_NOT_FOUND);
    expect(missing.message).toMatch(/ollama pull nope/);
  });

  it("returns one embedding per input", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }), { status: 200 })));
    const vectors = await createOllamaProvider({ url: "http://ollama.test" }).embed(["a", "b"]);
    expect(vectors).toHaveLength(2);
  });
});
