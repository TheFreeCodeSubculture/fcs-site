/*
 * js/profile.js
 * ------------------------------------------------------------------
 * The member profile page. Reads the signed-in member from the API,
 * lets them update their details and avatar, and signs them out.
 *
 * The page is built around a hanging member pass. The pass is ordinary
 * DOM: the lanyard module only moves it. No public directory or
 * leaderboards here.
 * ------------------------------------------------------------------
 */

import {
  getProfile,
  getSession,
  removeMyAvatar,
  signOut,
  updateEmailPreferences,
  updateProfile,
  uploadMyAvatar,
} from "./api.js";
import { avatarHTML } from "./lib/avatar.js";
import { mountLanyard } from "./lib/lanyard.js";
import { barcodeSVG, passSerial, shortHost } from "./lib/member-pass.js";
import { startPixelField } from "./lib/pixel-field.js";
import { escapeAttr, escapeHTML } from "./render.js";

const root = document.getElementById("profile-root");
const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
const AVATAR_SIZE = 512;

let profile = null;
let pageNotice = "";
let pageTone = "ok";
let noticeTimer = null;
let lanyard = null;
let passFlipped = false;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  if (!root) return;

  startPixelField(document.getElementById("profile-pixel-field"), { opacity: 0.55 });

  const params = new URLSearchParams(location.search);
  if (params.get("verified") === "1") {
    pageNotice = "Email verified. Welcome to the club.";
  } else if (params.get("reset") === "1") {
    pageNotice = "Password changed. You are signed in.";
  }
  if (pageNotice) {
    history.replaceState(null, "", location.pathname);
  }

  try {
    const session = await getSession();
    if (!session?.user) {
      renderSignedOut();
      return;
    }

    profile = await getProfile();
    document.title = `${profile.display_name || profile.email} | The Free Code Subculture`;
    renderProfile();
  } catch (error) {
    if (error.status === 401) {
      await signOut().catch(() => {});
      renderSignedOut("Your session expired. Sign in again.");
      return;
    }
    renderSignedOut(error.message || "Could not load your profile.");
  }
}

function renderSignedOut(message = "") {
  lanyard?.destroy();
  lanyard = null;
  root.innerHTML = `
    <section class="profile-gate">
      <p class="auth-kicker">// PROFILE</p>
      <h1>Sign in to view your profile</h1>
      <p class="auth-intro">${escapeHTML(message || "Your profile photo and details live here.")}</p>
      <a class="btn-subscribe auth-submit" href="./#login"><span>Sign in</span></a>
      <p class="auth-foot"><a href="./">Back to the RFC</a></p>
    </section>`;
}

