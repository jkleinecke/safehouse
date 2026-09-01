# The rulebook library

How the table's own PDFs become the app's library (M11, FR11.1–11.7), what the
seeder actually does, and the step nobody can skip: page offsets.

Read this once when you set the library up, and again the day you buy a book.

---

## 1. Where the PDFs live, and why they never leave

The books are **your copies**. Nothing about this feature moves them anywhere.

- **They stay in a folder you point the seeder at.** The default is the repo
  root — the folder `DESIGN.md` sits in — and `--dir` points it anywhere else
  (`--dir D:/books`). The seeder reads `*.pdf` from that folder; it never
  writes to it, renames anything, or deletes anything.
- **They never enter git.** `.gitignore` has excluded `*.pdf` since the first
  commit, which is why the PDFs can sit in the repo root at all.
- **They are never uploaded.** Seeding copies each PDF into the local file
  store at `DATA_DIR/files/books/<CODE>.pdf` (`DATA_DIR` defaults to `./data`,
  also gitignored). That copy is what the app serves — over your LAN, behind
  device-token auth, streamed by byte range so a phone opening one page does
  not pull the whole book.
- **The extracted text stays on the machine too.** With local inference
  (`LLM_BASE_URL` pointing at the inference box on your LAN, or unset), book
  text is processed on your hardware and never touches the internet — which is
  what keeps the Fixer's rules answers as clean, licensing-wise, as reading the
  book yourself (DESIGN.md §14.8–14.9, `[D12]`).

The app ships zero game content. The library is infrastructure over files you
already own; nothing here is redistributed.

**Disk:** the 17 production books are ~311 MB in the source folder, and the
file-store copy is another ~311 MB — budget roughly 620 MB plus the extracted
text in the database. The largest single file is the core rulebook at ~44 MB,
comfortably inside the 200 MB per-book cap (§15).

---

## 2. Loading the full set

Look before you write:

```
pnpm seed:books --list
```

That prints the code, offset and title guessed for every PDF it found, and
writes nothing. Then import:

```
pnpm seed:books --calibrate
```

`--calibrate` measures each book's page offset from the page numbers printed
in the book itself, **before** the text is indexed (§4). It is the form to use
for a first import: without it every book but the core rulebook lands at offset
+0, and every ref chip into those books opens the wrong page. Plain
`pnpm seed:books` does everything except that.

Equivalent from anywhere in the workspace:
`pnpm --filter @safehouse/server seed:books --list`.

Per book, the seeder:

1. **guesses** a code, title and offset from the filename;
2. **registers** it — copies the PDF into the file store and writes the
   `books` + `attachments` rows;
3. **extracts** per-page text into `book_pages`, which is what full-text
   search and the Fixer's retrieval read (FR12.14).

**Measured on the full production set, on the owner's own machine:**

| Run | Books | Pages indexed | Wall clock |
|---|---|---|---|
| `pnpm seed:books` | 17 | 3,546 | 31 s |
| `pnpm seed:books --calibrate` | 17 | 3,542 | 33 s, 74 s, 85 s (three runs) |

Take the spread seriously and the ordering not at all: the run copies ~311 MB
into the file store and opens every PDF, and whether those bytes are already in
the OS file cache swamps everything else. Calibration itself is one extra pass
over ~48 pages per book — well under a second each, and the fastest calibrated
run came in at 33 s, two seconds over the uncalibrated one. **Budget a minute
or so, and do not skip `--calibrate` to save time; there is no time to save.**

The four-page difference between the two rows is not a loss. Those are
front-matter pages whose printed number comes out below 1 once the real offset
is known, so a calibrated seed correctly declines to file them under a fake
printed number.

It is a one-shot; you will not run it again until you buy a book.

### Stop the server first

The embedded database (PGlite) is **single-process**. A running server and the
seed script cannot hold the same `DATA_DIR` at once. Order: stop the server →
run the seeder → let it exit → start the server.

### Reading the output

```
[seed:books] streetlethal.pdf -> SL (offset +0)
[seed:books]   offset set: +0 → +1 (46/48 sampled pages agree, e.g. printed 16 on PDF page 17)
[seed:books]   199 pages indexed (202/202 pdf pages scanned)
```

Line 1 is the filename → code guess. Line 2 only appears under `--calibrate`
and is the measurement (§4). Line 3 is the extraction.

`202/202` is every page of the file opened. `199` is how many carried text.
The three that did not are **image-only pages** — pure scans with no text
layer. That gap is normal, not a failure, but it has a consequence worth
knowing:

> An image-only page is invisible to search and to the Fixer. The reader still
> displays it and a ref chip still opens it — the app simply has no words from
> it to match on.

