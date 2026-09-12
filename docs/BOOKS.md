# The rulebook library

How the table's own PDFs become the app's library (M11, FR11.1–11.7), what the
seeder actually does, and the step nobody can skip: page offsets.

Read this once when you set the library up, and again the day you buy a book.

**Two ways to run Safehouse, two places the PDFs go.** Find your row before you
copy a command out of here:

| You start the app with | The PDFs sit in | You seed with |
|---|---|---|
| `pnpm dev:server` — native | any folder; `books/` under the repo root by default, `BOOKS_DIR` in `.env` or `--dir` for anywhere else | `pnpm seed:books --calibrate` — **§2** |
| `docker compose … up -d` | any folder **on the host** — `books/` under the repo root by default, `BOOKS_DIR` in `.env` for anywhere else | one `docker compose … run --rm seed` — **§3** |

Everything else in this file is the same on both: the same seeder, the same
flags, the same codes, the same offsets, the same shelf. Only the two lines
above differ.

---

## 1. Where the PDFs live, and why they never leave

The books are **your copies**. Nothing about this feature moves them anywhere.

- **They stay in a folder you point the seeder at.** The default is `books/`
  under the repo root — beside `DESIGN.md` — and one line in the repo-root
  `.env` names anywhere else: `BOOKS_DIR=D:/books`. Both the native seeder and
  the Docker stack read that line, so it is set once. `--dir D:/books` (or
  `--dir=D:/books`) on the command line overrides it for one run. Under Docker
  the folder is mounted read-only (§3). The seeder reads `*.pdf` from that
  folder; it never writes to it, renames anything, or deletes anything.
- **They never enter git.** `.gitignore` has excluded `*.pdf` since the first
  commit, which is why the PDFs can sit in the repo root at all.
- **They never enter a Docker image.** `.dockerignore` excludes `*.pdf` from
  the build context, and nothing `COPY`s a book into a layer. The Docker flow
  bind-mounts them read-only at run time instead (§3) — an image carrying the
  owner's purchased rulebooks is exactly what DESIGN.md §14.8 rules out.
- **They are never uploaded.** Seeding copies each PDF into the local file
  store at `DATA_DIR/files/books/<CODE>.pdf` (`DATA_DIR` defaults to `./data`,
  also gitignored; under compose it is the `files` volume). That copy is what
  the app serves — over your LAN, behind device-token auth, streamed by byte
  range so a phone opening one page does not pull the whole book.
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
comfortably inside the 200 MB per-book cap (DESIGN.md §15).

---

## 2. Loading the full set

The commands here are the **native** form — the one for `pnpm dev:server`. On
the Docker stack, §3 gives the container form of each; everything else in this
section (the flags, the output, the numbers) reads the same either way.

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
in the book itself, **before** the text is indexed (§5). It is the form to use
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

### Stop the server first (native only)

The embedded database (PGlite) is **single-process**. A running server and the
seed script cannot hold the same `DATA_DIR` at once. Order: stop the server →
run the seeder → let it exit → start the server.

This is a *laptop* rule and it does not apply to the Docker stack, which runs
real Postgres and is perfectly happy with a second client (§3).

### Reading the output

```
[seed:books] streetlethal.pdf -> SL (offset +0)
[seed:books]   offset set: +0 → +1 (46/48 sampled pages agree, e.g. printed 16 on PDF page 17)
[seed:books]   199 pages indexed (202/202 pdf pages scanned)
```

Line 1 is the filename → code guess. Line 2 only appears under `--calibrate`
and is the measurement (§5). Line 3 is the extraction.

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
| `--calibrate` | measure each book's page offset before indexing, and print the report (§5) |
| `--recalibrate` | implies `--calibrate`, and also overwrites an offset a human set |
| `--dir <path>` | folder to scan (default: `BOOKS_DIR` from `.env`, else `books/` under the repo root, else the repo root) |
| `--only <CODE>` | just the one book whose guessed code matches |
| `--max-pages <N>` | extract at most N PDF pages per book (fast test runs) |
| `--data-dir <path>` | `DATA_DIR` override — file store + database location |

Pass flags directly. **A bare `--` before them fails** with `unknown flag: --`,
because pnpm forwards the separator to the script instead of eating it. The
header comment in `apps/server/scripts/seed-books.ts` is the authority on the
flag list for your checkout.

---

## 3. Loading the library into the Docker stack

If you launch with `pnpm docker:up` (the compose stack), this section is your
answer to "where do the PDFs go and what do I run". It replaces
§2's commands and nothing else in this file.

The stack changes exactly two things about seeding:

- the app's file store is a **named volume** (`files`), not a folder on the
  host — so there is no `data/files` to drop PDFs into and be done;
- the runtime image is production-only (no `tsx`, no source), so
  `pnpm seed:books` **cannot** run inside the `app` container.