function renderProfile() {
  const name = currentName();
  const role = roleLabel(profile.role);
  const avatar = profile.avatar_url || "";
  const serial = passSerial(profile.id, profile.created_at);
  const adminLink = profile.role === "admin" || profile.role === "editor"
    ? `<a class="btn-subscribe" href="admin.html"><span>Admin panel</span></a>`
    : "";

  lanyard?.destroy();
  lanyard = null;
  passFlipped = false;

  root.innerHTML = `
    <p class="profile-page-status" id="profile-page-status" role="status" hidden></p>

    <section class="pass-stage" id="pass-stage" aria-label="Your member pass">
      <div class="pass-rail" aria-hidden="true">
        <span>Member issue</span>
        <span class="pass-rail-line"></span>
        <span>FCS / Pass</span>
      </div>
      <span class="pass-anchor" aria-hidden="true"></span>
      <span class="pass-cast-shadow" aria-hidden="true"></span>

      <svg class="pass-strap" aria-hidden="true" focusable="false">
        <path class="pass-strap-edge"></path>
        <path class="pass-strap-face"></path>
        <g class="pass-strap-print">
          <path class="pass-strap-stitch" id="pass-strap-path"></path>
          <text class="pass-strap-copy">
            <textPath href="#pass-strap-path" startOffset="2">FREE CODE SUBCULTURE · FCS · </textPath>
          </text>
        </g>
      </svg>

      <article class="member-pass" id="member-pass" tabindex="0"
        aria-label="Member pass for ${escapeAttr(name)}" aria-describedby="pass-hint">
        <span class="pass-clip" aria-hidden="true"></span>
        <span class="pass-clip pass-clip--back" aria-hidden="true"></span>
        <span class="pass-grip" aria-hidden="true"></span>

        <div class="pass-flipper" id="pass-flipper">
          <section class="pass-face pass-face--front" id="pass-front" aria-label="Front of member pass">
            <header class="pass-head">
              <img src="assets/logoicon.svg" alt="" width="24" height="22" />
              <span class="pass-brand">The Free Code Subculture</span>
              <span class="pass-kind">Member<br />Pass</span>
            </header>

            <div class="pass-identity">
              <div class="pass-portrait" id="pass-avatar-slot">
                ${avatarHTML({ name, avatar }, "avatar pass-avatar")}
              </div>
              <h1 class="pass-name" id="pass-name">${escapeHTML(name)}</h1>
              <span class="pass-role" id="pass-role">${escapeHTML(role)}</span>
            </div>

            <dl class="pass-facts" id="pass-facts">
              ${passFactsHTML()}
            </dl>

            <p class="pass-front-bio" id="pass-front-bio">${escapeHTML(passBioText())}</p>

            <div class="pass-front-actions">
              <button type="button" class="pass-flip" data-flip="back"
                aria-controls="pass-back" aria-label="Show links and details">
                Links &amp; details <span aria-hidden="true">→</span>
              </button>
            </div>

            <footer class="pass-foot">
              <span class="pass-serial">${escapeHTML(serial)}</span>
              <span class="pass-barcode" aria-hidden="true">${barcodeSVG(serial)}</span>
            </footer>
            <span class="pass-watermark" aria-hidden="true">FCS</span>
            <span class="pass-slot" aria-hidden="true"></span>
            <span class="pass-sheen" aria-hidden="true"></span>
          </section>

          <section class="pass-face pass-face--back" id="pass-back" aria-label="Back of member pass">
            <header class="pass-head">
              <img src="assets/logoicon.svg" alt="" width="24" height="22" />
              <span class="pass-brand">The Free Code Subculture</span>
              <span class="pass-kind">Profile<br />Reverse</span>
            </header>

            <div class="pass-back-identity">
              <p class="pass-back-kicker">Member profile</p>
              <h2 class="pass-back-name" id="pass-back-name">${escapeHTML(name)}</h2>
              <span class="pass-role" id="pass-back-role">${escapeHTML(role)}</span>
            </div>

            <p class="pass-back-bio" id="pass-back-bio">${escapeHTML(passBioText())}</p>

            <div class="pass-links" id="pass-links">
              ${passLinksHTML()}
            </div>

            <footer class="pass-back-foot">
              <span class="pass-serial">${escapeHTML(serial)}</span>
              <button type="button" class="pass-flip pass-flip--back" data-flip="front"
                aria-controls="pass-front" aria-label="Show the front of the pass">
                <span aria-hidden="true">←</span> Front
              </button>
            </footer>
            <span class="pass-watermark" aria-hidden="true">FCS</span>
            <span class="pass-slot" aria-hidden="true"></span>
            <span class="pass-sheen" aria-hidden="true"></span>
          </section>
        </div>
      </article>

      <p class="pass-hint" id="pass-hint">
        <span class="pass-hint-fine">Drag to swing. Click to flip. Arrow keys work too.</span>
        <span class="pass-hint-coarse">Drag from the clip. Tap to flip.</span>
      </p>
      <a class="pass-edit-link" href="#profile-record">Edit your details ↓</a>
    </section>

    <section class="profile-record" id="profile-record" aria-labelledby="profile-record-title">
      <div class="profile-record-head">
        <div id="record-avatar-slot">
          ${avatarHTML({ name, avatar }, "avatar record-avatar")}
        </div>
        <div class="profile-record-title">
          <p class="auth-kicker">// PROFILE RECORD</p>
          <h2 id="profile-record-title">Profile details</h2>
          <p class="profile-record-sub">
            Signed in as <span id="record-email">${escapeHTML(profile.email || "")}</span>.
            Changes appear on your pass.
          </p>
        </div>
        <div class="record-photo" role="group" aria-label="Photo">
          <div class="profile-avatar-actions">
            <input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" hidden />
            <button type="button" class="btn-subscribe" id="avatar-change"><span>Change photo</span></button>
            <button type="button" class="link-button" id="avatar-remove"${profile.avatar_url ? "" : " hidden"}>Remove photo</button>
          </div>
          <p class="record-help">JPG, PNG or WebP, up to 10 MB. Cropped to 512 px.</p>
          <p class="auth-status" id="avatar-status" role="status"></p>
        </div>
      </div>

      <form class="profile-form" id="profile-form" novalidate>
        <label class="auth-field">
          <span>Display name</span>
          <input name="display_name" type="text" autocomplete="name" maxlength="80"
            value="${escapeAttr(profile.display_name || "")}" required />
        </label>
        <label class="auth-field">
          <span>Website</span>
          <input name="website_url" type="url" autocomplete="url" maxlength="500"
            placeholder="https://example.com" value="${escapeAttr(profile.website_url || "")}" />
        </label>
        <label class="auth-field">
          <span>GitHub username</span>
          <input name="github_username" type="text" autocomplete="off" maxlength="40"
            placeholder="octocat" value="${escapeAttr(profile.github_username || "")}" />
        </label>
        <label class="auth-field profile-field-wide">
          <span>Bio</span>
          <textarea name="bio" maxlength="1200" rows="4" placeholder="What are you learning or building?">${escapeHTML(profile.bio || "")}</textarea>
        </label>
        <div class="profile-form-actions">
          <button type="submit" class="auth-submit btn-subscribe"><span>Save profile</span></button>
          <p class="auth-error" role="alert"></p>
          <p class="auth-status" role="status"></p>
        </div>
      </form>

      <div class="profile-settings">
        <section class="record-block" aria-labelledby="record-email-title">
          <h3 id="record-email-title">Email</h3>
          <div class="profile-preference">
            <div>
              <strong>Event emails</strong>
              <span>Updates about events and the club.</span>
            </div>
            <button type="button" class="profile-switch${profile.email_updates ? " is-on" : ""}"
              id="email-updates" role="switch" aria-checked="${profile.email_updates}">
              ${profile.email_updates ? "On" : "Off"}
            </button>
          </div>
          <p class="auth-status" id="preference-status" role="status"></p>
        </section>

        <section class="record-block" aria-labelledby="record-account-title">
          <h3 id="record-account-title">Account</h3>
          <div class="profile-session-actions">
            ${adminLink}
            <button type="button" class="link-button" id="profile-signout">Sign out</button>
          </div>
        </section>
      </div>
    </section>`;

  bindAvatar();
  bindForm();
  bindPreferences();
  bindSignOut();
  bindPass();

  lanyard = mountLanyard(root.querySelector("#pass-stage"));

  if (pageNotice) setPageNotice(pageNotice, pageTone);
  else armNoticeTimer();
}

