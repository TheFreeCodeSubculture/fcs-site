# Member access — login, signup and profile

The public site has two member surfaces: the auth dialog opened from the
homepage nav, and the private profile page at `account.html`. Verification and
password-reset emails still enter through the homepage dialog.

## Entry points

- **Login** button in the nav, immediately after **Join**.
- **Profile** avatar replaces the Login button once a session exists.
- Verification and member password-reset emails open the same dialog through
  the URL hash.

## Navigation control

`index.html` contains a `.nav-auth-item` inside `.nav-links`:

- Logged out: user icon + “Login”.
- Logged in: circular avatar + “Profile” (the label is visually hidden on
  desktop and shown in the mobile menu).
- The avatar is the member's saved photo, or coloured initials from
  `avatarHTML()` in `js/lib/avatar.js`.
- Clicking it while signed out opens the dialog; while signed in it goes to
  `account.html`.

`js/auth.js` owns the signed-out state. It reads the session from `js/api.js`,
then swaps the button contents. The mobile menu closes before the dialog opens.
A tiny `js/session-init.js` runs in the page head and paints the avatar circle
from the saved session before the module graph loads, so a returning member
does not see a Login flash.

## Dialog states

| State | Trigger | Main action |
|---|---|---|
| Sign in | Login button | `POST /api/auth/login` |
| Create account | Sign-up tab | `POST /api/auth/signup` |
| Verify sent | Successful signup | Resend verification |
| Forgot password | “Forgot password?” | `POST /api/auth/forgot-password` |
| Reset sent | Forgot password success | Back to sign in |
| Reset password | `#type=recovery&token=` | `POST /api/auth/reset-password` |
| Verify email | `#verify=` | `POST /api/auth/verify-email` |

The dialog uses native `<dialog>` for focus trapping and Escape handling.
Clicking the backdrop closes it; closing clears any typed password.

Signing in, verifying an email or resetting a password updates the nav avatar.
Verification and reset links then land on `account.html` with a success
notice.

## Account page

`account.html` is the member profile page. It is private (`noindex`), requires
a signed-in account, and presents the member's details as a hanging member
pass with the editable profile record below. The pass shows:

- Avatar or initials
- Display name
- Role
- “Member since”
- Website and GitHub
- A decorative member serial and barcode
- A reverse side with Website, GitHub and Email links
- Sign out
- “Admin panel” link for admin/editor accounts

The pass can be dragged to swing and clicked to flip; use the clip as the
drag handle on touch screens. The reverse side carries the working links.

The edit form below the pass updates:

- Display name
- Bio
- Website URL
- GitHub username

The account page also has an event-email switch backed by
`PATCH /api/account/email-preferences`.

There is no public directory or leaderboard. The pass is private to the
signed-in member. The background is the same quiet pixel field used behind
the admin gate, shared through `js/lib/pixel-field.js`.

## Avatar upload

- `POST /api/account/avatar` accepts one image in the `file` field.
- JPG, PNG or WebP; maximum 10 MB.
- The browser crops to a square, resizes to 512 px and encodes WebP before
  uploading, so the saved avatar and nav icon stay small.
- Files are stored under `MEDIA_DIR/members/avatars/` and served from
  `/media/members/avatars/<file>`.
- Replacing an avatar deletes the previous local file.
- `DELETE /api/account/avatar` clears the avatar and deletes the local file.
- The nav and account page use `avatar_url` if present, otherwise initials.

## Signup fields

- Display name (required, max 80)
- Email
- Password (backend minimum 10 characters)
- “Email me about events” checkbox (default on)
- Hidden honeypot field named `company`

Directory opt-in is deliberately not exposed yet; the backend defaults it to
`false`.

After signup the dialog stays open on “Verify your email” with a resend button.
The account cannot sign in until the emailed link is opened.

## Email links

The backend now sends members to the homepage:

```text
${PUBLIC_SITE_URL}/#verify=<token>
${PUBLIC_SITE_URL}/#type=recovery&token=<token>
```

Admin/editor reset links still go to `admin.html`. The hash is cleared with
`history.replaceState()` after it is read, so the token does not stay in the
address bar.

## Admin panel compatibility

Member and admin sessions share the `fcs-api-session` key. `js/admin.js`
therefore treats `role === "member"` as a no-access state and points the person
back to the public site instead of opening the admin shell. The backend still
enforces every role check.

## Files

- `index.html` — nav control and dialog shell
- `account.html` — member profile page
- `css/style.css` — nav control, dialog, forms, profile page and avatars
- `js/auth.js` — login/signup state machine, hash handling and nav state
- `js/profile.js` — profile page editing, avatar compression and upload
- `js/lib/avatar.js` — shared avatar renderer
- `js/lib/pixel-field.js` — shared pixel background used by the admin gate and profile page
- `js/api.js` — signUp, verifyEmail, resendVerification, profile and avatar calls
- `backend/src/services/auth.service.ts` — verification/reset link targets
- `backend/src/routes/account.routes.ts` — profile and avatar endpoints
- `backend/src/services/account.service.ts` — profile and avatar database writes
- `backend/src/services/media.service.ts` — avatar file storage
- `js/admin.js` — member-session guard
