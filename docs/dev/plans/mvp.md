Perfect. Here’s a clean, execution-ordered `docs/todo-mvp.md` you can drop straight into your repo.

---

# `docs/todo-mvp.md`

# External Note Folders — MVP Checklist

This checklist covers everything required to ship a safe, minimal, production-ready MVP consistent with the ADRs.

---

## 0️⃣ Repo & Build Setup

* [ ] Initialize Obsidian plugin scaffold (TS + build system)
* [ ] Configure `manifest.json`
* [ ] Add `main.ts`
* [ ] Add `package.json` scripts (`dev`, `build`, `version`)
* [ ] Confirm hot reload works in test vault
* [ ] Add `docs/adr/` (commit ADR pack)

---

## 1️⃣ Settings

* [ ] Add settings tab
* [ ] Add **External Root** (absolute path string)
* [ ] Validate path is absolute
* [ ] Add “Dry-run by default” toggle (default: true)
* [ ] Invalidate scan cache when settings change

---

## 2️⃣ Core Utilities

### UUID

* [ ] UUID generation helper
* [ ] UUID format validation
* [ ] Frontmatter read/write helper (`exf` key)

---

### Path Derivation

* [ ] Derive vault-relative path without `.md`
* [ ] Join with external root
* [ ] Normalize separators
* [ ] Remove illegal characters (Windows-safe)
* [ ] Handle reserved names
* [ ] Guard against trailing dots/spaces
* [ ] Enforce max path length (shorten with hash if needed)
* [ ] Case-insensitive comparison helper

---

## 3️⃣ Vault Scan

* [ ] Scan markdown files using metadata cache
* [ ] Extract UUIDs
* [ ] Build `Map<uuid, notePath>`
* [ ] Detect duplicate UUIDs in vault → mark as Error

Function:

```ts
scanVaultUUIDs(): {
  map: Map<string, string>,
  duplicates: string[]
}
```

---

## 4️⃣ External Root Scan

* [ ] Recursively find `.exf` files
* [ ] Parse UUID (trim, validate)
* [ ] Build `Map<uuid, boundFolderPath>`
* [ ] Detect duplicate UUIDs → Error
* [ ] Detect malformed `.exf` → Error

Function:

```ts
scanExternalRoot(): {
  map: Map<string, string>,
  duplicates: string[],
  malformed: string[]
}
```

---

## 5️⃣ Filesystem Safety Layer

Create a single guarded module for all mutations.

* [ ] `ensureDir(path)`
* [ ] `writeMarker(boundFolder, uuid)`

  * Refuse overwrite if different UUID
* [ ] `moveDir(src, dst)`

  * No overwrite allowed
  * Abort on conflict
* [ ] `openInExplorer(path)`
* [ ] Enforce no deletion rule

---

## 6️⃣ Commands

---

### Assign UUID

* [ ] If missing → generate + write
* [ ] If exists → no-op (or show notice)
* [ ] Never touch external root

---

### Open External Folder

* [ ] If UUID missing → auto-assign
* [ ] Scan external
* [ ] If UUID exists → open folder
* [ ] If missing:

  * [ ] Derive target path
  * [ ] Create directory
  * [ ] Write `.exf`
  * [ ] Open folder

---

### Verify

* [ ] Scan vault + external

* [ ] Categorize statuses:

  * OK
  * Unavailable (vault only)
  * Warning (orphan bound folder)
  * Error (duplicates, malformed, mismatches)

* [ ] Display grouped modal report

* [ ] Log summary to console

---

### Reconcile (Dry-Run Default)

* [ ] Scan vault + external
* [ ] Abort immediately if:

  * duplicate UUIDs in vault
  * duplicate UUIDs in external
  * malformed markers
* [ ] For UUIDs in intersection:

  * [ ] Derive target path
  * [ ] If already correct → skip
  * [ ] If target empty/unbound → plan move
  * [ ] If target has different UUID → conflict
  * [ ] If descendant `.exf` exists → conflict
  * [ ] If unbound but occupied → suffix target
* [ ] Present plan modal
* [ ] Execute only if confirmed
* [ ] Never delete anything

---

## 7️⃣ Status Model Enforcement

* [ ] Implement OK
* [ ] Implement Unavailable
* [ ] Implement Warning
* [ ] Implement Error (abort reconcile)

Make sure:

* Unavailable is informational
* Errors block mutation

---

## 8️⃣ Logging & UX

* [ ] Reconcile modal:

  * planned moves
  * conflicts
  * confirmation button
* [ ] Verify modal:

  * grouped sections
* [ ] Console logs for debugging
* [ ] Clear, non-alarmist language

---

## 9️⃣ Caching (Optional but Recommended)

* [ ] In-memory cache for external scan (TTL 10–30s)
* [ ] Invalidate on:

  * settings change
  * reconcile execution
  * external folder creation

---

## 🔟 Edge Case Hardening

* [ ] Case-only rename handling
* [ ] Nested bound folder collision detection
* [ ] Unicode normalization
* [ ] Path length guard
* [ ] Windows reserved names

---

## 1️⃣1️⃣ Testing

* [ ] Unit tests:

  * path sanitization
  * UUID validation
  * duplicate detection
  * reconcile plan collision cases
* [ ] Manual test matrix:

  * external root missing
  * external drive detached
  * duplicate UUID in vault
  * duplicate UUID in external
  * malformed `.exf`
  * rename note then reconcile

---

## 1️⃣2️⃣ Documentation

* [ ] README

  * What it does
  * What it is not
  * Commands
  * Safety guarantees (no deletions)
* [ ] Link ADR index
* [ ] Add screenshots later (optional)

---

## 1️⃣3️⃣ Release Checklist

* [ ] Bump version
* [ ] Build
* [ ] Test in fresh vault
* [ ] Tag release
* [ ] Publish

---

# MVP Done Criteria

You are done when:

* Vault can contain many UUIDs with no external folders and Verify reports Unavailable (not error).
* Reconcile never deletes anything.
* Duplicate UUIDs block mutation.
* No background automation exists.
* User never fears running a command.

---

If you want next, I can:

* Give you a **clean internal architecture layout** (`src/` folder structure)
* Or write a minimal `main.ts` skeleton to accelerate coding.