function currentName() {
  return profile?.display_name || profile?.email || "Member";
}

function passBioText() {
  return (profile?.bio || "").trim() || "Member of the Free Code Subculture.";
}

function passFactsHTML() {
  const rows = [
    `<div><dt>Member since</dt><dd>${escapeHTML(formatJoined(profile.created_at))}</dd></div>`,
  ];
  const website = safeLink(profile.website_url);
  const host = shortHost(website);
  if (host) {
    rows.push(
      `<div><dt>Web</dt><dd><a href="${escapeAttr(website)}" target="_blank" rel="noopener">${escapeHTML(host)}</a></dd></div>`,
    );
  }
  if (profile.github_username) {
    const github = `https://github.com/${encodeURIComponent(profile.github_username)}`;
    rows.push(
      `<div><dt>GitHub</dt><dd><a href="${escapeAttr(github)}" target="_blank" rel="noopener">@${escapeHTML(profile.github_username)}</a></dd></div>`,
    );
  }
  return rows.join("");
}

function passLinksHTML() {
  const links = [];
  const website = safeLink(profile.website_url);
  const host = shortHost(website);
  if (host) {
    links.push(passLinkHTML("Website", host, website, "↗"));
  }
  if (profile.github_username) {
    links.push(
      passLinkHTML(
        "GitHub",
        `@${profile.github_username}`,
        `https://github.com/${encodeURIComponent(profile.github_username)}`,
        "↗",
      ),
    );
  }
  if (profile.email) {
    links.push(passLinkHTML("Email", profile.email, `mailto:${profile.email}`, "✉"));
  }
  return links.length
    ? links.join("")
    : `<p class="pass-links-empty">Add a website or GitHub in your profile to put links on your pass.</p>`;
}

