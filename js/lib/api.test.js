import assert from "node:assert/strict";
import { test } from "node:test";

const memory = new Map();

function installBrowser(config = { apiBaseUrl: "https://api.test" }) {
  memory.clear();
  globalThis.FCS_CONFIG = config;
  globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };
  globalThis.location = { hash: "" };
}

async function load() {
  // Each test gets a fresh module instance, so the in-memory session does
  // not leak between tests.
  return import(`../api.js?test=${Math.random()}`);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("public reads fall back to seed data when the API fails", async () => {
  installBrowser();
  globalThis.fetch = async () => {
    throw new Error("offline");
  };

  const api = await load();
  const seed = [{ id: "seed" }];
  assert.deepEqual(await api.getEvents(seed), seed);
});

test("public reads prefer API data, even when it is empty", async () => {
  installBrowser();
  globalThis.fetch = async () => json([]);

  const api = await load();
  assert.deepEqual(await api.getResources([{ id: "seed" }]), []);
});

test("sign in stores the session and user", async () => {
  installBrowser();
  globalThis.fetch = async () =>
    json({
      accessToken: "access",
      refreshToken: "refresh",
      user: { id: "u1", email: "a@example.com", role: "admin" },
    });

  const api = await load();
  const user = await api.signIn("a@example.com", "password");

  assert.equal(user.email, "a@example.com");
  assert.equal((await api.getSession()).user.id, "u1");
  assert.equal(api.isConfigured(), true);
});

test("admin writes send the bearer token and JSON body", async () => {
  installBrowser();
  memory.set(
    "fcs-api-session",
    JSON.stringify({
      accessToken: "access",
      refreshToken: "refresh",
      user: { id: "u1", email: "a@example.com", role: "admin" },
    }),
  );

  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return json({ id: "e1", title: "New event" }, 201);
  };

  const api = await load();
  const event = await api.createEvent({ title: "New event", starts_at: "2030-01-01T00:00:00.000Z" });

  assert.equal(event.id, "e1");
  assert.equal(request.url, "https://api.test/api/admin/events");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.authorization, "Bearer access");
  assert.deepEqual(JSON.parse(request.options.body), {
    title: "New event",
    starts_at: "2030-01-01T00:00:00.000Z",
  });
});

test("password reset uses the token from the URL hash", async () => {
  installBrowser();
  globalThis.location.hash = "#type=recovery&token=reset-token";

  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return json({
      accessToken: "access",
      refreshToken: "refresh",
      user: { id: "u1", email: "a@example.com", role: "admin" },
    });
  };

  const api = await load();
  await api.updatePassword("new-password-123");

  assert.equal(request.url, "https://api.test/api/auth/reset-password");
  assert.deepEqual(JSON.parse(request.options.body), {
    token: "reset-token",
    newPassword: "new-password-123",
  });
});

test("readAdminTable maps database names to API routes", async () => {
  installBrowser();
  memory.set(
    "fcs-api-session",
    JSON.stringify({
      accessToken: "access",
      refreshToken: "refresh",
      user: { id: "u1", email: "a@example.com", role: "admin" },
    }),
  );

  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return json([]);
  };

  const api = await load();
  await api.readAdminTable("class_sessions");
  await api.readAdminTable("repo_kinds");

  assert.deepEqual(urls, [
    "https://api.test/api/admin/class-sessions",
    "https://api.test/api/public/repo-kinds",
  ]);
});
