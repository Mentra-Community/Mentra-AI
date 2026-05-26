# Stale Photo Context — Visual Queries Answer From An Old Photo

**Date:** 2026-05-21
**Symptom:** Ask "how many fingers am I holding up" with 5 fingers up → AI correctly says "5". Ask again with 2 fingers up → AI still says "5". The second answer is based on the *first* photo, not the most recent one.

---

## The Intended Behavior

Each visual query should be answered using the photo captured **for that query** — the most recent frame from the glasses camera. Previous photos exist only to support backward-looking follow-ups ("what was that thing I saw earlier?").

**Expected:** Query 2 (2 fingers) → AI answers about the photo just taken → "2".

**Actual:** Query 2 → AI answers about the photo from Query 1 → "5".

---

## Root Cause

The agent receives **multiple photos with no labels**, and for an identical visual question it latches onto the wrong (older) one.

### 1. `getPhotosForContext()` returns current + ALL previous photos

**File:** `src/server/manager/PhotoManager.ts`, lines 116–130

```typescript
getPhotosForContext(): Buffer[] {
  const photos: Buffer[] = [];
  if (this.currentPhoto) photos.push(this.currentPhoto.buffer);   // current
  for (const photo of this.previousPhotos) photos.push(photo.buffer); // + up to 2 stale
  return photos;
}
```

`PHOTO_SETTINGS.previousPhotosToKeep = 2` (`src/server/constants/config.ts:59`), so this can return up to **3 images**.

### 2. QueryProcessor passes all of them to the agent

**File:** `src/server/manager/QueryProcessor.ts`, lines 60 and 73

```typescript
photos = this.user.photo.getPhotosForContext();   // current + previous, every time
```

### 3. `rotatePhotos()` moves the last query's photo into the "previous" pile

**File:** `src/server/manager/PhotoManager.ts`, lines 85–96

On every `takePhoto()`, the old `currentPhoto` is pushed into `previousPhotos` before the new one becomes current.

### 4. The agent appends all images unlabeled

**File:** `src/server/agent/MentraAgent.ts`, lines 103–110

```typescript
if (photos && photos.length > 0) {
  for (const photoBuffer of photos) {
    content.push({ type: "image", image: photoBuffer });   // no label, no "current" hint
  }
}
```

### 5. The prompt never says which image is current

**File:** `src/server/agent/prompt.ts`, line 195

> "PREVIOUS IMAGES: I may receive previous photos for context."

That's the only mention. The model is given N images, told nothing about ordering, and is never told to answer about the first/most-recent one.

---

## Why The Test Reproduces It Exactly

| Step | `currentPhoto` | `previousPhotos` | `getPhotosForContext()` returns | AI sees | Answer |
|------|----------------|------------------|--------------------------------|---------|--------|
| Query 1 — 5 fingers | `photo_5` | `[]` | `[photo_5]` | 1 image | **5** ✅ |
| Query 2 — 2 fingers | `photo_2` | `[photo_5]` | `[photo_2, photo_5]` | 2 images | **5** ❌ |

On Query 2 the model gets two photos for the *same* question ("how many fingers"). With no label saying `photo_2` is current, it answers from `photo_5`.

The location spam in the logs (`📍 Location updated...` repeated hundreds of times) is unrelated noise — it's just the SDK location stream firing on a stationary device. Not the cause.

---

## Why This Is Fragile By Design

- **Unlabeled image array.** The model cannot distinguish current from stale. `photos[0]` being "current" is an implicit convention the model is never told.
- **Previous photos are noise for present-tense visual questions.** "How many fingers am I holding up", "what is this", "what color is this" are all about *now*. Previous photos only help genuine "earlier" follow-ups — and even then only if labeled.
- **Word-limit pressure.** QUICK mode caps the answer at 17 words (`config.ts:20`), so the model commits to one number fast with no room to reason about which photo to trust.

---

## The Fix (recommended)

Two changes, defense-in-depth:

**A. Send only the current photo for the active visual query.**
`src/server/manager/QueryProcessor.ts` — when `prePhoto` exists, use just that buffer instead of `getPhotosForContext()`:

```typescript
if (prePhoto) {
  photos = [prePhoto.buffer];        // current photo only
  photoDataUrl = `data:${prePhoto.mimeType};base64,${prePhoto.buffer.toString("base64")}`;
}
```

Apply the same to the fallback-capture branch (use `currentPhoto.buffer` only).

**B. Label every image the agent receives.**
`src/server/agent/MentraAgent.ts` — prefix each image with a text part so the model knows the ordering even if multiple photos are ever sent:

```typescript
photos.forEach((photoBuffer, i) => {
  content.push({
    type: "text",
    text: i === 0
      ? "[CURRENT photo — what the user is looking at right now. Answer about THIS image.]"
      : `[PREVIOUS photo ${i} — older context. Ignore unless the user explicitly asks about something earlier.]`,
  });
  content.push({ type: "image", image: photoBuffer });
});
```

Change A alone fixes the reported bug. Change B prevents regressions if previous photos are reintroduced for follow-up support.

---

## Affected Files

- `src/server/manager/PhotoManager.ts` — `getPhotosForContext()`, `rotatePhotos()`
- `src/server/manager/QueryProcessor.ts` — lines 60, 73 (photo gathering)
- `src/server/agent/MentraAgent.ts` — lines 103–110 (unlabeled image append)
- `src/server/agent/prompt.ts` — line 195 (vision section, no ordering guidance)
