/*
 * js/api.js
 * ------------------------------------------------------------------
 * The only module that talks to the FCS backend. It keeps the exported
 * function names the site already used, so the rest of the frontend
 * changes as little as possible.
 *
 * Reads fall back to the seed data in data.js on any failure. The admin
 * panel uses the same functions.
 * ------------------------------------------------------------------
 */

const root = typeof window !== "undefined" ? window : globalThis;
const config = root.FCS_CONFIG || {};
const BASE = String(config.apiBaseUrl || "").replace(/\/$/, "");
const SESSION_KEY = "fcs-api-session";
const REQUEST_TIMEOUT = 15_000;

// Capture the reset/invite token before the admin page clears the hash.
const initialHash =
  typeof root.location !== "undefined" ? root.location.hash.slice(1) : "";
const initialParams = new URLSearchParams(initialHash);
const initialLink = {
  type: initialParams.get("type"),
  token: initialParams.get("token"),
};

const memory = new Map();
const storage = (() => {
  try {
    return root.localStorage || null;
  } catch {
    return null;
  }
})();

function stored(key) {
  try {
    return storage ? storage.getItem(key) : memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function store(key, value) {
  try {
    if (storage) storage.setItem(key, value);
    else memory.set(key, value);
  } catch {
    memory.set(key, value);
  }
}

function removeStored(key) {
  try {
    if (storage) storage.removeItem(key);
    else memory.delete(key);
  } catch {
    memory.delete(key);
  }
}

let session = null;

/** @returns {boolean} whether an API base URL has been configured */
export function isConfigured() {
  return Boolean(BASE);
}

/** Kept for the old call site; the API needs no persistent connection. */
export function connect() {
  return isConfigured();
}

function loadSession() {
  if (session) return session;
  try {
    session = JSON.parse(stored(SESSION_KEY) || "null");
  } catch {
    session = null;
  }
  return session;
}

function saveSession(data) {
  session = data;
  store(SESSION_KEY, JSON.stringify(data));
  return data;
}

function clearSession() {
  session = null;
  removeStored(SESSION_KEY);
}

async function readResponse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function refreshSession() {
  const current = loadSession();
  if (!current?.refreshToken) throw new Error("Sign in again.");

  const response = await fetch(`${BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  const data = await readResponse(response);
  if (!response.ok) {
    clearSession();
    throw new Error(data?.error || "Your session expired. Sign in again.");
  }
  return saveSession(data);
}

/**
 * @param {string} path
 * @param {{method?: string, body?: unknown, auth?: boolean, retry?: boolean, headers?: object}} options
 */
async function api(path, { method = "GET", body, auth = true, retry = true, headers = {} } = {}) {
  if (!isConfigured()) throw new Error("The backend is not configured.");

  const current = loadSession();
  const requestHeaders = { ...headers };
  let requestBody;

  if (body instanceof FormData) {
    requestBody = body;
  } else if (body !== undefined) {
    requestHeaders["content-type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  if (auth && current?.accessToken) {
    requestHeaders.authorization = `Bearer ${current.accessToken}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 && auth && retry && current?.refreshToken) {
    await refreshSession();
    return api(path, { method, body, auth, retry: false, headers });
  }

  const data = await readResponse(response);
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

/* ---- session and roles ---------------------------------------------- */

export async function getSession() {
  const current = loadSession();
  return current?.user ? { user: current.user } : null;
}

export async function signIn(email, password) {
  const data = await api("/api/auth/login", {
    method: "POST",
    auth: false,
    body: { email, password },
  });
  saveSession(data);
  return data.user;
}

export async function signOut() {
  const current = loadSession();
  try {
    if (current?.refreshToken) {
      await api("/api/auth/logout", {
        method: "POST",
        auth: false,
        body: { refreshToken: current.refreshToken },
      });
    }
  } catch {
    /* clear locally even if the server is unreachable */
  } finally {
    clearSession();
  }
}

export async function requestPasswordReset(email, _redirectTo) {
  await api("/api/auth/forgot-password", {
    method: "POST",
    auth: false,
    body: { email },
  });
}

function pendingToken() {
  const hash = typeof root.location !== "undefined" ? root.location.hash.slice(1) : "";
  const params = new URLSearchParams(hash);
  return {
    type: params.get("type") || initialLink.type,
    token: params.get("token") || initialLink.token,
  };
}

export async function updatePassword(password) {
  const { type, token } = pendingToken();
  if (!token) throw new Error("This link is missing its token.");

  const path = type === "invite" ? "/api/auth/accept-invite" : "/api/auth/reset-password";
  const body = type === "invite" ? { token, password } : { token, newPassword: password };
  const data = await api(path, { method: "POST", auth: false, body });
  saveSession(data);
  return data.user;
}

export async function getRole(_userId, { strict = false } = {}) {
  try {
    const data = await api("/api/auth/me");
    return data?.user?.role || null;
  } catch (error) {
    if (strict) throw error;
    return null;
  }
}

/**
 * Replaces the old Realtime subscription. Polls /me so an admin's role change or
 * removal signs the panel out within about half a minute.
 */
export function watchMyAccess(_userId, onChange) {
  let lastRole = loadSession()?.user?.role || null;
  const timer = setInterval(async () => {
    try {
      const data = await api("/api/auth/me", { auth: true, retry: true });
      const role = data?.user?.role || null;
      if (role !== lastRole) {
        lastRole = role;
        onChange(role);
      }
    } catch {
      onChange(null);
      clearInterval(timer);
    }
  }, 30_000);
  return () => clearInterval(timer);
}

/* ---- public reads ---------------------------------------------------- */

async function publicList(path, fallback) {
  try {
    return (await api(path, { auth: false })) || fallback || [];
  } catch {
    return fallback || [];
  }
}

export async function getEvents(fallback) {
  return publicList("/api/public/events", fallback);
}

export async function getClassSessions(fallback) {
  return publicList("/api/public/class-sessions", fallback);
}

export async function getResources(fallback) {
  return publicList("/api/public/resources", fallback);
}

export async function getStudyGroups(fallback) {
  return publicList("/api/public/study-groups", fallback);
}

export async function getSocialLinks(fallback) {
  return publicList("/api/public/social-links", fallback);
}

export async function getCoreMembers(fallback) {
  return publicList("/api/public/core-members", fallback);
}

export async function getRepoKinds() {
  return publicList("/api/public/repo-kinds", []);
}

/* ---- admin content --------------------------------------------------- */

const RESOURCE = {
  events: "events",
  classSessions: "class-sessions",
  resources: "resources",
  studyGroups: "study-groups",
  socialLinks: "social-links",
  coreMembers: "core-members",
  blogPosts: "blog-posts",
};

async function createRow(resource, patch) {
  return api(`/api/admin/${resource}`, { method: "POST", body: patch });
}

async function updateRow(resource, id, patch) {
  return api(`/api/admin/${resource}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
  });
}

async function deleteRow(resource, id) {
  return api(`/api/admin/${resource}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export const createEvent = (patch) => createRow(RESOURCE.events, patch);
export const updateEvent = (id, patch) => updateRow(RESOURCE.events, id, patch);
export const deleteEvent = (id) => deleteRow(RESOURCE.events, id);

export const createClassSession = (patch) => createRow(RESOURCE.classSessions, patch);
export const updateClassSession = (id, patch) => updateRow(RESOURCE.classSessions, id, patch);
export const deleteClassSession = (id) => deleteRow(RESOURCE.classSessions, id);

export const createResource = (patch) => createRow(RESOURCE.resources, patch);
export const updateResource = (id, patch) => updateRow(RESOURCE.resources, id, patch);
export const deleteResource = (id) => deleteRow(RESOURCE.resources, id);

export const createStudyGroup = (patch) => createRow(RESOURCE.studyGroups, patch);
export const updateStudyGroup = (id, patch) => updateRow(RESOURCE.studyGroups, id, patch);
export const deleteStudyGroup = (id) => deleteRow(RESOURCE.studyGroups, id);

export const createSocialLink = (patch) => createRow(RESOURCE.socialLinks, patch);
export const updateSocialLink = (id, patch) => updateRow(RESOURCE.socialLinks, id, patch);
export const deleteSocialLink = (id) => deleteRow(RESOURCE.socialLinks, id);

export const createCoreMember = (patch) => createRow(RESOURCE.coreMembers, patch);
export const updateCoreMember = (id, patch) => updateRow(RESOURCE.coreMembers, id, patch);
export const deleteCoreMember = (id) => deleteRow(RESOURCE.coreMembers, id);

export const createBlogPost = (patch) => createRow(RESOURCE.blogPosts, patch);
export const updateBlogPost = (id, patch) => updateRow(RESOURCE.blogPosts, id, patch);
export const deleteBlogPost = (id) => deleteRow(RESOURCE.blogPosts, id);

/* ---- team and analytics access -------------------------------------- */

export async function listProfiles() {
  return (await api("/api/admin/team")) || [];
}

export const setProfileRole = (id, role) =>
  api(`/api/admin/team/${encodeURIComponent(id)}`, { method: "PATCH", body: { role } });

export const setAnalyticsAccess = (id, allowed) =>
  api(`/api/admin/team/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { can_view_analytics: allowed },
  });

export async function removeMember(id) {
  await api(`/api/admin/team/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export const inviteMember = (email, role, _redirectTo) =>
  api("/api/admin/team/invite", { method: "POST", body: { email, role } });

export async function getAnalyticsAccess(_userId) {
  try {
    const data = await api("/api/auth/me");
    return Boolean(data?.user?.can_view_analytics);
  } catch {
    return false;
  }
}

export async function analyticsReport(since, until, tz) {
  const query = new URLSearchParams({ since, until, tz });
  return api(`/api/admin/analytics?${query}`);
}

export async function postAnalytics(slug, days = 28) {
  const tz =
    (typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone) ||
    "UTC";
  const query = new URLSearchParams({ days: String(days), tz });
  return api(`/api/admin/blog-posts/${encodeURIComponent(slug)}/analytics?${query}`);
}

/* ---- repository curation -------------------------------------------- */

export const saveRepoKind = (repoName, patch) =>
  api(`/api/admin/repo-kinds/${encodeURIComponent(repoName)}`, {
    method: "PUT",
    body: patch,
  });

export const deleteRepoKind = (repoName) =>
  api(`/api/admin/repo-kinds/${encodeURIComponent(repoName)}`, { method: "DELETE" });

/* ---- activity, undo and trash --------------------------------------- */

export async function listActivity(limit = 300) {
  return (await api(`/api/admin/activity?limit=${encodeURIComponent(limit)}`)) || [];
}

export async function listRowHistory(table, rowId, limit = 30) {
  const query = new URLSearchParams({ limit: String(limit) });
  return (
    (await api(
      `/api/admin/activity/${encodeURIComponent(table)}/${encodeURIComponent(String(rowId))}?${query}`,
    )) || []
  );
}

export async function lastChange(table, rowId) {
  const rows = await listRowHistory(table, rowId, 1);
  return rows[0] || null;
}

export async function restoreDeleted(table, rowId) {
  return api("/api/admin/restore", {
    method: "POST",
    body: { table, rowId: String(rowId) },
  });
}

/* ---- blog drafts and versions --------------------------------------- */

export async function getBlogDraft(postId) {
  return api(`/api/admin/blog-drafts/${encodeURIComponent(postId)}`);
}

export const saveBlogDraft = (postId, content) =>
  api(`/api/admin/blog-drafts/${encodeURIComponent(postId)}`, {
    method: "PUT",
    body: { content },
  });

export const clearBlogDraft = (postId) =>
  api(`/api/admin/blog-drafts/${encodeURIComponent(postId)}`, { method: "DELETE" });

export const addBlogVersion = (postId, content, kind = "edit") =>
  api(`/api/admin/blog-posts/${encodeURIComponent(postId)}/versions`, {
    method: "POST",
    body: { content, kind },
  });

export async function listBlogVersions(postId, limit = 100) {
  const query = new URLSearchParams({ limit: String(limit) });
  return (
    (await api(
      `/api/admin/blog-posts/${encodeURIComponent(postId)}/versions?${query}`,
    )) || []
  );
}

export async function listBlogAuthors() {
  return (await api("/api/admin/blog-authors")) || [];
}

export async function linkMemberCard(_userId, memberId) {
  return api("/api/admin/me/member-card", {
    method: "PATCH",
    body: { memberId },
  });
}

/* ---- member photos --------------------------------------------------- */

export async function uploadMemberPhoto(full, thumb) {
  const form = new FormData();
  form.append("full", full, full.name || "photo.webp");
  form.append("thumb", thumb, thumb.name || "thumb.png");
  return api("/api/admin/member-photos", { method: "POST", body: form });
}

export async function removeMemberPhotos(urls) {
  if (!urls?.length) return;
  await api("/api/admin/member-photos", {
    method: "DELETE",
    body: { urls },
  });
}

/* ---- email lists ----------------------------------------------------- */

export const eventMail = (action, payload = {}) =>
  api(action === "send" ? "/api/admin/event-mail" : "/api/event-mail", {
    method: "POST",
    body: { action, ...payload },
  });

export async function listSubscriptions() {
  return (await api("/api/admin/subscriptions")) || [];
}

export async function addSubscribers(emails, eventId, _adminId) {
  return api("/api/admin/subscriptions", {
    method: "POST",
    body: { emails, eventId },
  });
}

export const removeSubscription = (id) =>
  api(`/api/admin/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });

export async function listEmailSends() {
  return (await api("/api/admin/email-sends")) || [];
}

/* ---- GitHub and cover picker integrations ---------------------------- */

export const refreshSite = () => api("/api/admin/refresh-site", { method: "POST" });

export async function uploadBlogImage(blob) {
  const form = new FormData();
  form.append("file", blob, blob.name || "image.webp");
  const data = await api("/api/admin/blog-images", { method: "POST", body: form });
  return data.url;
}

export const searchUnsplash = (query, page = 1) =>
  api("/api/integrations/unsplash", { method: "POST", body: { action: "search", query, page } });

export const trackUnsplash = (download) =>
  api("/api/integrations/unsplash", { method: "POST", body: { action: "download", download } });

export const mediumFeed = (input) =>
  api("/api/integrations/medium", { method: "POST", body: { action: "feed", input } });

export const mediumImport = (url, ids, handle, attribution) =>
  api("/api/integrations/medium", {
    method: "POST",
    body: { action: "import", url, ids, handle, attribution },
  });

export async function mediumStory(url, handle) {
  try {
    return await api("/api/integrations/medium", {
      method: "POST",
      body: { action: "story", url, handle },
    });
  } catch (error) {
    if (error?.data?.stories) return error.data;
    throw error;
  }
}

/* ---- admin table reads ----------------------------------------------- */

const ADMIN_TABLE_ROUTES = {
  events: "/api/admin/events",
  class_sessions: "/api/admin/class-sessions",
  resources: "/api/admin/resources",
  study_groups: "/api/admin/study-groups",
  social_links: "/api/admin/social-links",
  core_members: "/api/admin/core-members",
  blog_posts: "/api/admin/blog-posts",
  repo_kinds: "/api/public/repo-kinds",
  profiles: "/api/admin/team",
  activity_log: "/api/admin/activity",
  subscriptions: "/api/admin/subscriptions",
  email_sends: "/api/admin/email-sends",
};

/**
 * Used by the admin panel where it previously called
 * getClientOrThrow().from(name).select("*").order(...).
 */
export async function readAdminTable(name, _order = "sort_order", _newestFirst = false) {
  const path = ADMIN_TABLE_ROUTES[name];
  if (!path) throw new Error(`Unknown admin table: ${name}`);
  return (await api(path)) || [];
}