The answer to both is the compose stack's one-shot **`seed` service**: the same
seeder, built from the Dockerfile's `seed` stage (source, dev deps and `tsx` —
everything the production image deliberately drops), run on the compose network,
writing into the same `files` volume the app reads and the same Postgres the app
talks to. It sits behind the `seed` profile, so `up -d` never starts it.

### The PDFs are never copied into an image

They are **bind-mounted read-only from the host at run time**. No `COPY` puts a
book into a layer, and `.dockerignore` excludes `*.pdf` from the build context
so an accidental one cannot either. That is not a convenience choice: an image
carrying the owner's purchased rulebooks is precisely what DESIGN.md §14.8
forbids — the app never bundles, ships or publicly serves them. Same posture as
the gitignored `models/` folder the `llm` profile mounts.

### The one command

**Put the PDFs in `books/` at the repo root** — the default `BOOKS_DIR`, next
to `DESIGN.md`. The folder is never written to, and it is not part of the
stack's state; the file store's copy is (§6, backups).

Keeping them somewhere else? Name that folder once in `.env`. `BOOKS_DIR`
defaults to `./books`, taken from the repo root (where `compose.yaml` lives),
so this is the only line you touch:

```
BOOKS_DIR=D:/books
```

> **Check this line before your first run.** `.env.example` ships
> `BOOKS_DIR=./books`, a folder the repo does not create for you. Either make
> it and move the PDFs into it, or point the line at wherever they actually
> are. Left as-is with no such folder, the seeder mounts an empty directory and
> reports no PDFs found.

**Then seed:**

```bash
pnpm docker:seed
```

That is the whole procedure — it is `docker compose run --rm --build seed`.
`run` enables the `seed` profile by itself; the service builds (`--build` keeps
the seeder at this checkout), waits for `postgres` to come up healthy, mounts
your folder read-only at `/books` and the app's `files` volume at `/data`,
applies migrations, and runs the `seed:books` §2 describes — same guesses, same
calibration, same report. Budget the minute or so §2 measured for the seventeen
production books. The container exits when the seeding does.

**`--calibrate` is already the default here.** The service's `command` is
`["--calibrate"]`, so a bare `run --rm seed` measures every book's page offset
without you asking (§5). That matters for the next part.

**You do not have to stop the app.** The single-process rule in §2 is PGlite's;
this stack is real Postgres. Seed with a session live if you want to — reload
the browser and the shelf is populated.

### Passing flags

Everything after the service name goes to the seeder, so §2's flag table applies
here as written, with two adjustments:

- **Do not pass `--dir`.** The service's entrypoint already supplies
  `--dir /books`, which is where your folder is mounted. Change `BOOKS_DIR`
  instead.
- **Any flag you pass replaces `--calibrate`**, because it replaces the whole
  default `command`. So re-add it whenever you want calibration:

```bash
# the plan — filenames → code/offset guesses; writes nothing
pnpm docker:seed --list

# one book, calibrated
pnpm docker:seed --only SR5 --calibrate
```

Forgetting `--calibrate` on a targeted run is the easy mistake: it leaves that
one book at the seeded `+0` guess while the rest of the shelf is measured, and
nothing announces it (§5).

### Why there is no copy step

The seeding container mounts the **same `files` volume** as `app` and points at
the **same `postgres` service**, so it writes the library exactly where the app
already looks:

- PDFs → `files:/data/files/books/<CODE>.pdf`, the volume `app` serves from;
- registry rows, measured offsets and extracted page text → the compose
  Postgres, the database `app` reads.

Book paths are stored **relative** to the file store, so nothing is pinned to a
host path and nothing needs rewriting after the fact.

This replaces the older host-side workaround printed in the compose header —
seed on the host against the published Postgres port, then
`docker compose … cp ./data/files/. app:/data/files`. That still works if you
already have a `data/files` from a native run and want to lift it in, but you
no longer need Node, a repo checkout, or host→container networking to load
books.

### Where the env file lives

