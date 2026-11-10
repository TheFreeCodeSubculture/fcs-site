import { rm } from "node:fs/promises";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { pool } from "../../src/db/index.js";
import { hashPassword } from "../../src/lib/password.js";

const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

describe.skipIf(!hasTestDatabase)("API integration", () => {
  const app = createApp();
  let adminToken = "";
  let editorToken = "";
  let adminRefresh = "";
  let eventId = "";
  let postId = "";
  let memberToken = "";

  async function login(email: string, password: string) {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ email, password });
    expect(response.status).toBe(200);
    return response.body as {
      accessToken: string;
      refreshToken: string;
      user: { id: string; role: string };
    };
  }

  beforeAll(async () => {
    await pool.query(`
      truncate table
        activity_log, analytics_events, analytics_pageviews, analytics_salts,
        subscriptions, email_sends, blog_versions, blog_drafts, blog_posts,
        repo_kinds, social_links, core_members, study_groups, resources,
        class_sessions, events, auth_email_verifications, auth_invites,
        auth_password_resets, auth_refresh_tokens, profiles
      restart identity cascade
    `);

    await pool.query(
      `insert into profiles (email, password_hash, display_name, role)
       values ($1, $2, 'Test Admin', 'admin')`,
      ["admin@test.local", await hashPassword("admin-password-123")],
    );

    await pool.query(
      `insert into profiles (email, password_hash, display_name, role)
       values ($1, $2, 'Test Editor', 'editor')`,
      ["editor@test.local", await hashPassword("editor-password-123")],
    );

    const admin = await login("admin@test.local", "admin-password-123");
    adminToken = admin.accessToken;
    adminRefresh = admin.refreshToken;

    const editor = await login("editor@test.local", "editor-password-123");
    editorToken = editor.accessToken;
  });

  afterAll(async () => {
    await pool.query(`
      truncate table
        activity_log, analytics_events, analytics_pageviews, analytics_salts,
        subscriptions, email_sends, blog_versions, blog_drafts, blog_posts,
        repo_kinds, social_links, core_members, study_groups, resources,
        class_sessions, events, auth_email_verifications, auth_invites,
        auth_password_resets, auth_refresh_tokens, profiles
      restart identity cascade
    `);
    await rm("./test-media", { recursive: true, force: true });
    await pool.end();
  });

  it("returns the signed-in profile", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      email: "admin@test.local",
      role: "admin",
    });
  });

  it("hides draft events and publishes scheduled ones", async () => {
    const created = await request(app)
      .post("/api/admin/events")
      .set("authorization", `Bearer ${adminToken}`)
      .send({
        title: "Integration event",
        starts_at: new Date(Date.now() + 86_400_000).toISOString(),
        stage: "draft",
      });

    expect(created.status).toBe(201);
    eventId = created.body.id;

    let publicEvents = await request(app).get("/api/public/events");
    expect(publicEvents.status).toBe(200);
    expect(publicEvents.body.some((row: { id: string }) => row.id === eventId)).toBe(false);

    const published = await request(app)
      .patch(`/api/admin/events/${eventId}`)
      .set("authorization", `Bearer ${adminToken}`)
      .send({ stage: "scheduled" });
    expect(published.status).toBe(200);

    publicEvents = await request(app).get("/api/public/events");
    expect(publicEvents.body.some((row: { id: string }) => row.id === eventId)).toBe(true);
  });

  it("records the actor in the activity log", async () => {
    const response = await request(app)
      .get("/api/admin/activity?limit=20")
      .set("authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(
      response.body.some(
        (row: { table_name: string; row_id: string; actor_email: string }) =>
          row.table_name === "events" &&
          row.row_id === eventId &&
          row.actor_email === "admin@test.local",
      ),
    ).toBe(true);
  });

  it("lets editors write but not delete", async () => {
    const created = await request(app)
      .post("/api/admin/resources")
      .set("authorization", `Bearer ${editorToken}`)
      .send({
        title: "Editor resource",
        url: "https://example.com/editor-resource",
        is_published: false,
      });

    expect(created.status).toBe(201);

    const deleted = await request(app)
      .delete(`/api/admin/resources/${created.body.id}`)
      .set("authorization", `Bearer ${editorToken}`);

    expect(deleted.status).toBe(403);

    const adminDeleted = await request(app)
      .delete(`/api/admin/resources/${created.body.id}`)
      .set("authorization", `Bearer ${adminToken}`);

    expect(adminDeleted.status).toBe(204);
  });

  it("keeps blog drafts private until published", async () => {
    const created = await request(app)
      .post("/api/admin/blog-posts")
      .set("authorization", `Bearer ${editorToken}`)
      .send({
        title: "Integration post",
        slug: "integration-post",
        body: "Hello",
        status: "draft",
        authors: [{ name: "Test Editor" }],
      });

    expect(created.status).toBe(201);
    postId = created.body.id;

    let posts = await request(app).get("/api/public/blog-posts");
    expect(posts.body.some((row: { id: string }) => row.id === postId)).toBe(false);

    const published = await request(app)
      .patch(`/api/admin/blog-posts/${postId}`)
      .set("authorization", `Bearer ${editorToken}`)
      .send({ status: "published" });

    expect(published.status).toBe(200);
    expect(published.body.published_at).toBeTruthy();

    posts = await request(app).get("/api/public/blog-posts");
    expect(posts.body.some((row: { id: string }) => row.id === postId)).toBe(true);

    const draft = await request(app)
      .put(`/api/admin/blog-drafts/${postId}`)
      .set("authorization", `Bearer ${editorToken}`)
      .send({ content: [{ type: "paragraph", text: "draft" }] });

    expect(draft.status).toBe(200);

    const version = await request(app)
      .post(`/api/admin/blog-posts/${postId}/versions`)
      .set("authorization", `Bearer ${editorToken}`)
      .send({ content: [{ type: "paragraph", text: "version" }], kind: "edit" });

    expect(version.status).toBe(201);
  });

  it("upserts repository curation", async () => {
    const saved = await request(app)
      .put("/api/admin/repo-kinds/INTEGRATION-REPO")
      .set("authorization", `Bearer ${editorToken}`)
      .send({ kind: "resource", pinned: true });

    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      repo_name: "INTEGRATION-REPO",
      kind: "resource",
      pinned: true,
    });
  });

  it("rotates refresh tokens and rejects the old one", async () => {
    const refreshed = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: adminRefresh });

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(adminRefresh);

    const reused = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: adminRefresh });

    expect(reused.status).toBe(401);
  });

  it("accepts an invite and creates the account", async () => {
    const invited = await request(app)
      .post("/api/admin/team/invite")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ email: "invited@test.local", role: "editor" });

    expect(invited.status).toBe(201);
    const token = new URL(invited.body.inviteUrl).hash.match(/token=([^&]+)/)?.[1];
    expect(token).toBeTruthy();

    const accepted = await request(app)
      .post("/api/auth/accept-invite")
      .send({
        token: decodeURIComponent(token!),
        password: "invited-password-123",
        displayName: "Invited Editor",
      });

    expect(accepted.status).toBe(201);
    expect(accepted.body.user.role).toBe("editor");

    const loggedIn = await request(app)
      .post("/api/auth/login")
      .send({ email: "invited@test.local", password: "invited-password-123" });

    expect(loggedIn.status).toBe(200);
  });

  it("resets a password with a one-time token", async () => {
    const forgot = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "editor@test.local" });

    expect(forgot.status).toBe(200);
    expect(forgot.body.resetUrl).toBeTruthy();
    expect(new URL(forgot.body.resetUrl).pathname.endsWith("/admin.html")).toBe(true);

    const token = new URL(forgot.body.resetUrl).hash.match(/token=([^&]+)/)?.[1];
    expect(token).toBeTruthy();

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({
        token: decodeURIComponent(token!),
        newPassword: "editor-password-456",
      });

    expect(reset.status).toBe(200);

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "editor@test.local", password: "editor-password-123" });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "editor@test.local", password: "editor-password-456" });
    expect(newLogin.status).toBe(200);
  });

  it("uploads and deletes a member photo", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );

    const uploaded = await request(app)
      .post("/api/admin/member-photos")
      .set("authorization", `Bearer ${editorToken}`)
      .attach("full", png, { filename: "full.png", contentType: "image/png" })
      .attach("thumb", png, { filename: "thumb.png", contentType: "image/png" });

    expect(uploaded.status).toBe(201);
    expect(uploaded.body.photo_url).toContain("/media/members/");
    expect(uploaded.body.photo_thumb_url).toContain("-24.png");

    const deleted = await request(app)
      .delete("/api/admin/member-photos")
      .set("authorization", `Bearer ${editorToken}`)
      .send({ urls: [uploaded.body.photo_url, uploaded.body.photo_thumb_url] });

    expect(deleted.status).toBe(204);
  });

  it("collects an analytics beacon and reports it", async () => {
    const viewKey = crypto.randomUUID();
    const beacon = await request(app)
      .post("/api/track")
      .set("origin", "http://localhost:8000")
      .set("user-agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36")
      .set("content-type", "text/plain")
      .send(JSON.stringify({
        type: "view",
        key: viewKey,
        path: "/integration-analytics",
        session: "integration-session",
        is_new: true,
        device: "desktop",
        tz: "Asia/Kolkata",
      }));

    expect(beacon.status).toBe(204);

    const now = new Date();
    const since = new Date(now.getTime() - 3600_000).toISOString();
    const until = new Date(now.getTime() + 3600_000).toISOString();
    const report = await request(app)
      .get("/api/admin/analytics")
      .query({ since, until, tz: "Asia/Kolkata" })
      .set("authorization", `Bearer ${adminToken}`);

    expect(report.status).toBe(200);
    expect(
      report.body.pages.some((page: { name: string }) => page.name === "/integration-analytics"),
    ).toBe(true);

    // Chrome reports India as Asia/Calcutta; PostgreSQL only accepts
    // Asia/Kolkata. Both names must produce the same buckets.
    const alias = await request(app)
      .get("/api/admin/analytics")
      .query({ since, until, tz: "Asia/Calcutta" })
      .set("authorization", `Bearer ${adminToken}`);
    expect(alias.status).toBe(200);
    expect(alias.body.series).toEqual(report.body.series);

    const rejected = await request(app)
      .post("/api/track")
      .set("origin", "https://evil.example")
      .set("user-agent", "Mozilla/5.0 Chrome/120")
      .set("content-type", "text/plain")
      .send(JSON.stringify({
        type: "view",
        key: crypto.randomUUID(),
        path: "/integration-evil",
        session: "integration-session",
      }));

    expect(rejected.status).toBe(204);

    const evilRows = await pool.query(
      "select 1 from analytics_pageviews where path = '/integration-evil'",
    );
    expect(evilRows.rowCount).toBe(0);
  });

  it("handles subscription lookup, confirmation and unsubscribe", async () => {
    const token = crypto.randomUUID();
    await pool.query(
      `insert into subscriptions (email, token, confirmed_at)
       values ($1, $2, null)`,
      ["subscriber@test.local", token],
    );

    const lookup = await request(app)
      .post("/api/event-mail")
      .send({ action: "lookup", token });

    expect(lookup.status).toBe(200);
    expect(lookup.body.list).toBe("all FCS events");
    expect(lookup.body.confirmed).toBe(false);

    const confirmed = await request(app)
      .post("/api/event-mail")
      .send({ action: "confirm", token });

    expect(confirmed.status).toBe(200);

    const row = await pool.query(
      "select confirmed_at from subscriptions where token = $1",
      [token],
    );
    expect(row.rows[0].confirmed_at).toBeTruthy();

    const unsubscribed = await request(app)
      .post("/api/event-mail")
      .send({ action: "unsubscribe", token, everything: false });

    expect(unsubscribed.status).toBe(200);
    expect(
      await pool.query("select 1 from subscriptions where token = $1", [token]),
    ).toMatchObject({ rowCount: 0 });
  });

  it("lets an admin add and remove a subscriber", async () => {
    const added = await request(app)
      .post("/api/admin/subscriptions")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ emails: ["admin-added@test.local"], eventId: null });

    expect(added.status).toBe(201);
    expect(added.body.added).toBe(1);

    const list = await request(app)
      .get("/api/admin/subscriptions")
      .set("authorization", `Bearer ${adminToken}`);

    expect(list.status).toBe(200);
    const subscription = list.body.find(
      (row: { email: string }) => row.email === "admin-added@test.local",
    );
    expect(subscription).toBeTruthy();

    const removed = await request(app)
      .delete(`/api/admin/subscriptions/${subscription.id}`)
      .set("authorization", `Bearer ${adminToken}`);

    expect(removed.status).toBe(204);
  });

  it("signs up a member, requires verification and lists only opted-in profiles", async () => {
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({
        email: "member@test.local",
        password: "member-password-123",
        displayName: "Test Member",
        directoryOptIn: true,
        emailUpdates: true,
      });

    expect(signup.status).toBe(201);
    expect(signup.body.verifyUrl).toBeTruthy();

    const verifyUrl = new URL(signup.body.verifyUrl);
    expect(verifyUrl.pathname.endsWith("/")).toBe(true);
    expect(verifyUrl.hash).toMatch(/^#verify=/);
    const verifyToken = verifyUrl.hash.match(/verify=([^&]+)/)?.[1];
    expect(verifyToken).toBeTruthy();

    const blocked = await request(app)
      .post("/api/auth/login")
      .send({ email: "member@test.local", password: "member-password-123" });

    expect(blocked.status).toBe(403);

    const verified = await request(app)
      .post("/api/auth/verify-email")
      .send({ token: decodeURIComponent(verifyToken!) });

    expect(verified.status).toBe(200);
    expect(verified.body.user.role).toBe("member");
    expect(verified.body.user.email_verified_at).toBeTruthy();
    memberToken = verified.body.accessToken;

    const subscription = await pool.query(
      `select confirmed_at from subscriptions
        where email = 'member@test.local' and event_id is null`,
    );
    expect(subscription.rows[0]?.confirmed_at).toBeTruthy();

    const forgot = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "member@test.local" });
    expect(forgot.status).toBe(200);
    const memberReset = new URL(forgot.body.resetUrl);
    expect(memberReset.pathname.endsWith("/")).toBe(true);
    expect(memberReset.hash).toContain("type=recovery");

    const directory = await request(app).get("/api/public/members");
    expect(directory.status).toBe(200);
    const listed = directory.body.find(
      (row: { display_name: string }) => row.display_name === "Test Member",
    );
    expect(listed).toBeTruthy();
    expect(listed).not.toHaveProperty("email");

    const team = await request(app)
      .get("/api/admin/team")
      .set("authorization", `Bearer ${adminToken}`);

    expect(team.status).toBe(200);
    expect(team.body.some((row: { email: string }) => row.email === "member@test.local")).toBe(false);
  });

  it("edits a member profile and controls the all-events preference", async () => {
    const updated = await request(app)
      .patch("/api/account/profile")
      .set("authorization", `Bearer ${memberToken}`)
      .send({
        display_name: "Test Member",
        bio: "Learning in public.",
        website_url: "https://example.com/member",
        github_username: "@octocat",
        avatar_url: "https://example.com/avatar.png",
        directory_opted_in: false,
      });

    expect(updated.status).toBe(200);
    expect(updated.body.github_username).toBe("octocat");
    expect(updated.body.directory_opted_in).toBe(false);

    const directory = await request(app).get("/api/public/members");
    expect(
      directory.body.some((row: { display_name: string }) => row.display_name === "Test Member"),
    ).toBe(false);

    const off = await request(app)
      .patch("/api/account/email-preferences")
      .set("authorization", `Bearer ${memberToken}`)
      .send({ emailUpdates: false });

    expect(off.status).toBe(200);
    expect(
      await pool.query(
        "select 1 from subscriptions where email = 'member@test.local' and event_id is null",
      ),
    ).toMatchObject({ rowCount: 0 });

    const on = await request(app)
      .patch("/api/account/email-preferences")
      .set("authorization", `Bearer ${memberToken}`)
      .send({ emailUpdates: true });

    expect(on.status).toBe(200);
    const restored = await pool.query(
      "select confirmed_at from subscriptions where email = 'member@test.local' and event_id is null",
    );
    expect(restored.rows[0]?.confirmed_at).toBeTruthy();
  });

  it("uploads and removes a member avatar", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );

    const uploaded = await request(app)
      .post("/api/account/avatar")
      .set("authorization", `Bearer ${memberToken}`)
      .attach("file", png, { filename: "avatar.png", contentType: "image/png" });

    expect(uploaded.status).toBe(200);
    expect(uploaded.body.avatar_url).toContain("/media/members/avatars/");

    const profile = await request(app)
      .get("/api/account/profile")
      .set("authorization", `Bearer ${memberToken}`);
    expect(profile.body.avatar_url).toBe(uploaded.body.avatar_url);

    const removed = await request(app)
      .delete("/api/account/avatar")
      .set("authorization", `Bearer ${memberToken}`);
    expect(removed.status).toBe(200);
    expect(removed.body.avatar_url).toBeNull();
  });

  it("rejects unsafe member profile URLs and usernames", async () => {
    for (const patch of [
      { avatar_url: "http://example.com/avatar.png" },
      { website_url: "javascript:alert(1)" },
      { github_username: "bad user" },
    ]) {
      const response = await request(app)
        .patch("/api/account/profile")
        .set("authorization", `Bearer ${memberToken}`)
        .send(patch);

      expect(response.status).toBe(400);
    }
  });

  it("prevents removing the last admin", async () => {
    const admins = await pool.query<{ id: string }>(
      "select id from profiles where role = 'admin'",
    );
    expect(admins.rowCount).toBe(1);

    const response = await request(app)
      .delete(`/api/admin/team/${admins.rows[0].id}`)
      .set("authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });
});