A book that reports `0 pages indexed` is a scan end to end: it reads fine, it
searches not at all. There is no OCR step.

On a calibrated book, a few PDF pages are also skipped as **front matter** —
any page whose printed number would be less than 1. With the core rulebook's
+5 offset, that is the first five pages. Also expected.

### Flags

| Flag | Effect |
|---|---|
| `--list` | print the filename → code/offset/title guesses and exit; writes nothing |
| `--calibrate` | measure each book's page offset before indexing, and print the report (§4) |
| `--recalibrate` | implies `--calibrate`, and also overwrites an offset a human set |
| `--dir <path>` | folder to scan (default: repo root) |
| `--only <CODE>` | just the one book whose guessed code matches |
| `--max-pages <N>` | extract at most N PDF pages per book (fast test runs) |
| `--data-dir <path>` | `DATA_DIR` override — file store + database location |

Pass flags directly. **A bare `--` before them fails** with `unknown flag: --`,
because pnpm forwards the separator to the script instead of eating it. The
header comment in `apps/server/scripts/seed-books.ts` is the authority on the
flag list for your checkout.

---

## 3. Codes

A code is a book's identity everywhere in the app. `SR5 p.426` typed into a
codex page, a ref on a sheet item, a citation the Fixer returns — all of them
resolve the code against the registry, then apply that book's offset to get to
the right page. Get the code wrong and the chip has nothing to open.

The seeder guesses codes from filenames and **recognises all 17 production
files today**, with the right titles:

| Code | Book | Code | Book | Code | Book |
|---|---|---|---|---|---|
| `SR5` | Core Rulebook | `RF` | Run Faster | `SS` | Stolen Souls |
| `RG` | Run & Gun | `HS` | Howling Shadows | `MP` | Market Panic |
| `SG` | Street Grimoire | `SL` | Street Lethal | `SE` | Serrated Edge |
| `DT` | Data Trails | `FA` | Forbidden Arcana | `CT` | The Complete Trog |
| `CF` | Chrome Flesh | `DKT` | Dark Terrors | `SEA` | Seattle Sprawl |
| `R5` | Rigger 5.0 | `KC` | Kill Code | | |

An **unrecognised filename** falls back to the first six alphanumerics of the
name, uppercased, with the filename as the title — so `my-scan-final.pdf`
becomes `MYSCAN`. Two ways to fix that, and the first is better:

- **Rename the file** to the book's usual name and re-seed. The guess then
  lands right, and it stays right every time you re-seed.
- **Rename the code in the app** (`PATCH /api/books/:id` accepts `code`). Note
  the trap: the seeder matches by *guessed* code, so a later re-seed of that
  file will not find your renamed row and will register a second one under the
  old guess. Rename the file as well, or plan on deleting the duplicate.

---

## 4. Page offsets — the part that actually matters

**Printed page** is the number printed on the paper. **PDF page** is the
position in the file. Front matter — cover, credits, table of contents —
shifts one against the other, by a different amount in every book.

```
printed page + offset = PDF page
```

The core rulebook's offset is **+5**, measured, not guessed:

> printed **426** + 5 = PDF page **431**. Open `SR5 p.426` in the reader and
> the footer says `printed 426 · pdf 431 · offset +5`.

**Every other book is guessed at +0, and the guess is wrong for 15 of the
other 16** — measured, see the table below. A seed without `--calibrate`
therefore leaves fifteen books whose ref chips open the wrong page — silently,
because nothing about a wrong page announces itself. The shelf refuses to print
a bare `0` for that reason: an uncalibrated book reads **"not calibrated"**,
because that is what it is, a default rather than a measurement — and it stays
that label even for the one book (`RG`) whose true offset really is +0, because
nothing on the shelf can tell a lucky default from a measured one.

Calibrating is one measurement per book, once, forever.

### Automatic: measure it

An offset is constant through a book's body, and nearly every rulebook page
prints its own number in the header or footer. Detection samples pages spread
through the body, reads the number-shaped tokens off each one, and takes
`pdfPage − printedNumber` as a vote. The true offset wins by a landslide;
cross-references, prices and years scatter and get pruned. Front matter and
back matter are excluded on purpose — a table of contents and an index are
dense with page numbers that belong to *other* pages.

**At seed time**, which is the cheaper moment:

```
pnpm seed:books --calibrate
```

Each book is measured before its text is extracted, so pages get indexed at
the right printed number the first time. The run then prints a table — offset,
confidence, how many sampled pages agreed, and what the sample skipped
(front/back matter, image-only pages, pages with no number) — followed by the
books it could not measure. An offset a human already set is left alone;
`--recalibrate` overwrites those too.

