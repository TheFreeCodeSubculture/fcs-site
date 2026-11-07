# FCS Blog Editor — Complete Guide

The blog editor (`js/blog-editor.js`) is a full-screen, Notion-style block editor mounted as an overlay inside the admin panel. It opens when an editor clicks a post on the Blog admin section.

---

## Table of Contents

1. [Opening the Editor](#1-opening-the-editor)
2. [Layout & Toolbar](#2-layout--toolbar)
3. [Post Properties](#3-post-properties)
4. [Block Reference](#4-block-reference)
5. [Inline Formatting](#5-inline-formatting)
6. [Markdown Shortcuts](#6-markdown-shortcuts)
7. [Slash (/) Command Menu](#7-slash--command-menu)
8. [Colon (:) Emoji Menu](#8-colon--emoji-menu)
9. [At (@) Mention Menu](#9-at--mention-menu)
10. [Selection Toolbar](#10-selection-toolbar)
11. [Block Controls (Gutter)](#11-block-controls-gutter)
12. [Cover Image](#12-cover-image)
13. [Post Icon](#13-post-icon)
14. [Authors](#14-authors)
15. [Find & Replace (Ctrl+F)](#15-find--replace-ctrlf)
16. [Undo / Redo](#16-undo--redo)
17. [Autosave & Drafts](#17-autosave--drafts)
18. [Version History](#18-version-history)
19. [Preview Mode](#19-preview-mode)
20. [Post Menu (⋯)](#20-post-menu-)
21. [Medium Import](#21-medium-import)
22. [Publish & Update Flow](#22-publish--update-flow)
23. [Image Uploads](#23-image-uploads)
24. [Markdown Storage Format](#24-markdown-storage-format)
25. [Keyboard Reference](#25-keyboard-reference)

---

## 1. Opening the Editor

```js
// js/admin.js calls:
openBlogEditor({
  row,           // the blog_posts row (or null for a new post)
  initial,       // { title, body, … } for imported posts
  isAdmin,       // whether delete is allowed
  save,          // (values, { id, wasLive }) => Promise<row>
  remove,        // (id, wasLive) => Promise
  uploadImage,   // (File) => Promise<url>
  importMedium,  // optional
  duplicate,     // optional
  history,       // optional: (id) => Promise<Array>
  draft,         // published post's unpublished edits
  saveDraft,     // (id, values) => Promise
  clearDraft,
  snapshot,      // (id, values, kind) => Promise
  versions,      // (id) => Promise<Array>
  onSaved,       // (row) => void
  people,        // [{ name, url }] for @ mentions
  toast,         // (msg, tone?) => void
  onClose,       // () => void
});
```

The editor mounts as a `<div class="nb" role="dialog">` appended to `document.body`. It is not a native `<dialog>`, so scroll is managed internally. It is removed from the DOM when closed.

---

## 2. Layout & Toolbar

```
┌── nb-top ──────────────────────────────────────────────────────────┐
│ ← Posts   Blog / <title>   [Locked]  <words>  <state>  [↩][↪]    │
│ [Updates] [Preview] [Publish ▸] / [Update ▸]  [⋯]                │
└────────────────────────────────────────────────────────────────────┘
┌── nb-find (hidden; Ctrl+F to open) ────────────────────────────────┐
│ 🔍 [Find…]  3/12  [↑][↓]  🔁 [Replace…]  [Replace][Replace all]  │
│ [Aa]  [✕]                                                           │
└────────────────────────────────────────────────────────────────────┘
┌── nb-scroll ───────────────────────────────────────────────────────┐
│ ┌── nb-cover (optional) ─────────────────────────────────────────┐ │
│ │  [cover image]           [Change cover][Reposition][Remove]    │ │
│ └────────────────────────────────────────────────────────────────┘ │
│ ┌── nb-page ──────────────────────────────────────────────────────┐ │
│ │  [icon btn]  [Add icon] [Add cover]                             │ │
│ │  h1 (contenteditable: "Untitled")                               │ │
│ │  nb-props: Address | Authors | Excerpt | …                     │ │
│ │  nb-blocks  ← editing canvas                                   │ │
│ │  nb-attribution (Medium source line, optional)                  │ │
│ └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
┌── nb-preview (hidden; click Preview to open side-by-side) ─────────┐
└────────────────────────────────────────────────────────────────────┘
┌── nb-toolbar (floats; shown on text selection) ─────────────────────┐
│ [Turn into ▾] │ B  i  U  S  </>  √x  🔗 │ A▾  ⋯                   │
└────────────────────────────────────────────────────────────────────┘
```

**State indicator** (`[state]`): "Saving…", "Saved", "Draft", "Published", "Has unpublished edits".

---

## 3. Post Properties

Properties appear as a row of inline expandable fields below the title. Click any label to open it.

| Property | DB column | Notes |
|----------|-----------|-------|
| Address (URL slug) | `blog_posts.slug` | Auto-derived from title; editable. Must be URL-safe. |
| Authors | `blog_posts.authors` | JSON array. See [Authors](#14-authors). |
| Excerpt | `blog_posts.excerpt` | Shown in post cards and OG description. |
| Cover credit | `blog_posts.cover_credit` | Attribution line shown in the cover. |
| Source URL | `blog_posts.source_url` | Read-only after Medium import; shown for provenance. |
| Font | `blog_posts.font` | `default` / `mono` / `technical` / `garet` |
| Small text | `blog_posts.small_text` | boolean; reduces all block font sizes |
| Full width | `blog_posts.full_width` | boolean; removes the max-width cap |

---

## 4. Block Reference

### Text Types

All text-type blocks are `contenteditable`. Pressing **Enter** creates a new block of the same type below (or a plain paragraph for headings, toggles, quotes). **Shift+Enter** adds a soft line-break within the block.

| ID | Rendered as | Markdown storage | Notes |
|----|-------------|------------------|-------|
| `p` | `<p>` | Bare line | Placeholder: "Type '/' for commands" |
| `h1` | `<h2>` (title is h1) | `# text` | Has copy-link anchor button |
| `h2` | `<h3>` | `## text` | Has copy-link anchor button |
| `h3` | `<h4>` | `### text` | Has copy-link anchor button |
| `h4` | `<h5>` | `#### text` | Has copy-link anchor button |
| `bullet` | `<li>` with dot marker | `- text` | Indentable: Tab / Shift+Tab |
| `number` | `<li>` with number | `1. text` | Indentable; list style: `{: list=a}` for alpha |
| `todo` | `<input[checkbox]>` + text | `- [ ] text` / `- [x] text` | Clicking the checkbox toggles `is-done` class |
| `quote` | `<blockquote>` | `> text` | Multi-line with Shift+Enter |
| `callout` | Box with emoji icon | `> [!💡]\n> text` | Icon picker on click |
| `toggle` | `<details>` variant | `+++ summary\ncontent\n+++` | Children are nested blocks |
| `toggle-h1`–`toggle-h3` | Same but `<h2>`–`<h4>` summary | `{: h=2}` attr on toggle | |

### Non-text Blocks

#### Code (`code`)

A `<textarea>` for input overlaid on a `<pre><code>` for syntax highlighting (highlight.js). Language selector dropdown (22 languages). Copy button in the bar.

Storage: ` ```lang\ncode\n``` `

#### Equation (`math`)

A `<textarea>` (hidden until focused) with a KaTeX-rendered view. Clicking the rendered view opens the textarea. Block equation.

Storage: `$$\ntex\n$$`

#### Divider (`divider`)

A simple `<hr>`. No configuration.

Storage: `---`

#### Table of Contents (`toc`)

Reads all heading blocks in the post and renders a `<nav>` with anchor links. Auto-updates as headings change.

Storage: `[[toc]]`

#### Image (`image`)

Renders with an `<img>` and optional caption text. Alignment (left-float, center, right-float, full-width) and width (10%–100% in 10% steps) via block attributes `{: align=center width=80}`.

Dropping a file or clicking "Upload an image" triggers the upload pane.

Storage: `![caption](https://…) {: align=center width=80}`

#### Video (`video`)

Embeds a YouTube video (iframe with `youtube-nocookie.com`). Paste a YouTube URL or share link.

Storage: `@[video](https://www.youtube.com/watch?v=…)`

#### Bookmark (`bookmark`)

A link-preview card: title, description, image fetched via microlink.io in the editor (free, ~50 per person per day). The deploy uses `tools/link-meta.mjs` for the published version.

Storage: `@[bookmark](https://…)`

#### Table (`table`)

A full `<table>` with header row, row handles (insert, delete, move, duplicate, clear), and column handles (insert, delete, move, duplicate, clear, alignment). Cells are `contenteditable`.

Storage: GFM pipe table with optional `:--:` alignment in the header separator.

#### Columns (`columns`)

Two, three, or four equal-width columns. Each column is a `.nb-blocks` container that holds its own blocks. Columns cannot be nested.

Storage:
```
::: columns
::: column
content of col 1
::: column
content of col 2
:::
```

---

## 5. Inline Formatting

Applied with the selection toolbar or with keyboard shortcuts.

| Markdown | Result | Shortcut |
|----------|--------|----------|
| `**text**` | **Bold** | Ctrl+B |
| `*text*` | *Italic* | Ctrl+I |
| `++text++` | Underline | Ctrl+U |
| `~~text~~` | ~~Strikethrough~~ | Ctrl+Shift+S |
| `==text==` | ==Highlight== | — |
| `` `text` `` | `inline code` | Ctrl+E |
| `$text$` | KaTeX inline | Ctrl+Shift+E |
| `^text^` | Superscript | — |
| `~text~` | Subscript | — |
| `[label](url)` | Link | Ctrl+K |
| `{color=red}text{/}` | Coloured text | via toolbar |
| `{bg=yellow}text{/}` | Background colour | via toolbar |
| `@[Name](url)` | Person mention | `@` menu |
| `@{YYYY-MM-DD}` | Date mention | `@` menu |
| `:emoji:` | Emoji (Twemoji) | `:` menu |

**Colour names:** `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red` (Notion palette).

---

## 6. Markdown Shortcuts

Typed at the **start of a block**, before any other character:

| Type | Shortcut |
|------|----------|
| Heading 1 | `# ` (hash + space) |
| Heading 2 | `## ` |
| Heading 3 | `### ` |
| Heading 4 | `#### ` |
| Bulleted list | `- ` |
| Numbered list | `1. ` |
| Alpha list | `a. ` |
| To-do list | `[] ` |
| Toggle list | `> ` |
| Quote | `" ` |
| Code block | ` ``` ` |
| Math block | `$$ ` |
| Divider | `---` |

The shortcut is replaced instantly when the trigger character (space, backtick, `]`) is typed.

---

## 7. Slash (/) Command Menu

Type `/` in any text block to open the command menu. Continue typing to filter.

The menu is grouped into five sections:

| Section | Commands |
|---------|----------|
| Basic blocks | Text, Heading 1–4, Bulleted / Numbered / To-do / Toggle lists, Toggle heading 1–3, Quote, Callout, Divider, Table, Table of contents |
| Layout | 2 / 3 / 4 columns |
| Media | Image, Video, Web bookmark |
| Advanced | Code, Block equation |
| Inline | Inline equation, Mention a person, Date, Emoji |

Navigate with Arrow keys, select with Enter, dismiss with Escape. The menu never lets the page scroll while it is open.

---

## 8. Colon (:) Emoji Menu

Type `:` followed by letters (e.g. `:rocket`) to filter the full Unicode emoji set. The picker shows the matched emojis rendered with Twemoji. Select with Enter or click. Recent picks appear first.

---

## 9. At (@) Mention Menu

Type `@` to open the mention menu, which offers:

- **People** — all `people` passed to `openBlogEditor` (every admin and editor in the team).
- **Dates** — today, tomorrow, next week, any date typed as `@2026-10-30`.

A person mention stores `@[Name](https://…)` or `@[Name]` (if no URL). A date stores `@{YYYY-MM-DD}`, rendered as a human-readable date with a tooltip.

---

## 10. Selection Toolbar

Appears as a floating bar whenever text is selected inside a text block.

| Button | Action |
|--------|--------|
| Turn into ▾ | Change block type |
| **B** | Bold |
| *i* | Italic |
| U | Underline |
| S | Strikethrough |
| `</>` | Inline code |
| √x | Inline equation |
| 🔗 | Link |
| A▾ | Text/background colour picker (Notion palette) |
| ⋯ | More: Highlight (==), Superscript, Subscript, Clear formatting |

The toolbar repositions itself to stay inside the viewport.

---

## 11. Block Controls (Gutter)

Each block has a **gutter** that appears on hover to the left of the block content:

```
  ┌────────────────────────────────────────┐
+ │  block content here                    │
⠿ │                                        │
  └────────────────────────────────────────┘
```

- **`+` button:** adds a new empty paragraph below. **Alt+click** adds above.
- **Grip (⠿) button:** drag to move the block; click (or **Ctrl+/**) to open the block's context menu.

**Block context menu:**

| Item | Description |
|------|-------------|
| Turn into | Switch to any text type |
| Color | Set block background colour (Notion palette) |
| Align | Left / Center / Right (text blocks) |
| List style | Disc / Circle / Square / Number / Alpha / Roman (lists) |
| Insert above / below | Add an empty block |
| Duplicate | Clone this block |
| Move up / down | Swap with adjacent block |
| Copy link | Copies `#heading-slug` URL (headings only) |
| Delete | Removes the block (no confirmation) |

---

## 12. Cover Image

The cover area appears above the page content. Three ways to add:

### Gallery Tab
Curated palette from `assets/cover-gallery.json`:
- Solid colours and gradients
- Textures (rendered PNGs in `assets/covers/`)
- Public-domain astronomy images (Webb, NASA)
- Met Museum public-domain art

Built by `node tools/build-cover-gallery.mjs`. Clicking a tile sets `cover_url` to the tile's URL.

### Upload Tab
Drop a file, click to pick, or **Ctrl+V** to paste an image or image URL.
- Accepts: PNG, JPEG, WebP (up to 2 MB)
- Preview shown on dark + light tiles before saving
- File is uploaded via `uploadBlogImage` → `upload-asset` edge function → committed to `fcs-assets` repo → served by jsDelivr

### Unsplash Tab
Searches Unsplash via the `unsplash` edge function (keeps the API key server-side).
- 50 searches/hour free until production approval
- Photos are **hotlinked** from Unsplash; photographers' names are credited automatically in `cover_credit`
- Clicking "Use photo" sets `cover_url` and `cover_credit`

### Repositioning
Click **Reposition** → drag the image vertically → **Save position**. Stores `cover_position` (0–100), applied as `object-position: center <n>%`.

---

## 13. Post Icon

The icon appears above the title. Three tabs in the picker:

### Emoji
Full Unicode set in Notion's nine groups (Smileys, People, Animals, Food, Travel, Activities, Objects, Symbols, Flags). Rendered with Twemoji for consistency.

Storage: the emoji character directly, e.g. `🚀`.

### Icons
Every pixelarticons icon (`assets/pixel-icons.svg`) in ten brand colours.

Storage: `icon:<name>:<colour>`, e.g. `icon:code:blue`.

### Upload
A square image. Previewed on dark and light tiles.

Storage: a full `https://` URL.

Recent picks in each tab are stored in `localStorage` (`fcs-recent-emoji`, `fcs-recent-icon`, `fcs-recent-upload`).

---

## 14. Authors

The **Authors** property row manages who is credited on the post.

- **Initial author:** whoever is signed in when the post is created.
- **Add authors:** opens a member picker (`js/member-picker.js`) listing all admins and editors. Picking one adds them to `authors`.
- **Guest authors:** a "Add by name" option adds `{ name: "…" }` without a Supabase profile.
- **Photo order:** `photo_url` from their core-member card → their GitHub avatar → initials badge.
- **Link author card:** an editor can link their login to their core-member card once (Team page or the prompt in Authors row). The link is guessed from their email by `js/lib/member-match.js`.

The `authors` column is a JSON array of `{ id?, name, avatar?, url? }` objects.

---

## 15. Find & Replace (Ctrl+F)

A bar slides in below the top bar. Keyboard shortcuts within the bar:

| Key | Action |
|-----|--------|
| Ctrl+F | Open / focus find |
| Enter | Next match |
| Shift+Enter | Previous match |
| Escape | Close |

Matches are highlighted in real time as you type. The count shows current/total. Case-sensitive toggle labelled "Aa".

**Replace:** type a replacement string, then click **Replace** (current match) or **Replace all** (all matches).

---

## 16. Undo / Redo

The editor maintains its own history stack (not the browser's `execCommand` history), recorded as a sequence of block snapshots. Undo removes the last block operation or text edit group.

| Action | Key |
|--------|-----|
| Undo | Ctrl+Z |
| Redo | Ctrl+Shift+Z |

Buttons in the top bar show disabled state when the stack is at its limits.

---

## 17. Autosave & Drafts

**New (unpublished) posts:** autosave fires ~1.5 s after the last keystroke. The state indicator shows "Saving…" → "Saved". No manual save is needed. The post is saved with `status = 'draft'`.

**Published posts:** edits are autosaved to `blog_drafts` (a separate row keyed by post ID). The state indicator shows "Has unpublished edits". Pressing **Update** commits the draft to `blog_posts`, clears `blog_drafts`, and triggers a redeploy via the `refresh-site` edge function.

If the browser is closed before **Update** is pressed, the draft persists in the database and is restored when the post is next opened.

---

## 18. Version History

Available for published posts (migration 029). The ⋯ menu's "Version history" opens a panel showing:

- A timeline of saves with timestamps, author, and a one-line summary (generated by `js/lib/block-diff.js → changeSummary()`).
- Clicking a version shows the diff (added/removed/changed blocks side by side).
- Restoring a version replaces the current draft (but does not publish immediately).

---

## 19. Preview Mode

Click **Preview** in the top bar to open a split view: the editing canvas on the left, the rendered post on the right (using the same render functions as the published page). The preview re-renders live as you type.

Click **Preview** again or press Escape to close.

---

## 20. Post Menu (⋯)

Opened by the `⋯` button in the top bar.

| Group | Option | Description |
|-------|--------|-------------|
| **Appearance** | Font | Default / Mono / Technical / Garet |
| | Small text | Toggle |
| | Full width | Toggle |
| | Lock page | Prevents editing |
| | Zoom | 75 / 100 / 125 / 150% |
| **Share** | Copy link | Copies the public URL |
| | Copy as Markdown | Serialises current body to clipboard |
| **Import** | Import Markdown | Replaces body from a `.md` / `.txt` file |
| | Import from Medium | Opens Medium import dialog |
| **Export** | Export as Markdown | Downloads `.md` |
| | Export as HTML | Downloads `.html` (full page) |
| | Export as PDF | Print dialog, page already styled for A4/Letter |
| **History** | Version history | Opens the diff timeline |
| **Post** | Duplicate | Creates a new draft with this post's content |
| | Unpublish | Sets `status = 'draft'`; triggers redeploy |
| | Delete | Removes the post entirely (admin only); triggers redeploy |

---

## 21. Medium Import

Two entry points: the **Import from Medium** button on the Blog list header, and the ⋯ menu inside an open post.

### How it works

1. User pastes a Medium story URL or `@handle`.
2. The editor fetches the author's public RSS feed (`medium.com/feed/@handle`).
3. The `medium-import` edge function parses the feed HTML into blocks (using `js/lib/medium-wizard.js` logic server-side).
4. Images are copied to `fcs-assets` by the edge function (same rules: PNG/JPEG/WebP, up to 2 MB; GIFs and SVGs stay hotlinked).
5. The resulting Markdown is inserted into the editor as a new draft.

### Limitations

| Lost | Preserved |
|------|-----------|
| Code block language tags | Headings, paragraphs, blockquotes, lists, dividers |
| GitHub gists | Inline formatting (bold, italic, links, inline code) |
| Native Medium embeds | YouTube videos (from Embedly embed) |
| LaTeX equations | Tweet / Vimeo / CodeSandbox links |
| Stories beyond the feed's 10 newest | Cover image |
| Member-only stories | Authors |

### Attribution

An optional attribution paragraph ("Originally published on Medium") is ticked by default and appended at the end. The story's canonical URL is always saved in `source_url`. The import always lands as a **draft**; the user must review and publish manually.

> [!IMPORTANT]
> The importer requires confirming that you hold the rights to publish. Never import stories you did not write without permission.

---

## 22. Publish & Update Flow

| Action | Trigger | Effect |
|--------|---------|--------|
| **Publish** (new draft) | Click "Publish" | Sets `status = 'published'`, `published_at = now()`. Triggers `refresh-site` → GitHub Actions → `blog-build.mjs` deploys the post in ~1 min. |
| **Update** (published post) | Click "Update" | Writes pending edits from `blog_drafts` back to `blog_posts.body`, updates `updated_at`. Triggers `refresh-site`. OG card is redrawn with `?v=<updated_at>` cache-busting. |
| **Unpublish** | ⋯ → Unpublish | Sets `status = 'draft'`. Triggers `refresh-site` to remove the page. |
| **Delete** | ⋯ → Delete | Removes the row. Triggers `refresh-site`. Admin only. |

The state indicator in the top bar shows the current status and whether there are unsaved edits.

---

## 23. Image Uploads

All image uploads go through `uploadBlogImage` in `js/supabase.js`, which calls the `upload-asset` edge function.

**Flow:**
1. Editor calls `opts.uploadImage(file)`.
2. The file is resized to WebP if the browser supports it and it is over ~100 KB.
3. `upload-asset` checks the caller is an editor or admin.
4. The image is committed to the `TheFreeCodeSubculture/fcs-assets` GitHub repository via the GitHub API (`GITHUB_ASSETS_TOKEN` secret).
5. The returned URL is pinned to the commit SHA: `https://cdn.jsdelivr.net/gh/TheFreeCodeSubculture/fcs-assets@<sha>/…`.
6. The URL never changes after upload. No cache purge is ever needed.

> [!WARNING]
> `fcs-assets` is a **public** GitHub repository. Never upload any file you do not want publicly accessible permanently.

**Limits:** PNG, JPEG, or WebP only. Files over 2 MB are rejected with a toast. The editor pre-converts oversized images to WebP in the browser.

---

## 24. Markdown Storage Format

Posts are stored as Markdown in `blog_posts.body`. The full syntax is documented at the top of `js/lib/markdown.js`. Key points:

- The **title** is stored in `blog_posts.title`, not in the body.
- **Block attributes** are appended at the end of a block's last line: `{: align=center color=red}`.
- **Toggle children** are indented under the `+++` / `+++` fence.
- **Columns** use `:::` fences.
- **Tables** are GFM pipe tables.
- **Callouts** use `> [!emoji]` on the first line of a blockquote.
- **Inline math** uses `$…$`; block math uses `$$\n…\n$$`.
- **Mentions** are `@[Name](url)` or `@[Name]`; dates are `@{YYYY-MM-DD}`.
- **Bookmarks** are `@[bookmark](url)`; videos are `@[video](url)`.

The body is parsed into blocks by `parseBlocks()` and serialised back by `serializeBlocks()` from `js/lib/markdown.js`.

---

## 25. Keyboard Reference

### Global (while editor is open)

| Key | Action |
|-----|--------|
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Ctrl+F | Open / focus Find & Replace |
| Escape | Close open menu / close Find / deselect block |

### In a text block

| Key | Action |
|-----|--------|
| Enter | New block below |
| Shift+Enter | Soft line break within block |
| Tab | Indent list block |
| Shift+Tab | Outdent list block |
| Backspace (empty block) | Remove block, move cursor up |
| ↑ / ↓ (at top/bottom of block) | Move cursor to previous/next block |
| Ctrl+B | Bold |
| Ctrl+I | Italic |
| Ctrl+U | Underline |
| Ctrl+Shift+S | Strikethrough |
| Ctrl+E | Inline code |
| Ctrl+Shift+E | Inline equation |
| Ctrl+K | Link |

### On a selected block (Escape to select)

| Key | Action |
|-----|--------|
| Delete or Backspace | Remove block |
| Ctrl+D | Duplicate block |
| ↑ / ↓ | Move cursor into previous/next block |
| Enter or Space | Edit the block |

### Block gutter

| Key | Action |
|-----|--------|
| Ctrl+/ | Open block context menu |
