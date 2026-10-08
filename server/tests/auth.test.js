import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Multi-user mode for this file only (vitest isolates modules per test file).
Object.assign(process.env, {
  AUTH_ENABLED: "true",
  JWT_SECRET: "test-secret-for-auth-suite-0123456789abcdef0123456789",
  JWT_REFRESH_SECRET: "",
  AUTH_RATE_LIMIT_MAX: "100",
  BCRYPT_SALT_ROUNDS: "4",
  EMAIL_HOST: ""
});

const { createApp } = await import("../src/app.js");
const { User } = await import("../src/models/User.js");

const TEST_URI = process.env.TEST_MONGODB_URI_AUTH ?? "mongodb://127.0.0.1:27017/meetai_test_auth";
let mongoAvailable = false;
try {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 3000 });
  mongoAvailable = true;
} catch {
  mongoAvailable = false;
}

let app;
beforeAll(async () => {
  if (!mongoAvailable) return;
  await mongoose.connection.dropDatabase();
  await User.init();
  app = createApp();
});
afterAll(async () => {
  if (mongoAvailable) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

const alice = { name: "Alice", email: "alice@example.com", password: "Str0ng-pass!" };
const bob = { name: "Bob", email: "bob@example.com", password: "An0ther-pass!" };

(mongoAvailable ? describe : describe.skip)("authentication (AUTH_ENABLED=true)", () => {
  let aliceTokens;
  let bobTokens;

  it("registers a user, hashes the password with bcrypt and never returns it", async () => {
    const response = await request(app).post("/api/v1/auth/register").send({ ...alice, role: "ADMIN" }).expect(201);
    aliceTokens = response.body.data;
    expect(aliceTokens.accessToken).toBeTruthy();
    expect(aliceTokens.refreshToken).toBeTruthy();
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|Str0ng-pass/);

    const stored = await User.findOne({ email: alice.email }).select("+passwordHash");
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    // role sent by the client is ignored: self-registration can never create an admin
    expect(stored.role).toBe("USER");
  });

  it("rejects a duplicate email with 409", async () => {
    const response = await request(app).post("/api/v1/auth/register").send(alice).expect(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });

  it("validates registration input with Joi (422)", async () => {
    const response = await request(app).post("/api/v1/auth/register").send({ name: "x", email: "not-an-email", password: "short" }).expect(422);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.map((detail) => detail.field)).toEqual(expect.arrayContaining(["email", "password"]));
  });

  it("logs in with the right password and rejects the wrong one", async () => {
    await request(app).post("/api/v1/auth/login").send({ email: alice.email, password: "wrong-password" }).expect(401);
    const response = await request(app).post("/api/v1/auth/login").send({ email: alice.email, password: alice.password }).expect(200);
    aliceTokens = response.body.data;
  });

  it("protects the API: 401 without a token, 401 with a forged token, 200 with a valid JWT", async () => {
    const missing = await request(app).get("/api/v1/meetings").expect(401);
    expect(missing.body.error.code).toBe("UNAUTHORIZED");
    await request(app).get("/api/v1/meetings").set("Authorization", "Bearer not.a.jwt").expect(401);
    await request(app).get("/api/v1/meetings").set("Authorization", `Bearer ${aliceTokens.accessToken}`).expect(200);
    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${aliceTokens.accessToken}`).expect(200);
    expect(me.body.data.email).toBe(alice.email);
  });

  it("does not accept a refresh token as an access token", async () => {
    await request(app).get("/api/v1/meetings").set("Authorization", `Bearer ${aliceTokens.refreshToken}`).expect(401);
  });

  it("issues a new access token from a refresh token", async () => {
    const response = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: aliceTokens.refreshToken }).expect(200);
    expect(response.body.data.accessToken).toBeTruthy();
    await request(app).post("/api/v1/auth/refresh").send({ refreshToken: "garbage" }).expect(401);
  });

  it("isolates data between users (authorization)", async () => {
    bobTokens = (await request(app).post("/api/v1/auth/register").send(bob).expect(201)).body.data;
    const created = await request(app)
      .post("/api/v1/meetings")
      .set("Authorization", `Bearer ${aliceTokens.accessToken}`)
      .send({ title: "Alice private meeting", startTime: "2026-10-10T10:00:00Z" })
      .expect(201);
    const id = created.body.data.id;

    await request(app).get(`/api/v1/meetings/${id}`).set("Authorization", `Bearer ${bobTokens.accessToken}`).expect(404);
    await request(app).patch(`/api/v1/meetings/${id}`).set("Authorization", `Bearer ${bobTokens.accessToken}`).send({ title: "hacked" }).expect(404);
    await request(app).delete(`/api/v1/meetings/${id}`).set("Authorization", `Bearer ${bobTokens.accessToken}`).expect(404);
    const bobList = await request(app).get("/api/v1/meetings").set("Authorization", `Bearer ${bobTokens.accessToken}`).expect(200);
    expect(bobList.body.data).toHaveLength(0);
  });

  it("logout revokes the refresh token", async () => {
    await request(app).post("/api/v1/auth/logout").set("Authorization", `Bearer ${aliceTokens.accessToken}`).expect(200);
    await request(app).post("/api/v1/auth/refresh").send({ refreshToken: aliceTokens.refreshToken }).expect(401);
  });
});

(mongoAvailable ? describe : describe.skip)("security hardening", () => {
  let token;
  beforeAll(async () => {
    token = (await request(app).post("/api/v1/auth/login").send({ email: bob.email, password: bob.password })).body.data.accessToken;
  });

  it("returns 400 INVALID_ID for a malformed id instead of a 500", async () => {
    const response = await request(app).get("/api/v1/meetings/not-an-id").set("Authorization", `Bearer ${token}`).expect(400);
    expect(response.body).toMatchObject({ success: false, error: { code: "INVALID_ID" } });
  });

  it("returns a consistent error envelope for unknown routes", async () => {
    const response = await request(app).get("/api/v1/does-not-exist").set("Authorization", `Bearer ${token}`).expect(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(response.body).not.toHaveProperty("stack");
  });

  it("treats search text literally (no regex injection / ReDoS)", async () => {
    await request(app).get("/api/v1/meetings?search=(a%2B)%2B%24").set("Authorization", `Bearer ${token}`).expect(200);
    await request(app).get("/api/v1/meetings?search=%5B").set("Authorization", `Bearer ${token}`).expect(200);
  });

  it("strips Mongo operators from input (NoSQL injection)", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({ email: { $gt: "" }, password: { $gt: "" } });
    expect([400, 401, 422]).toContain(response.status);
  });

  it("rejects malformed JSON with 400 INVALID_JSON", async () => {
    const response = await request(app)
      .post("/api/v1/meetings")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send('{"title": ')
      .expect(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });

  it("escapes the OAuth callback page (no reflected XSS)", async () => {
    const response = await request(app).get("/api/v1/integrations/gmail/callback?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E").expect(400);
    expect(response.text).not.toContain("<script>alert(1)</script>");
    expect(response.text).toContain("&lt;script&gt;");
  });

  it("sets Helmet security headers", async () => {
    const response = await request(app).get("/health");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("never exposes secrets in settings or status responses", async () => {
    const settings = await request(app).get("/api/v1/system/settings").set("Authorization", `Bearer ${token}`).expect(200);
    const body = JSON.stringify(settings.body);
    expect(body).not.toContain(process.env.JWT_SECRET);
    expect(body).not.toMatch(/AIza|ntn_|EMAIL_PASSWORD|passwordHash/);
  });

  it("rejects RAG input that fails validation", async () => {
    await request(app).post("/api/v1/rag/search").set("Authorization", `Bearer ${token}`).send({ query: "" }).expect(422);
    await request(app).post("/api/v1/rag/documents").set("Authorization", `Bearer ${token}`).send({ title: "x" }).expect(422);
  });
});