**In the app**, per book: the shelf (`/c/:campaignId/gm/books`) has a
**detect** button and a **detect all** for everything still uncalibrated. It
reads the PDF in the file store, not the indexed rows — those rows are keyed by
whatever offset was in force when the book was last seeded, so measuring
against them would cheerfully confirm a wrong number a human had just typed in
(that is the same trap the "Re-index after you change an offset" section below
describes, seen from the other side). A registry row with no file falls back to
the indexed pages, and the response says so. Either way it **proposes, never
saves** — you see the offset, the confidence and the sample pages, and applying
it is your click.

Either way, detection declines rather than guesses. Too few pages numbered, a
split vote between two candidates, or an image-only scan with no text at all,
and it keeps the current offset and says why. **A wrong offset is worse than
none**, because every chip in that book then lands on the wrong page silently.
Books it declines get the manual loop below.

### What it measured on the full production set

Every one of the seventeen books, `pnpm seed:books --calibrate` on a wiped
`DATA_DIR`. Reproduced identically on a second run.

| Code | Book | Was | Measured | Confidence | Result |
|---|---|---|---|---|---|
| `CF` | Chrome Flesh | +0 | **+1** | 98% (47/48) | applied |
| `CT` | The Complete Trog | +0 | **+1** | 100% (48/48) | applied |
| `DKT` | Dark Terrors | +0 | **+1** | 98% (47/48) | applied |
| `DT` | Data Trails | +0 | **+1** | 98% (47/48) | applied |
| `FA` | Forbidden Arcana | +0 | **+1** | 98% (47/48) | applied |
| `HS` | Howling Shadows | +0 | **+1** | 94% (45/48) | applied |
| `KC` | Kill Code | +0 | **+1** | 96% (46/48) | applied |
| `MP` | Market Panic | +0 | **+1** | 94% (45/48) | applied |
| `R5` | Rigger 5.0 | +0 | **+1** | 94% (45/48) | applied |
| `RF` | Run Faster | +0 | **+2** | 73% (35/48) | applied |
| `RG` | Run & Gun | +0 | **+0** | 90% (43/48) | confirmed, unchanged |
| `SE` | Serrated Edge | +0 | **+1** | 100% (48/48) | applied |
| `SEA` | Seattle Sprawl | +0 | **+1** | 100% (48/48) | applied |
| `SG` | Street Grimoire | +0 | **+2** | 98% (47/48) | applied |
| `SL` | Street Lethal | +0 | **+1** | 96% (46/48) | applied |
| `SR5` | Core Rulebook | +5 | **+5** | 96% (46/48) | confirmed, unchanged |
| `SS` | Stolen Souls | +0 | **+2** | 98% (47/48) | applied |