function passLinkHTML(label, value, href, glyph) {
  const external = /^https?:/i.test(href);
  return `<a class="pass-link" href="${escapeAttr(href)}"${external ? ' target="_blank" rel="noopener"' : ""}>
    <span class="pass-link-text">
      <span class="pass-link-label">${escapeHTML(label)}</span>
      <span class="pass-link-value">${escapeHTML(value)}</span>
    </span>
    <span class="pass-link-arrow" aria-hidden="true">${glyph}</span>
  </a>`;
}

function renderAvatars(name = currentName(), avatar = profile?.avatar_url || "") {
  const passSlot = root.querySelector("#pass-avatar-slot");
  const recordSlot = root.querySelector("#record-avatar-slot");
  if (passSlot) {
    passSlot.innerHTML = avatarHTML({ name, avatar }, "avatar pass-avatar");
  }
  if (recordSlot) {
    recordSlot.innerHTML = avatarHTML({ name, avatar }, "avatar record-avatar");
  }
}

function syncPass() {
  if (!profile) return;
  const name = currentName();
  const passName = root.querySelector("#pass-name");
  if (!passName) return;

  passName.textContent = name;
  root.querySelector("#pass-role").textContent = roleLabel(profile.role);
  root.querySelector("#pass-facts").innerHTML = passFactsHTML();
  const frontBio = root.querySelector("#pass-front-bio");
  if (frontBio) frontBio.textContent = passBioText();
  const backName = root.querySelector("#pass-back-name");
  if (backName) backName.textContent = name;
  const backRole = root.querySelector("#pass-back-role");
  if (backRole) backRole.textContent = roleLabel(profile.role);
  const backBio = root.querySelector("#pass-back-bio");
  if (backBio) backBio.textContent = passBioText();
  const links = root.querySelector("#pass-links");
  if (links) links.innerHTML = passLinksHTML();
  const card = root.querySelector("#member-pass");
  if (card) card.setAttribute("aria-label", `Member pass for ${name}`);

  const recordEmail = root.querySelector("#record-email");
  if (recordEmail) recordEmail.textContent = profile.email || "";
  const remove = root.querySelector("#avatar-remove");
  if (remove) remove.hidden = !profile.avatar_url;
  renderAvatars(name, profile.avatar_url || "");
  document.title = `${profile.display_name || profile.email} | The Free Code Subculture`;
}

function previewName(name) {
  const passName = root.querySelector("#pass-name");
  if (passName) passName.textContent = name;
  const backName = root.querySelector("#pass-back-name");
  if (backName) backName.textContent = name;
  const card = root.querySelector("#member-pass");
  if (card) card.setAttribute("aria-label", `Member pass for ${name}`);
  if (!profile?.avatar_url) renderAvatars(name, "");
}

function syncFormValues() {
  const form = root.querySelector("#profile-form");
  if (!form) return;
  form.querySelector('input[name="display_name"]').value = profile.display_name || "";
  form.querySelector('input[name="website_url"]').value = profile.website_url || "";
  form.querySelector('input[name="github_username"]').value = profile.github_username || "";
  form.querySelector('textarea[name="bio"]').value = profile.bio || "";
}

function syncPreferences() {
  const button = root.querySelector("#email-updates");
  if (!button) return;
  const on = Boolean(profile.email_updates);
  button.classList.toggle("is-on", on);
  button.setAttribute("aria-checked", String(on));
  button.textContent = on ? "On" : "Off";
  button.disabled = false;
}