One place: `.env` at the repo root, beside `compose.yaml`. Compose reads it by
itself — no `--env-file`, no `-f` — and the shell start reads the same file.
(The compose file used to live in `infra/`, which made Compose read
`infra/.env` and silently ignore the root one; that layout is gone, and a
leftover `infra/.env` is named in the server's boot log until you delete it.)

The same rule governs `BOOKS_DIR`, which is why its default is `..` and not `.`:
relative paths resolve against `infra/`, so `..` is the repo root and
`BOOKS_DIR=./books` would mean `infra/books`, not `<repo>/books`. Give it an
**absolute path** (`D:/books`, `/srv/books`) and the question never comes up.

### Confirming it worked

From the app, which is the real check: **GM → Books**. Seventeen cards, each
showing a measured page offset rather than "not calibrated" (§5). Tap a ref
chip; it should open the right page.

From the host, without a browser:

```bash
# the PDFs, in the volume the app serves from
docker compose exec app ls /data/files/books

# the registry rows and the offsets the seeder measured
docker compose exec postgres psql -U safehouse -d safehouse \
  -c 'select code, page_offset from books order by code'
```

Seventeen `<CODE>.pdf` files and seventeen rows, `SR5` at `+5`. (Swap
`safehouse` for your `POSTGRES_USER` / `POSTGRES_DB` if you changed them.) Files
present but the shelf empty means the seeder wrote to a different database than
the app reads — `docker compose config` prints what each service resolved.

### Adding a book later, under Docker

Drop the new PDF into the folder the others are in and run the same command
again:

```bash
pnpm docker:seed
```

**The seeder is re-runnable** (§6): for a code that already exists it refreshes
the file and title and replaces the extracted text, and leaves your calibrated
`pageOffset` and `shared` flag alone. Nothing you have calibrated is at risk, so
a full re-run for one new book is the safe, boring choice — and at a minute, the
cheap one.

Narrow it if you prefer, remembering that a flag replaces the default
`--calibrate`:

```bash
pnpm docker:seed --only SS --calibrate
```

Not sure the mount points where you think? `pnpm docker:seed --list` prints the
filename → code/offset guesses for everything it can see and writes nothing.
Run that first.

---

## 3b. The catalogue — items, spells and powers, read out of the pages

Seeding does one more thing with every page it indexes: it reads the gear
tables and the spell stat blocks off the extracted text into `book_items`,
so a player can pick a weapon, a piece of armor, a spell or a power **by
name** from a sheet and have the stats the book printed — and its page —
land on the sheet. That is the whole of "acquiring" in Safehouse: how the
runner came by it is worked out with the GM at the table; the app keeps the
inventory and provides the numbers.

Nothing is shipped (§14 / NG2). The catalogue is compiled from *your* PDFs
into *your* database, sits beside the pages it came from, and goes with the
book when the book is deleted. A fresh checkout has an empty catalogue until
`pnpm seed:books` runs.

What the parser reads is **shape, not content**: a header line naming the
columns (`… ACC DAMAGE AP MODE RC AMMO AVAIL COST`, `… ESSENCE CAPACITY
AVAIL COST`, `HANDL SPEED ACCEL BODY …`) followed by rows ending in a price;
a spell's name over its `Type: … Range: … Drain: …` lines; an adept power's
`Cost: 0.5 PP`; a quality's `Cost: 5 Karma`. Rows are read from the right —
price, availability, one cell per column — because the name is the only
cell whose width the table does not fix. A one-row table (a heading, the
columns, the numbers — how the weapon books print each blade) takes its name
from the heading. What it does not read: prose ("they have an Availability
of 4F…"), rows that wrap over two lines, rating tables with one row per
rating. Those are still on the page, still in search, still a ref away —
just not pickable by name.

**What the full production set yielded** (2026-09-12, 17 books, 3,542 pages,
1 s to recompile): 1,840 items. The core book alone: 74 weapons, 11
ammunition, 16 armor, 69 augmentations, 40 vehicles, 34 electronics, 21
programs, 151 gear, 84 spells, 24 powers, 12 complex forms. Run & Gun 91
weapons and 88 armor; Street Lethal 91 weapons; Rigger 5.0 252 vehicles;
Street Grimoire 101 spells; Chrome Flesh 189 augmentations. The setting
books (Seattle Sprawl, Serrated Edge, Market Panic) yield nothing, which is
right — they print no tables. The seeder's log says per book what it read
and how many priced rows under a recognised header it could not
(`(11 rows not read)`), so a book that yields 0 items is visible rather
than silent.

### Recompiling without touching the PDFs

```bash
pnpm seed:books --catalogue            # every book already indexed
pnpm seed:books --catalogue --only SR5 # one book
```

Reads the pages already in the database back into the catalogue — for a
library indexed before the catalogue existed, or after the parser learns a
new shape. Seconds, not minutes; nothing is re-extracted. The GM can do the
same for one book from the API (`POST /api/books/:id/catalogue`).

### Where it shows up

- **On a sheet** — Gear, Combat and Magic tabs each have a **+ from the
  books** button beside their section. Type part of a name, see the stats
  the book printed and the page, tap **add**. A weapon lands with its
  accuracy, damage, AP, modes, ammo and recoil compensation in the sheet's
  own fields; a spell with its drain code; armor with its rating; 'ware with
  its Essence cost; anything else as gear with the row in its note. Every
  item carries the page as its ref chip. With the spend box ticked (the
  default when the row has a price) the same tap proposes the nuyen on the
  ledger, **pending until the GM approves it** (FR3.6) — the ledger says
  what was bought without deciding whether it was (the GM's own spend is
  recorded outright). **Or write your own**, in the same dialog: the fields
  the sheet keeps for that kind, a price, a page if there is one — for the
  thing that is in no table, or in no book. The GM adds to any sheet the
  same way. **The price is the table's:** every hit carries the book's price
  in a box either role can type over, so a street price, a favour or a
  rip-off is one edit. **Find & negotiate** takes an item through the core
  book's Availability test as printed (SR5 p.418): who negotiates — the
  runner with Negotiation + Charisma [Social], one of their contacts with
  dice the GM types and their Connection on the limit, or someone the GM
  names — what they offer (every extra quarter of list is one more die, up
  to twelve), one Opposed Test against the item's Availability rating with
  both rolls on the table's record, the delivery time from the price band
  divided by the net hits (a tie doubles it, a loss says when to try again,
  a glitch is the GM's to read), and then the price actually paid, which is
  whatever the table says. **×** removes an item in one tap; History has
  the revision.
- **In the search overlay** (`/`, or ⌕ in the header) — items answer above
  the page hits, with their stats, and the ref opens the page.
- **For the Fixer** — the `search_catalogue` tool, beside `search_books`,
  for "what does an Ares Predator cost" without a page of prose.
- **Visibility is the library's** (FR11.5): a GM-only book's items are not
  a back door to the book.

## 4. Codes

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

## 5. Page offsets — the part that actually matters

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

## 6. Adding a book later

1. Drop the PDF in the same folder as the others.
2. `pnpm seed:books --list` — check the code it guessed.
3. `pnpm seed:books --calibrate --only <CODE>` — a full re-run is also safe
   and leaves the other sixteen books' calibration alone.
4. Check the calibration line it printed. If it declined to measure one, open
   the shelf and nudge (§5).

Same four steps on the Docker stack, through the seeding container: the folder
is `BOOKS_DIR`, and each `pnpm seed:books` above becomes
`docker compose … --profile seed run --rm seed`, carrying the same flags (§3).

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

## 7. Troubleshooting

**A ref chip opens the wrong page.** Offset. The book is almost certainly still
at +0 — the shelf will say "not calibrated". Fix the whole shelf at once with
`pnpm seed:books --calibrate`, or that one book on the shelf (§5). Quick check
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
Re-run `pnpm seed:books --only <CODE>` (§5).

**`unknown flag: --`.** Something inserted a bare `--` between the script name
and the flags — the old form printed in the script header before it was fixed.
Drop it: `pnpm seed:books --list`.

**Two rows for the same book.** A code was renamed in the app and then the file
was seeded again under its guessed code. Delete the stray row; rename the file
instead (§4).

**The seeder errors on the database, or hangs.** A server is already holding
that `DATA_DIR`. PGlite is single-process: stop the server, seed, let it exit,
start the server. Never point two processes at one data directory, and never
delete a `DATA_DIR` a running server is holding. This is native-only — on the
Docker stack, real Postgres takes the second client without complaint.

### Docker stack

**"no PDFs found", or it seeds the wrong folder.** Almost always: `.env.example`
ships `BOOKS_DIR=./books`, and there is no `books/` folder — put the PDFs there
or repoint the line (§3). Ask Compose what it actually resolved rather than
guessing:

```bash
docker compose --profile seed config
```

The `seed` service's `/books` volume line prints the host path it will mount. A
path you did not expect there is the whole bug — a relative one is read from the
repo root, where `compose.yaml` lives.

**`no such service: seed`.** You are in an older copy of the repo, or standing
somewhere other than its root (Compose looks for `compose.yaml` in the current
directory). This lists what the file really defines:

```bash
docker compose --profile seed config --services
```

**It seeded, but the shelf says "not calibrated".** You passed a flag, and a
flag replaces the service's default `command` — which was the `--calibrate`
(§3). Re-run with it spelled out: `run --rm seed --only <CODE> --calibrate`.

**The files are in the volume but the shelf is empty.** The seeder wrote to a
different database than the app reads — a different env file, or a different
`POSTGRES_DB`, between the `up` and the `run`. Use one env file for both (§3).

**`docker compose cp` — do I still need it?** No. The seeding container writes
straight into the `files` volume (§3). The `cp` in the compose header is only
for lifting a `data/files` produced by a *native* run into the stack.

---

Spec: DESIGN.md §6 M11 (FR11.1–11.7), §14.8–14.9 (content and licensing),
§15 (media caps, durability), §16 (deployment; the PDFs stay out of git).
Code: `compose.yaml` (the stack and its seeding service, §3),
`apps/server/scripts/seed-books.ts` (the CLI and its report),
`apps/server/src/services/books.ts` (guessing, registering, extracting),
`apps/server/src/services/book-offsets.ts` (the measurement itself),
`apps/web/src/features/gm/books/` (the GM's calibration shelf),
`apps/web/src/features/library/LibraryPage.tsx` (the shelf a player sees).