**17 of 17 measured. None declined. Nothing left for a human to calibrate.**
Fifteen offsets moved off the seeded guess; `RG` and `SR5` were already right
and were confirmed rather than changed. No sampled page in any of the
seventeen was image-only (`0img` in every row of the run's own report), which
is why the numbers are this clean — a scanned book would not be.

Read the caveats, because "measured" is not "verified":

- **`RF` at 73% is the weak one.** Thirteen of its forty-eight sampled pages
  carried no page number at all — it has a lot of full-bleed art and sidebar
  spreads. It still cleared the bar, and it checks out by hand (printed 150 →
  PDF 152), but it is the book to eyeball first if a ref there looks off.
- **Confidence is agreement, not correctness.** 100% means every sampled page
  that had text voted the same way. A book that numbered its front matter into
  the body could agree with itself and still be wrong.
- **Five of the seventeen were verified end to end** — `SR5` p.426→431,
  `RG` p.104→104, `SG` p.100→102, `R5` p.120→121, `RF` p.150→152, each
  confirmed by finding that printed number in the text of exactly that PDF page
  and on neither neighbour. The other twelve rest on the sampled evidence in
  the table. Spot-check one when you first open it: the reader footer prints
  `printed N · pdf M · offset +k`, which is the whole check.
- **These offsets are for these files.** A different scan or a different
  printing of the same book can have different front matter. Re-measure rather
  than typing the number in.

### Manual: nudge until it matches

The loop that always works, and the one to fall back on when a proposal looks
wrong:

1. Open **GM → Books** and find the card.
2. Put a page you can identify into **"Calibrate at printed p."** — a chapter
   opener with a big visible number is ideal — and press **calibrate**.
3. The reader opens at your current offset's guess. Press **−** / **+** until
   the number printed on the page in front of you matches the number you
   typed.
4. **save offset**.

Or, if you already know the number: type it straight into **Page offset** on
the card and press **save offset**.

Fastest way to measure by hand: open the book, scroll to any page with a
printed number, read the PDF page number off the reader footer, and subtract.
`offset = pdf − printed`. Sanity-check with a second page from a different
chapter before you trust it.

### Re-index after you change an offset

`book_pages` stores the **printed** number for each page, computed with the
offset that was in force at extraction time. Change an offset afterwards — by
hand, or by applying a proposal on the shelf — and the stored numbers are
stale by exactly the amount you changed: search hits and Fixer citations will
name a printed page a few pages off, even though the reader is now correct.

Fix it by re-extracting that one book:

```
pnpm seed:books --only RG
```

The re-seed **preserves your calibrated offset** (and the shared toggle) and
re-extracts the text against it. Refs and search agree again.

Seeding with `--calibrate` avoids this entirely: the measurement happens
before extraction, so the index is right on the first pass.

---

## 5. Adding a book later

1. Drop the PDF in the same folder as the others.
2. `pnpm seed:books --list` — check the code it guessed.
3. `pnpm seed:books --calibrate --only <CODE>` — a full re-run is also safe
   and leaves the other sixteen books' calibration alone.
4. Check the calibration line it printed. If it declined to measure one, open
   the shelf and nudge (§4).

**Re-running the seeder is safe.** For a code that already exists it refreshes
the file and title, replaces the extracted text, and leaves your `pageOffset`
and `shared` settings alone. It is not destructive to calibration work.

### Sharing with the table

The library is **shared with the whole table** (FR11.5, resolved as Q12): every
campaign member can tap a ref chip and read the page in-app, on a phone,
without losing the table view. Each card has a **shared with table** checkbox
to pull one book back to GM-only when you want something back-pocketed. Either
way the files sit behind auth — a device token opens them, nothing else.

### What a backup covers

- **Compose stack:** the nightly `backup` sidecar writes a `pg_dump` (registry
  rows, calibrated offsets, all extracted page text) plus a tarball of the
  file store — **which includes the book PDFs** — into `BACKUP_DIR`, retained
  30 days. A restore rebuilds the library without needing the original folder.
- **Laptop (embedded PGlite):** there is no dump. The backup is a file copy of
  `DATA_DIR` taken **with the app stopped**; restoring is copying it back.
- **What no backup covers:** the source folder you seeded from is not part of
  either path (its contents are, via the file-store copy), and nothing about
  the library is ever in git. And note the asymmetry — keeping the original
  PDFs safe is not a backup of your calibration, which lives in the database.

---

## 6. Troubleshooting

**A ref chip opens the wrong page.** Offset. The book is almost certainly still
at +0 — the shelf will say "not calibrated". Fix the whole shelf at once with
`pnpm seed:books --calibrate`, or that one book on the shelf (§4). Quick check
without a chip: `/read/RG?p=104` opens printed page 104 of that book through
the same mapping.

**A ref chip lands on the last page of the book.** The mapping resolved past
the end and clamped; the reader footer says `· last page`. Either the offset is
far too large, or the ref names a page that book does not have — check the code
on the chip.

**A book is missing from the shelf.** It was not a `*.pdf` in the folder the
seeder scanned, or the seeder wrote to a different `DATA_DIR` than the server
reads. `pnpm seed:books --list` shows exactly which files were seen; add
`--data-dir` to both sides if you use a non-default location.

**Search finds nothing in a book that is definitely there.** Look at that
book's seed line. `0 pages indexed` means an image-only scan with no text
layer: the reader works, search and the Fixer cannot see it. A partial gap
(`199 of 202`) means a handful of scanned pages inside an otherwise fine book.

**Search hits point a few pages off.** The offset changed after extraction.
Re-run `pnpm seed:books --only <CODE>` (§4).

**`unknown flag: --`.** Something inserted a bare `--` between the script name
and the flags — the old form printed in the script header before it was fixed.
Drop it: `pnpm seed:books --list`.

**Two rows for the same book.** A code was renamed in the app and then the file
was seeded again under its guessed code. Delete the stray row; rename the file
instead (§3).

**The seeder errors on the database, or hangs.** A server is already holding
that `DATA_DIR`. PGlite is single-process: stop the server, seed, let it exit,
start the server. Never point two processes at one data directory, and never
delete a `DATA_DIR` a running server is holding.

---

Spec: DESIGN.md §6 M11 (FR11.1–11.7), §14.8–14.9 (content and licensing),
§15 (media caps, durability), §16 (the PDFs stay out of git).
Code: `apps/server/scripts/seed-books.ts` (the CLI and its report),
`apps/server/src/services/books.ts` (guessing, registering, extracting),
`apps/server/src/services/book-offsets.ts` (the measurement itself),
`apps/web/src/features/gm/books/` (the GM's calibration shelf),
`apps/web/src/features/library/LibraryPage.tsx` (the shelf a player sees).