function bindAvatar() {
  const input = root.querySelector("#avatar-file");
  const change = root.querySelector("#avatar-change");
  const remove = root.querySelector("#avatar-remove");
  const status = root.querySelector("#avatar-status");
  if (!input || !change) return;

  change.addEventListener("click", () => input.click());

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    clearPageNotice();
    setStatus(status, "");

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setStatus(status, "Use a JPG, PNG or WebP image.", "error");
      input.value = "";
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setStatus(status, "That image is over 10 MB. Choose a smaller one.", "error");
      input.value = "";
      return;
    }

    const preview = URL.createObjectURL(file);
    renderAvatars(currentName(), preview);

    try {
      setStatus(status, "Preparing photo…");
      let upload = file;
      try {
        upload = await compressAvatar(file);
      } catch {
        // Fall back to the original file; the server still enforces 10 MB.
        upload = file;
      }

      const updated = await withBusy(change, "Uploading…", () => uploadMyAvatar(upload));
      profile = updated;
      syncPass();
      setStatus(status, "Photo updated.");
      URL.revokeObjectURL(preview);
    } catch (error) {
      URL.revokeObjectURL(preview);
      renderAvatars();
      setStatus(
        status,
        error.status === 404
          ? "Photo upload is not available yet; the backend update has not been deployed."
          : error.message || "Could not upload that photo.",
        "error",
      );
    } finally {
      input.value = "";
    }
  });

  remove?.addEventListener("click", async () => {
    clearPageNotice();
    setStatus(status, "");
    try {
      const updated = await withBusy(remove, "Removing…", () => removeMyAvatar());
      profile = updated;
      syncPass();
      setStatus(status, "Photo removed.");
    } catch (error) {
      setStatus(
        status,
        error.status === 404
          ? "Photo removal is not available yet; the backend update has not been deployed."
          : error.message || "Could not remove the photo.",
        "error",
      );
    }
  });
}

async function loadImage(file) {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close?.(),
    };
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  await image.decode();
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    close: () => URL.revokeObjectURL(url),
  };
}

async function compressAvatar(file) {
  const image = await loadImage(file);
  try {
    const side = Math.min(image.width, image.height);
    if (!side) throw new Error("That image is empty.");

    const size = Math.min(AVATAR_SIZE, side);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the image.");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image.source,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );

    const blob =
      (await canvasBlob(canvas, "image/webp", 0.86)) ||
      (await canvasBlob(canvas, "image/jpeg", 0.9));
    if (!blob) throw new Error("Could not prepare the image.");

    return new File(
      [blob],
      blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg",
      { type: blob.type },
    );
  } finally {
    image.close();
  }
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function bindForm() {
  const form = root.querySelector("#profile-form");
  if (!form) return;
  const errorEl = form.querySelector(".auth-error");
  const status = form.querySelector(".auth-status");
  const nameInput = form.querySelector('input[name="display_name"]');

  form.addEventListener("input", () => {
    clearPageNotice();
    status.textContent = "";
  });

  nameInput.addEventListener("input", () => {
    const preview = nameInput.value.trim() || profile.display_name || profile.email || "Member";
    previewName(preview);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.textContent = "";
    status.textContent = "";
    clearPageNotice();

    const displayName = nameInput.value.trim();
    const website = form.querySelector('input[name="website_url"]').value.trim();
    const github = form.querySelector('input[name="github_username"]').value.trim().replace(/^@/, "");
    const bio = form.querySelector('textarea[name="bio"]').value.trim();

    if (!displayName) {
      errorEl.textContent = "Enter a display name.";
      return;
    }
    if (website && !/^https?:\/\//i.test(website)) {
      errorEl.textContent = "The website must start with http:// or https://.";
      return;
    }
    if (github && !/^[A-Za-z0-9-]{1,39}$/.test(github)) {
      errorEl.textContent = "A GitHub username can only use letters, numbers and hyphens.";
      return;
    }
    if (bio.length > 1200) {
      errorEl.textContent = "Keep the bio under 1200 characters.";
      return;
    }

    try {
      const updated = await withBusy(
        form.querySelector(".auth-submit"),
        "Saving…",
        () => updateProfile({
          display_name: displayName,
          website_url: website,
          github_username: github,
          bio,
        }),
      );
      profile = updated;
      setStatus(status, "Profile saved.");
      syncPass();
      syncFormValues();
    } catch (error) {
      errorEl.textContent = error.message || "Could not save your profile.";
    }
  });
}

function bindPreferences() {
  const button = root.querySelector("#email-updates");
  if (!button) return;
  const status = root.querySelector("#preference-status");

  button.addEventListener("click", async () => {
    clearPageNotice();
    setStatus(status, "");
    button.disabled = true;
    try {
      const result = await updateEmailPreferences(!profile.email_updates);
      profile.email_updates = result.emailUpdates;
      syncPreferences();
      setStatus(
        status,
        result.emailUpdates
          ? "Event emails turned on."
          : "Event emails turned off.",
      );
    } catch (error) {
      syncPreferences();
      setStatus(
        status,
        error.message || "Could not update email preferences.",
        "error",
      );
    }
  });
}

function bindSignOut() {
  root.querySelector("#profile-signout")?.addEventListener("click", async (event) => {
    await withBusy(event.currentTarget, "Signing out…", () => signOut());
    location.href = "./";
  });
}

function bindPass() {
  const card = root.querySelector("#member-pass");
  const front = root.querySelector("#pass-front");
  const back = root.querySelector("#pass-back");
  if (!card || !front || !back) return;

  // The lanyard turns the card on its strap; this keeps focus and the
  // accessibility tree on the side that is facing the reader.
  const setFlipped = (value) => {
    const next = Boolean(value);
    passFlipped = next;
    lanyard?.setFlipped(next);
    card.classList.toggle("is-flipped", passFlipped);
    front.toggleAttribute("inert", passFlipped);
    back.toggleAttribute("inert", !passFlipped);
    if (passFlipped) {
      front.setAttribute("aria-hidden", "true");
      back.removeAttribute("aria-hidden");
    } else {
      front.removeAttribute("aria-hidden");
      back.setAttribute("aria-hidden", "true");
    }
  };

  setFlipped(false);

  card.addEventListener("click", (event) => {
    // A drag also produces a click in Chromium. The lanyard marks that
    // case so throwing the card does not flip it.
    if (card.dataset.justDragged === "true") {
      delete card.dataset.justDragged;
      return;
    }
    if (event.target.closest("a, button, input, textarea, select, label, [data-no-flip]")) {
      return;
    }
    setFlipped(!passFlipped);
  });

  root.querySelectorAll("[data-flip]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setFlipped(button.dataset.flip === "back");
    });
  });

  card.addEventListener("keydown", (event) => {
    if (event.target !== card) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setFlipped(!passFlipped);
    }
  });
}

function setPageNotice(message, tone = "ok") {
  pageNotice = message;
  pageTone = tone;
  const status = root.querySelector("#profile-page-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
  status.hidden = !message;
  armNoticeTimer();
}

function clearPageNotice() {
  if (noticeTimer) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  pageNotice = "";
  pageTone = "ok";
  const status = root.querySelector("#profile-page-status");
  if (status) {
    status.textContent = "";
    status.hidden = true;
    status.removeAttribute("data-tone");
  }
}

function armNoticeTimer() {
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
  if (!pageNotice) return;
  noticeTimer = setTimeout(clearPageNotice, 5000);
}

function setStatus(element, message, tone = "ok") {
  if (!element) return;
  element.textContent = message || "";
  element.dataset.tone = tone;
}

async function withBusy(button, label, run) {
  const text = button.querySelector("span") || button;
  const idle = text.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  text.textContent = label;
  try {
    return await run();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    text.textContent = idle;
  }
}

function roleLabel(role) {
  return {
    admin: "Admin",
    editor: "Editor",
    member: "Member",
    pending: "Pending access",
  }[role] || "Member";
}

function formatJoined(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function safeLink(value) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}
