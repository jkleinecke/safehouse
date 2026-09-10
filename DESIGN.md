# Safehouse — Software Design Document

**Project:** Web platform for running a Shadowrun 5th Edition campaign
**Codename:** Safehouse (working title — the place the team plans the run; rename freely)
**Version:** 0.9 (draft for table review; supersedes 0.8)
**Date:** 2026-08-27
**Status:** Proposed — decisions marked `[D#]` are defaults chosen to keep momentum; see §20 for the ones worth confirming before code is written.

**Changed in 0.2:** the Grid (GM map making + grid combat + VTT extras) and the Opposition Kit (NPC generator, encounter planner, combat copilot) are now core pillars, per table feedback. Decision D1 ("companion, not a VTT") is superseded. The success criterion is explicit: **retire Roll20 completely**. Roadmap re-cut into P0–P6.

**Changed in 0.3:** the table's full PDF library (17 books, now sitting beside this file) becomes a first-class feature — **M11 Rules Library**: every book reference anywhere in the app is a structured `{book, page}` citation that opens the GM's own PDF at the exact page, in one tap. Per-book printed↔PDF page offsets are calibrated (the core rulebook's is **+5**, measured: printed p.426 = PDF p.431). Q3 (sourcebooks) is resolved: everything.

**Changed in 0.4:** Q9 and Q12 resolved by the GM — the book library is **shared with the whole table** in-app (FR11.5 default flipped), and Roll20's dynamic lighting and jukebox are **not used**, so FR9.16/FR9.18 stay P6-if-ever and both conditional rows clear from the exit checklist.

**Changed in 0.9:** the Fixer's **campaign-state awareness is now an explicit contract** (FR12.17–12.19): a read-only tool catalog over every piece of live state — characters' derived sheets and monitors, the running encounter's initiative and wounds, the active scene's tokens and fog, NPCs and personas, ledgers, runs, contacts, the calendar — always queried live, returning the same engine-derived numbers the table sees; plus an auto-injected **situation snapshot** during live sessions and a **spoiler guard** on player-facing drafts. Reads are free; writes stay draft-gated (Principle 8).

**Changed in 0.8:** D12 decided — **the Fixer runs on local models via an OpenAI-compatible API (llama.cpp or vLLM)**, not a cloud provider. Consequences: the LAN posture is fully restored (the Discord webhook is once again the *only* outbound traffic — book text, campaign data, and conversations never leave the laptop); AI works with zero internet and zero per-token cost; citations are produced by our retrieval layer (which knows exactly which book+page each passage came from) rather than by the model; vision features (map analysis) are capability-flagged on running a vision-capable local model; and the cost meter becomes a resource meter — the new constraint is the laptop's RAM/GPU, shared with the session itself (R11).

**Changed in 0.7:** AI becomes the fifth pillar — **M12 "The Fixer"**: an always-available GM copilot (rules research with tappable page citations, lore search, planning, brainstorming) plus AI hooks across the platform: NPC personalities/backstories and in-character conversations (M10), grid-true map layout generation and map-image analysis (M9), fog-of-war assistance and token identification, mood-driven music curation (reviving ambient audio, superseding FR9.18's "waits for demand"), and recap drafting (M6). Governing rule: **AI proposes, the GM disposes** (new Principle 8) — stats stay procedural and engine-validated, AI writes fiction; everything lands as GM-approved drafts; the app remains fully functional with AI off. *(Provider decided in 0.8: local models.)*

**Changed in 0.6:** party composition resolved — **street samurai, mage/shaman, adept; no decker, no rigger** (Q3/Q6 closed). The Magic toolkit (M8) leads Phase 5; the Matrix toolkit (M7) demotes to Phase 6 / on-demand (the GM can still run NPC hosts by hand until then); no dedicated Rigger toolkit. A per-weapon progressive-recoil counter joins the street sam's live-play widgets (FR3.4). Map pipeline resolved (Q10): a mix of ready-made images, scans, and in-app assembly — upload-first in P2, prop-stamp assembly grows from P3.

**Changed in 0.5:** hosting concretized — **the app runs in Docker on the GM's laptop**, built **multi-arch (ARM64 and AMD64)** so the host machine's architecture doesn't matter: live on the table's Wi-Fi during sessions, localhost-only for GM prep between them. Players do not interact with it between sessions (their window is the Discord recap), so nothing ever faces the internet. Consequence: D7 revised — Discord OAuth is dropped (it needs a public callback URL that no longer exists) in favor of **QR-code join links minting per-device tokens**; the outbound Discord recap webhook stays. Also new: the table's **big TV** becomes a first-class **table display** — a kiosk view of the players' perspective (FR9.19–9.21).

---

## 1. Summary

Safehouse is a self-hosted web application for one Shadowrun 5e table: a GM and a handful of players. **Success is defined as: the campaign no longer needs Roll20.net for any part of play.** Voice stays on Discord (where it already lives); everything else Roll20 does for us today — and everything SR5 makes painful that Roll20 never handled — moves here.

Four pillars:

1. **Live-table mechanics** — dice pools with limits, Edge, and glitch detection; the initiative-pass combat turn; condition monitors and wound modifiers; Overwatch Score; sustained-spell bookkeeping. SR5's crunch is exactly the kind of arithmetic software should absorb.
2. **The Grid** — scenes, GM map making, tokens on a grid, fog of war, measurement that speaks SR5 (movement rates, weapon range bands, environmental modifiers that flow straight into dice pools), and the table-feel extras: pings, drawings, AoE templates with grenade scatter, staged reveals.
3. **The Opposition Kit** — an NPC generator that builds statted opposition from GM-authored archetypes in seconds, an encounter planner that balances against the *actual party's* sheets, and a combat copilot that runs those combatants during the fight: one-tap rolls, resolved attack chains, morale prompts.
4. **Campaign memory & ledgers** — a wiki/codex of NPCs, factions, locations, and runs with GM-only secrecy; session recaps; an in-game calendar; handouts; auditable karma and nuyen tracking, because "wait, how did you afford that?" should have an answer.
5. **The Fixer** — an AI copilot woven through all of the above: an always-open GM assistant that researches rules with tappable page citations into the PDF library, searches the campaign's own lore, brainstorms and plans runs; generates NPC personalities, backstories, and in-character conversation; drafts grid-true map layouts and reads uploaded map images; helps run fog reveals and token identification; sets the stage with mood-matched music; and drafts the session recap. It proposes — the GM disposes (Principle 8).

Under all four sits the **rules library** (§6 M11): the table's own rulebook PDFs — all seventeen — registered with the app, so that every page reference anywhere (sheets, archetype templates, codex entries, the roll log's provenance) opens the right book to the right printed page in one tap. The rulebook stops being the thing you put the app down to go find.

Everyone accesses it in a browser (players mostly on phones at the table, the GM on a laptop). State syncs in real time during sessions. The GM can override any computed value anywhere — the app assists, it never enforces.

It all runs **from the GM's laptop, in Docker** — the whole campaign in a backpack, on ARM or AMD64 alike. During sessions it serves the table's Wi-Fi: players on phones, the GM on the laptop, and **the big TV as the table display**, showing the players' view of the scene, the turn order, and the GM's reveals. Between sessions it's localhost-only for GM prep, and players' window into the campaign is the Discord recap, by design. Nothing ever faces the internet.

---

## 2. Success criterion, goals, and non-goals

### The success criterion

> **We cancel Roll20 and never miss it.** Every Roll20 feature the campaign actually uses has a home in Safehouse (the parity checklist in §18 tracks this), and the SR5-native features Roll20 never gave us — initiative passes, limits, Edge, wound propagation, party-aware encounter math — are the reason we're glad we moved.

### Goals

- **G1.** Cut at-the-table friction: any common roll in ≤2 taps from a character sheet; combat turn order always visible and correct under SR5's initiative-pass rules.
- **G2.** Be the single source of truth for campaign state: characters, karma/nuyen, contacts, runs, world lore, in-game date.
- **G3.** Respect GM secrecy: hidden rolls, GM-only notes and wiki content, hidden tokens and staged map reveals, one-click handout reveals.
- **G4.** Work on the devices at the table: phones for players, a laptop for the GM, over ordinary Wi-Fi.
- **G5.** Preserve trust: server-side dice with an immutable, visible roll log; server-authoritative token positions.
- **G6.** Stay legally clean: ship zero copyrighted rules text, stat blocks, or art. The platform holds mechanics and *user-entered* data; the rulebook stays at the table (page references, not reproductions).
- **G7.** Be buildable and runnable by one person: boring tech, one-command deploy, nightly backups.
- **G8.** Tactical clarity: one shared map truth — where everyone is, what's revealed, whose turn it is — visible at a glance on every device.
- **G9.** GM force multiplier: statted, party-appropriate opposition in minutes instead of evenings, and runnable one-handed mid-combat.
- **G10.** One GM, studio output: with the Fixer, a solo GM produces what would otherwise take a co-GM and a prep evening — storied NPCs, voiced conversations, dressed scenes, cited rules answers — without surrendering a single decision.

### Non-goals

- **NG1.** The Grid is a **2D tactical layer, not a simulation**: no 3D, no physics, no animated spell effects. Advanced sight automation (wall-based token vision, dynamic lighting) is deliberately late-phase (P6) — manual fog ships first and is fully playable.
- **NG2.** Not a rules database or SRD: no browsable spell/gear compendium shipped with the app. Users enter or import their own content. (The NPC generator's *flavor* tables — names, quirks — are our own original writing; its *stats* are parameterized from GM-authored templates. §14.)
- **NG3.** Not a chat/voice platform: voice stays on Discord. In-app messaging is limited to the roll/event log with short table-talk lines. (Per-scene ambient audio loops are a P6 stretch item — the table doesn't use Roll20's jukebox, so nothing here blocks the exit. Q9 resolved.)
- **NG4.** Not multi-tenant SaaS: designed for one group. Nothing should *preclude* multiple campaigns per instance, but we don't build billing, org management, or public signup.
- **NG5.** No native mobile apps. Responsive web only — play views work on phones; map *authoring* is desktop-only.
- **NG6.** No other editions or systems. SR5 assumptions may be baked in wherever it simplifies things.
- **NG7.** AI never runs the game: it never rolls dice, never decides outcomes, never speaks to players unmediated, and no core loop ever *requires* it — every AI feature is optional, GM-gated, and degrades to the manual path when the local LLM service is down or unconfigured (Principle 5). The Fixer is a copilot, not a co-GM with authority.

---

## 3. Product principles

1. **Table-first.** Every design decision is judged by "does this make Friday night faster?" Prep features exist to serve session features.
2. **Assist, don't enforce.** Every computed value — pools, limits, monitors, initiative, movement, costs, threat estimates — is a *default the GM or owner can override inline*. House rules and book edge-cases must never require a code change to play through. Overrides are visibly flagged so drift is deliberate.
3. **Show your work.** Any derived number can be expanded to show its provenance: which attribute, which 'ware, which wound penalty, which scene modifier. "Why is my pool 11?" is answered by hovering, not by re-deriving the sheet by hand. The encounter planner's threat readouts show their math for the same reason.
4. **GM secrecy is sacred.** Hidden information is filtered *server-side*. A player's browser never receives data it isn't entitled to render — including hidden tokens' positions.
5. **Graceful degradation.** If a subsystem isn't modeled yet (or the engine gets a corner case wrong), everything falls back to manual entry — a free-text roll, a hand-set initiative score, an edited monitor, a hand-placed token. Partial automation is still useful automation.
6. **Ship no book content.** See §14.
7. **Phone-friendly or it didn't happen.** Player-facing session views — sheet, log, encounter, and the Grid's play view — are designed at 390 px width first. GM authoring tools target the laptop.
8. **AI proposes, the GM disposes.** Every AI output is a *draft with provenance* (model, prompt, timestamp) that the GM accepts, edits, or discards — never silently applied state. Mechanical numbers stay procedural and engine-validated (D13); AI writes fiction, reads maps, and fetches answers. Nothing AI-generated reaches players without passing through the GM's hands, and the table plays on unimpeded when the AI is off or the model service isn't running.

---

## 4. Users and core loops

| Persona | Role | Needs |
|---|---|---|
| **GM** (1) | Campaign owner/admin | Build maps and stage scenes; generate and balance opposition fast; run combat (rolls, morale, tokens, fog) without page-flipping; keep secrets; award karma/nuyen with a paper trail; recap sessions; and lean on the Fixer for rules, lore, voices, and prep at every step |
| **Players** (3–6) | Members | See their character clearly on a phone; roll fast with correct pools; move their token, see the map and turn order; track damage/Edge/ammo/spells without math; browse shared lore during sessions; settle karma spends in the end-of-session housekeeping beat |
| **Observer** (0–2, optional) | Read-only guest | Watch the active scene, roll log, and shared codex |

### Core loops

- **Session loop (weekly, live):** GM starts the stack (`docker compose up`) → players join from phones, the TV joins as the table display → GM activates a scene; tokens and fog are already staged, the scene fills the TV → rolls stream to everyone → combat launches from the scene's tokens → copilot runs the opposition while players act → damage, Edge, and Overwatch tracked live → end-of-session housekeeping settles karma/nuyen spends → GM closes session, awards land in ledgers, recap posts to Discord.
- **Prep loop (GM, async):** brainstorm the run with the Fixer → draft it (Johnson, objectives, payout) → build or upload maps (the Fixer proposes walls, regions, and layouts), pre-place fog and hidden tokens → generate opposition from archetype tiers with AI-written personalities, check the threat readout against the party, tweak → stage handouts and secret wiki entries pre-linked for one-click reveal.
- **Downtime loop (GM only, on the laptop):** the app is offline to players between sessions by design — their window is the Discord recap. The GM preps, writes and publishes the recap, advances the calendar, and stages awards. Player karma/nuyen spends happen at the table instead: an **end-of-session housekeeping beat** where spends are proposed, approved, and land in the ledger while everyone's still connected.

---

## 5. Prior art and why build custom

| Tool | What it's good at | Why it's not enough |
|---|---|---|
| **Roll20** (the incumbent we're retiring) | Maps, tokens, fog, handouts, rollable tables — the generic VTT baseline the table runs on today | Generic: SR5 initiative passes, limits, Edge, wound propagation, and Overwatch are manual or macro-hackery; sheets are clunky on phones; no campaign ledgers; no party-aware encounter tools. We keep paying it only because the maps live there — so Safehouse must do maps well (§6 M9) |
| **Foundry VTT** | The strongest generic VTT; SR5 community module exists | Buying maps-plus-modules still means fighting a generic platform's assumptions to get SR5-native automation and our integrations (scene modifiers → dice pools, party-aware NPC gen, ledgers, codex secrecy). Self-hosted like us, but extending it means living inside its module API rather than owning the whole loop |
| **Chummer5a** (desktop, open source) | The de-facto SR5 character builder; deep rules coverage | Single-user desktop app; no campaign layer, no live play, no phones. **We integrate rather than compete: Chummer import is our character pipeline** (§6 M3) |
| **Spreadsheets + Discord bots** | Free, flexible | No structure, no secrecy, constant manual math, no provenance, karma tracking rots |

Being honest about the trade: by taking on maps and tokens ourselves we're rebuilding the hardest part of what Roll20/Foundry give away — the Grid is the single biggest technical line item in this document (risk R9). What justifies it is integration a generic VTT can't offer: the scene's lighting feeds the shot's dice pool, the ruler knows the shooter's weapon bands, the generator knows the party's actual defense pools, and one karma ledger sits under all of it. One tool, one login, one source of truth — and one subscription cancelled.

---

## 6. Feature modules

Modules carry their phase from the roadmap (§18). "FR" items are functional requirements; each module ships with acceptance criteria derived from them.

### M1 — Accounts, campaign, and membership *(Phase 0)*

- **FR1.1** Sign-in, LAN-party style: the GM account is created at install; players join by scanning a **QR code** (or tapping a link) the GM shows at the table, which mints a long-lived token bound to that device and player. No passwords, no external identity provider — there is no public callback URL to give one, and none is needed. `[D7 rev.]`
- **FR1.2** A campaign has one GM (owner), players, and observers. GM can transfer ownership.
- **FR1.3** Invites are those QR/join links: expiring, role-scoped (player/observer/display), revocable per device — a lost phone is one tap to revoke and one scan to replace.
- **FR1.4** Roles gate everything per the capability matrix in §13.
- **FR1.5** Campaign settings: name, in-game start date, house-rule flags the engine consults, Discord webhook URL.
- **FR1.6** A campaign outlives the browser that started it — the GM plays it over months and must never need to remember a token or a UUID. `GET /api/campaigns` lists the caller's own memberships (never "every campaign on this box"), so the sign-in screen can offer them by name; device sessions are stored per (campaign, role), so a second table cannot evict the first. A GM whose device is gone recovers one **without a secret** two ways, both minting for the campaign's existing `gm_user_id` so neither can create a user or invent a GM: `POST /api/gm/recover`, gated on a raw loopback socket (`req.socket.remoteAddress`, never `req.ip`; refused if any forwarding header is present or `trustProxy` is on), and the `gm:token` CLI, which needs a shell on the box that owns the database. Loopback is not a weaker credential than a token there — that browser can already read the database off the disk. Under Docker the host arrives from the bridge gateway, so the route correctly refuses and the CLI is the path (README, "Coming back next session").
- **FR1.7** *(open table — a deliberate, reversible relaxation)* `SAFEHOUSE_OPEN_TABLE=1` bypasses the FR1.6 gate entirely: `GET /api/gm/recover` lists **every** campaign on the server with the display name of the GM who started it, and `POST /api/gm/recover` mints a GM device for any of them from any address. This is the posture for a private table — friends around one laptop, where who is running tonight is a social fact the software need not adjudicate — and it is honestly what it looks like: no credential stands between the network and the GM console, so it must never run on an internet-reachable host. It is scoped to that one gate (`assertLoopbackOrigin` returns early; every other role guard is untouched, and a player token is still a player token everywhere else), read per request so it cannot be stale, and announced with a warning on every boot. Unsetting it restores FR1.6 whole — that reversibility is the requirement, not the convenience.

### M2 — Dice engine and roll log *(Phase 1, the heart of the app)*

- **FR2.1** Roll a pool: N d6 → hits (5–6), ones, glitch (ones on more than half the dice rolled), critical glitch (glitch with zero hits). Server-rolled (§10), persisted, broadcast.
- **FR2.2** Limits: a roll can carry a limit (Physical/Mental/Social/Accuracy/Force); hits above the limit are shown but greyed out and excluded from the effective total.
- **FR2.3** Edge actions, first-class: Push the Limit (pre-roll: +Edge dice, Rule of Six, ignore limit; post-roll: add Edge dice with Rule of Six), Second Chance (reroll non-hits once, limit still applies), Seize the Initiative, Blitz, Close Call. Edge spend decrements the character's current Edge with a log entry; burning Edge is a distinct, loudly-confirmed action.
- **FR2.4** Buying hits (4 dice : 1 hit) as a no-roll option where the GM allows it.
- **FR2.5** Roll kinds: simple, opposed (two rolls linked, net hits computed), threshold, extended (interval + cumulative hits, pool shrinking by 1 die per roll), teamwork (helpers add dice/limit to a leader's roll).
- **FR2.6** Rolls launched from a sheet carry provenance: the pool breakdown (attribute + skill + each modifier, including active scene modifiers per FR9.7) is stored and inspectable on the log entry (§10).
- **FR2.7** Visibility: public, GM-only, or GM+owner ("roll behind the screen"). Hidden results are never sent to unentitled clients.
- **FR2.8** Free-form rolls (type a pool size, optional limit) for anything the sheet doesn't model. Personal macros for recurring custom rolls.
- **FR2.9** The session log interleaves rolls, damage events, Edge/karma/nuyen changes, scene markers, reveals, and short table-talk lines; it is append-only and is the session's factual record.
- **FR2.10** Optional mirroring of public rolls/summaries to the campaign's Discord webhook.
- **FR2.11** Campaign rollable tables (Roll20 parity): user-defined weighted tables (run complications, loot, weather, rumor mill) rollable from the log, GM-only or public. The Opposition Kit's flavor tables (FR10.2) are these same tables under the hood.

### M3 — Characters *(Phase 1 read + live-play; Phase 5 advancement; Phase 6 creation)*

- **FR3.1** Import a character from a Chummer5a `.chum5` (XML) save. Store the raw file, map what we understand into the sheet model (§9), list anything unmapped for manual entry. Re-import shows a diff before overwriting. `[D5]`
- **FR3.2** Sheet view, phone-first: identity/condition strip pinned on top; tabs for Skills (tap → roll), Combat (weapons with per-mode pools, armor, recoil note), Magic/Resonance, Matrix, Gear, Contacts, Background.
- **FR3.3** Derived values computed by the rules engine with provenance (§10): attributes with augment caps, limits, initiative variants, condition monitor sizes, armor, movement rates, dice pools per skill/weapon/spell.
- **FR3.4** Live-play widgets: Physical/Stun/overflow monitors with automatic wound modifiers applied to pools and initiative; current Edge; ammo counters and a **progressive-recoil counter** per weapon (clears per the recoil rules, one tap to reset — the street sam's constant companion); sustained-spell list applying −2 each; status effects (toggles that inject modifiers).
- **FR3.5** Manual override on any derived value (owner or GM), visibly flagged, with an optional "because" note.
- **FR3.6** Karma & nuyen ledgers: append-only entries (award, spend, adjustment) with reason, timestamp, session link, and running balance. Player-initiated spends are *pending* until GM approval — proposed and settled **at the table** during the end-of-session housekeeping beat, since players don't reach the app between sessions (§4). Sheet totals are the ledger sums — no free-floating numbers. (Basic manual entries ship with P1; the approval workflow lands in P4.)
- **FR3.7** Advancement (Phase 5): guided karma spends (raise attribute/skill, new spell, etc.) generating correct costs from the standard cost tables (e.g., attributes at new rating × 5, active skills at new rating × 2, skill groups at new rating × 5), editable before submit, landing as pending ledger entries plus a sheet mutation on approval.
- **FR3.8** Character revisions: every accepted sheet mutation snapshots; owner/GM can view history and roll back.
- **FR3.9** Native character creation (Phase 6): Priority system first (A–E grid), Sum-to-Ten as a variant; Karma-gen out of scope until asked for. Until then, Chummer is the builder.

### M4 — Combat tracker *(Phase 1)*

The most SR5-specific screen, and the first thing Roll20 never did for us.

- **FR4.1** Encounters contain combatants from PCs, NPC templates, generator output (M10), and grunt groups; they can be prepped in advance and launched during a session — from a list, or from a scene's tokens (FR9.10).
- **FR4.2** Initiative per SR5: roll (or hand-enter) each combatant's Initiative — REA + INT + 1d6 physical by default, more dice from augments up to 5d6; astral (INT×2 + 2d6) and Matrix cold-sim (DP + INT + 3d6) / hot-sim (DP + INT + 4d6) variants selectable per combatant. Wound modifiers apply. Every row reads as dice to roll (`8+2d6`), and both ways of getting the number are first-class: the server rolls, or the table does and the *dice total* is typed in — the tracker adds base and wounds, so nobody at the table does the arithmetic. A runner may roll or enter their own row from their phone; every other row is the GM's.
- **FR4.3** The tracker runs the **combat turn structure natively**: everyone acts in descending Initiative Score order; at the end of a pass every score drops by 10; anyone still above 0 acts again; new turn re-rolls. The UI always shows current pass, acting combatant, and who's still coming.
- **FR4.4** Interrupt actions: a menu of common interrupts with their initiative costs (Full Defense −10, Block/Parry/Dodge −5, Intercept −5, Hit the Dirt −5, …), fully editable, deducting from the actor's current score immediately. Edge "Seize the Initiative" and "Blitz" supported from the tracker.
- **FR4.5** Damage application: pick target → enter boxes (or apply from an opposed roll's net result, or from a copilot chain per FR10.8) → the right monitor fills, overflow handled, wound modifiers recompute and propagate to that combatant's pools and initiative score automatically. One-tap undo.
- **FR4.6** Grunt groups: a squad sharing a stat template and Professional Rating, rendered as one row with per-member condition ticks and a shared Group Edge pool.
- **FR4.7** Status effects library (prone, blinded, suppressed, custom…) that attach modifiers with durations ("until end of turn", "while sustained", manual).
- **FR4.8** Everything hand-editable mid-fight (scores, monitors, order) — see Principle 2. A "dumb mode" encounter with nothing but names and hand-typed scores must work.
- **FR4.9** The players' encounter view (phones) shows turn order, their own monitors and current modifiers, and *never* shows GM-hidden combatants or exact NPC stats — presence and public condition only, at GM discretion.
- **FR4.10** Tracker ↔ Grid ↔ Copilot: the acting combatant's token is highlighted on the scene; damage updates token bars; NPC rows carry the copilot's quick-roll rack (FR10.7–10.9).

### M9 — The Grid: maps, tokens, and tactical play *(Phase 2 core; Phase 6 advanced)*

Full Roll20-parity mapping plus the SR5 integrations no generic VTT gives us. `[D1 rev.]` `[D9]`

**Scenes and map making**

- **FR9.1** Scenes: one or more per campaign, each with map image(s), a configurable square grid (meters per square, offset, opacity — SR5 measures in meters; default 1 m), and scene notes. GM activates one scene for the table; players' Grid view follows the active scene. GM can stage others privately.
- **FR9.2** Map building, upload-first (Q10 resolved: maps are a mix of ready-made images, scans of hand-drawn maps, and in-app assembly): **P2 ships** upload of floor plans/images as backgrounds, multi-image layout (building + inset), grid alignment, and photo-friendly controls for scans (rotate, crop, contrast), plus simple GM-layer geometry — walls, zones, doors (open/closed toggle), labels. **P3+ grows** the assembly side: a library of user-uploaded props and tiles (crates, vehicles, furniture, floor sections) placeable as flat stamps, expanding with use. It never becomes a dungeon-painting suite.
- **FR9.3** Map pins that link to codex pages (FR5.3) and handouts — hover a pin, see the lore; GM pins can be private or revealed.

**Tokens**

- **FR9.4** Tokens linked to PCs, NPCs, grunt members, spirits, and drones/vehicles — or free-standing props. Art from character portraits or uploads; a small set of original silhouette markers ships as fallback. Sizes in grid units (metahuman 1×1; drones/vehicles/spirits any). Facing optional.
- **FR9.5** Drag with grid snap (toggleable), server-authoritative final position, smooth interim motion for everyone watching (§11 ephemeral events). Players move only their own tokens (GM-toggleable); the GM moves anything.
- **FR9.6** Token bars and markers: condition monitors on the token (GM sees all; players see their own and whatever the GM exposes), status-effect icons synced from the tracker (FR4.7), an aura ring for sustained-spell radii or spirit Force when the owner enables it.
- **FR9.7** Hidden tokens: GM-layer tokens are invisible to players — **their positions are never sent to player clients** (Principle 4), not merely undrawn. One click reveals (with an optional log announcement).

**Measurement that speaks SR5**

- **FR9.8** Ruler: click-drag measurement in meters along the grid; from a token, movement display shows walk/run thresholds from the sheet (AGI×2 / AGI×4 m per turn, engine-derived, overridable) and colors the path as it crosses them. Movement is informative, never enforced (Principle 2).
- **FR9.9** Range bands: measuring from a shooter with a weapon selected overlays that weapon's short/medium/long/extreme bands (from the user-entered range table for its category) and offers the corresponding range modifier directly into the attack roll.
- **FR9.10** Encounter integration: launch an encounter from a scene and every linked token becomes a combatant (and vice versa: staging an encounter places its tokens). The acting token glows; targeting from the copilot (FR10.8) picks up the on-map target.
- **FR9.11** Scene environment: per-scene light/visibility/glare/wind settings following the SR5 environmental table (composed per RAW, editable) become a situational modifier source injected into rolls made while the scene is active — visible in every pool's provenance, removable per-roll. The scene's darkness is why the shot was −3, and the roll log says so.
- **FR9.12** AoE templates: circles (spell radius = Force in meters, or hand-set), blast templates for grenades with a **scatter helper** (direction die + scatter dice per launcher type, reduced by net hits, per the table's RAW — editable), placed on the map for everyone to argue about, as is tradition.

**Fog and reveals**

- **FR9.13** Fog of war, manual-first: GM paints revealed/hidden regions (polygon and brush); fog state is authoritative on the server and persists per scene. Players see revealed areas only; the GM sees everything with fog as a tint. Manual fog is the P2 ship; automated vision comes later (FR9.16).
- **FR9.14** Staged reveals: named fog regions ("east wing", "the lab") revealed one click at a time, with an optional log/scene announcement — the map version of the handout reveal.

**Table feel**

- **FR9.15** Pings (tap — flash for everyone), pointer trails, temporary freehand drawings that fade or clear; GM "focus here" pulls everyone's viewport once (players can pan freely otherwise).

**The table display (the big TV)**

- **FR9.19** Any screen at the table (the TV's browser, a streaming stick, an HDMI-connected tab) joins via a GM QR as a **`display` device**: a kiosk view with zero controls that receives *only player-visible data* — the same server-side filtering as any player socket (Principle 4), which matters because everyone can see it.
- **FR9.20** What it shows: the active scene from the players' perspective (fog applied, hidden tokens absent) with the initiative ribbon and acting-combatant highlight; big-format moments — dice results the GM flags, full-screen handout takeovers, staged reveals animating in. Between scenes: an idle card (campaign name, in-game date).
- **FR9.21** GM steering: the "focus here" gesture (FR9.15) drives the TV camera; per-layer toggles (hide the initiative ribbon during pure roleplay); a one-tap "blank the table" button. *(P1 ships a tracker + roll-feed TV view before maps exist; P2 upgrades it to the full scene display.)*

**Advanced sight (Phase 6, gated behind real demand)**

- **FR9.16** Wall-based token vision and dynamic lighting: walls from FR9.2 block sight lines; vision modes per token (normal, low-light, thermographic — from metatype/'ware, engine-derived) alter what each player's view reveals; light sources on the map. This is the single most expensive VTT feature (R9) and manual fog must remain a first-class permanent alternative, not a deprecated stopgap.
- **FR9.17** Matrix overlay (stretch): an AR/VR restyle of the active scene for deckers — host icons, personas, spotted marks — same geometry, different skin. Flavor, not a second map engine.
- **FR9.23** Security cameras: the GM mounts a camera (a point, a facing, a field of view, a reach) and the canvas draws the cone of cells it actually covers, cut by the same walls and tiles a token's sightline is cut by; "look through it" shows the map the camera's way. GM-only end to end — a player socket never receives a camera (Principle 4), because a camera a player can see is one their character has already found. The first piece of FR9.16's vision system to ship, on the same engine; the plan for the rest is `docs/VISION.md`.
- **FR9.24** Doors players can open: a player clicks a door — traced or painted — and it opens or shuts from their own screen, no asking; the GM locks and unlocks any door, and a locked one refuses a player by name ("that door is locked"). Which doors are locked never reaches a player payload; a runner learns it by trying the handle. An open door, painted or traced, does not cut a sightline (FR9.16) and draws open — the way through in elevation, the leaf standing out in plan. The one scene write a player may make, on its own route (`POST /api/scenes/:id/doors`).
- **FR9.25** GM notes: a box of text pinned to a point on the map — "the guard is asleep until someone shoots", "sniper on the roof after round 3" — for the GM alone. Not a pin with a privacy setting: a player's scene carries no notes at all (Principle 4), and a player's stage draws none even if handed one.
- **FR9.26** Token layers: a named set of tokens behind one switch, orthogonal to floors (FR9.22). Hide the layer to prep an ambush; show it and the tokens ARRIVE on player screens (as `token.added`, exactly as a reveal does). A token on a hidden layer is off the players' table whatever its own `hidden` flag says, and out of the tracker until the layer shows; the layers themselves — names, membership — never reach a player.
- **FR9.18** ~~Per-scene ambient audio loop (stretch, waits for demand)~~ **Superseded 0.7:** ambient audio arrived as an AI feature — the Fixer's stagecraft (FR12.10) tags the GM's music library and matches scenes to tracks. This FR folds into it.

### M10 — The Opposition Kit: NPC generator, encounter planner, combat copilot *(Phase 3)*

The GM's force multiplier: build opposition in minutes, balance it against the real party, then run it one-handed. `[D10]`

**Generation**

- **FR10.1** Archetype templates, GM-authored (and shareable as codex entries): role tags (muscle, face, mage, adept, decker, rigger, sniper…), a tier dial (e.g. street / seasoned / pro / elite / prime — labels editable), and per-tier parameter ranges: attributes, key skill pools, Professional Rating, metatype weights, gear/armor/weapon loadout slots referencing the GM's own entered gear records, optional spell/'ware picks. Templates are data, not book stat blocks (§14).
- **FR10.2** Generate one NPC or a whole grunt group from template + tier: attributes and skills rolled within ranges, loadout filled, name and one-line quirk/appearance/motivation drawn from editable flavor tables (shipped defaults are our own original writing), all derived values (limits, initiative, monitors, defense and soak pools) computed by the rules engine so the output is playable immediately. Generation is seeded: reroll the whole squad identically, or lock fields (keep the stats, reroll the names).
- **FR10.3** Output lands as a ready combatant/grunt group and can be promoted to a reusable codex NPC template with one click; edits round-trip.

**Encounter planning**

- **FR10.4** Encounter builder: compose generated NPCs, saved templates, grunt groups, spirits, and a Matrix host (M7) into a named encounter, linked to a run and a scene; one click stages its tokens on the map (FR9.10).
- **FR10.5** Party-aware threat readout — the feature only an integrated tool can do: because the PCs' live sheets are in the system, the planner shows the math both ways: opposition attack pools vs. each PC's defense (and vice versa), expected net hits and boxes per exchange (hits ≈ pool ÷ 3 heuristics, shown, not hidden), soak differentials, initiative and action-economy comparison (bodies × passes per side). Example readout: *attack 12 vs. Static's defense 9 → ~1 net hit → DV 8P+1 vs. soak 15 → ~4 boxes per connect.* Clearly labeled estimates the GM tunes — SR5 has no CR, and we don't pretend otherwise (Principle 3, R10).
- **FR10.6** Balance levers surfaced beside the readout: tier dial, squad size, Professional Rating, gear tweaks — adjust and the readout recomputes live.

**Combat copilot**

- **FR10.7** Quick-roll rack on every generator-backed combatant row (tracker and token context menu): attack per weapon (mode and recoil aware), defense (REA+INT, +Full Defense variant), soak (BOD + armor − AP), composure, perception, and the template's key skills — one tap each, results into the log with opposed-roll linking, honoring scene modifiers (FR9.11) and wound state automatically.
- **FR10.8** Resolved chains: when a PC attacks a copilot-backed NPC (or the reverse), one click walks the full SR5 exchange — defense roll → net hits → modified DV → soak → boxes to the right monitor → wound modifiers propagate (FR4.5). Every step renders as a card the GM can override before committing (Principle 2).
- **FR10.9** Morale: configurable triggers (first casualty, leader down, half strength) prompt a Professional-Rating-based morale suggestion — fight on, fall back, cut and run — per the grunt rules; the GM decides, the log records.
- **FR10.10** Tactical hints, optional and off by default: role-tag-driven one-liners on the acting NPC's turn ("sniper: hold position, target the biggest threat"; "ganger: mob the closest"). Flavor assist to reduce GM decision fatigue — never automation; no hint ever acts by itself.

### M11 — Rules library and deep references *(Phase 1)*

The table owns every 5e book as a PDF (they're sitting in this folder now: the core rulebook plus Run & Gun, Street Grimoire, Data Trails, Chrome Flesh, Rigger 5.0, Kill Code, Run Faster, Howling Shadows, Street Lethal, Forbidden Arcana, Dark Terrors, Stolen Souls, Market Panic, Serrated Edge, The Complete Trog, and Seattle Sprawl). The app turns that library into infrastructure. `[D11]`

- **FR11.1** Book registry: each PDF is registered with a short code (`SR5`, `RG`, `SG`, `DT`, `CF`, `R5`, `KC`, `RF`, …), a title, and a **page offset** mapping printed page → PDF page (front matter shifts them; the core rulebook's offset is +5 — measured, not guessed). A calibration helper: type a printed page number, nudge until the displayed page matches, offset saved.
- **FR11.2** Structured refs: everywhere the app stores a `ref` it is `{ book, page, note? }` — sheet items, qualities, spells, gear, archetype templates, interrupt-action lists, house-rule flags. Freetext ("SR5 p.426") is tolerated and parsed into structure where possible.
- **FR11.3** One-tap open: every ref renders as a chip; tapping opens the book **right there** — an in-app PDF viewer (self-hosted pdf.js) as an overlay/side panel at the correct printed page (offset applied automatically), without losing table context. Works on phones. Fallback: a direct authenticated file URL with `#page=`.
- **FR11.4** Ref autolinking: codex Markdown and log notes recognize `SR5 p.426`-style patterns and render them as ref chips automatically; the doc convention and the app convention are the same.
- **FR11.5** Access control: **the library is shared with the table** — all campaign members can open refs and read in-app (decided 0.4, Q12), with a per-book GM-only toggle held in reserve for anything the GM wants back-pocketed. These are the owner's copies on the owner's server; sharing with the table is the owner's call, and the owner has made it (§14.8). Files served behind auth like every attachment.
- **FR11.6** Bookmarks: named per-book bookmarks ("grenade scatter", "called shots") for the rules the table argues about most, pinned to the GM screen; a "recently opened refs" trail during sessions.
- **FR11.7** Seeding: a one-shot import (`pnpm seed:books`) registers a folder of PDFs into the file store with guessed codes for the GM to confirm — so the library that's already sitting next to this document becomes the app's library with one command. The PDFs never enter git (§16).

### M12 — The Fixer: the AI copilot *(assistant core Phase 1; tool belt grows every phase — see §18)*

Every runner team has a fixer — the one who knows everyone, finds anything, and sets up the job. This one belongs to the GM. `[D12]` `[D13]` The Fixer is a persistent, GM-only chat panel available on every screen, backed by an agentic loop with typed tools over the app's own data (books, codex, sheets, scenes, generator). All output obeys Principle 8: drafts with provenance, GM-approved before anything reaches the table.

**Assistant core** *(Phase 1)*

- **FR12.1** The panel: a dockable GM-only chat, streaming, conversation history per campaign, invokable from anywhere ("ask the Fixer" on any entity). Two configured model slots: **primary** (the biggest instruct model the hardware runs comfortably — conversations, fiction, rules synthesis) and **fast** (a small model for mechanical tasks); per-feature assignment (§16).
- **FR12.2** Rules research, grounded: questions answered from the GM's own PDF library (M11) via retrieval over the extracted book text. **Citations come from the retrieval layer, not the model's memory**: the server knows exactly which book + printed page each retrieved passage came from, passes that provenance through, and renders every source as a tappable M11 ref chip — so the chips are always real pages even if the model garbles a reference. Answers quote sparingly; the Fixer's rules answers are adjudication *support*; the GM's call is the call.
- **FR12.3** Lore and state research: search and synthesis over the campaign codex, session logs, ledgers, calendar, **and the live game state via the FR12.17 tool catalog** — "what does the team know about Renraku?", "who still owes whom?", "who's hurt worst right now?", "which NPCs has the party actually met?". The Fixer sees GM-only content because only the GM can talk to it.
- **FR12.4** Planning and brainstorming: run outlines, complications, Johnson motives, "what would the yakuza do next?" — with one-tap "save to codex" landing results as draft wiki pages or draft runs (FR12.15).

**Content generation** *(Phase 3, with M10)*

- **FR12.5** NPC fiction layer: on top of M10's procedural stats, the Fixer writes the person — personality, backstory, voice and mannerisms, motivations, secrets, plot hooks, and **ties into existing codex lore** (it reads the campaign before inventing). Output lands in the NPC's persona sheet (§9). The split is hard `[D13]`: the engine rolls the numbers, the AI writes the fiction — generated stats are always rules-valid and never hallucinated.
- **FR12.6** In-character conversations: the GM opens "speak as ⟨NPC⟩" and the Fixer plays them — honoring the persona sheet, a knowledge boundary (what this NPC actually knows), and a secrets list (what they won't reveal, and under what pressure they might). The knowledge boundary is grounded in real state (FR12.17): the NPC's prior appearances, what happened in those sessions, and their codex relationships — so the bartender remembers the team stiffing him, and the Johnson doesn't know things he wasn't there for. The GM relays lines aloud, edits them, or pushes a chosen line to the session log/TV. Transcripts save to the NPC's page. Players never talk to the AI directly — the GM is always the mouth (NG7).
- **FR12.7** Codex drafting: expand a stub into a full location/faction/NPC page; summarize a wall of session log into tight lore; propose backlinks.

**At the table** *(Phases 2–4)*

- **FR12.8** Fog & scene aid *(P2)*: natural-language fog commands ("reveal the lobby and the east corridor"); proximity prompts when tokens reach an unrevealed named region ("they're at the lab door — reveal?"); auto-naming of fog regions from map analysis (FR12.11).
- **FR12.9** Token identification *(P2)*: auto-label tokens from context (grunt numbering, NPC matching), one-line "who's this?" descriptions on hover, and disambiguation help mid-fight ("the wounded ganger by the door is #3"). Token *art* generation waits on the optional image adapter (P6).
- **FR12.10** Stagecraft *(P5)*: the GM points the app at a local music folder; the Fixer tags tracks by mood/tempo/genre once, then matches scenes to tracks — activate a scene tagged "corp lobby, tense" and it cues something right, with a one-tap skip and a player-side mute. *(This revives ambient audio: FR9.18's "wait for demand" is superseded — the demand arrived as an AI feature.)*
- **FR12.11** Map assistance *(P2 basic, grows through P3)*: two lanes. **Layout copilot** — prompt to grid-true structured geometry ("two-story Renraku branch: lobby, security checkpoint, server room, exec floor") generating rooms/walls/doors snapped to the 1 m grid as an editable GM-layer draft, never a finished image — local inference is actually *strong* here, since llama.cpp grammars / vLLM guided JSON can hard-constrain output to our geometry schema. **Map vision** — upload any map image and the Fixer proposes grid alignment, wall/door geometry, and named fog regions for one-tap acceptance (feeding FR9.2/FR9.13) — *capability-flagged: requires running a vision-capable local model; the feature hides otherwise.* Full map-image *generation* waits on the image adapter (P6).
- **FR12.12** Recap drafts *(P4)*: end a session and the Fixer drafts the recap from the session log — headline rolls, downed combatants, karma awarded, cliffhanger — for the GM to edit and publish to Discord (FR6.3).

**Plumbing**

- **FR12.13** Provider: **local models behind an OpenAI-compatible API** — llama.cpp (`llama-server`) or vLLM `[D12]`. The app speaks plain OpenAI-compatible chat completions (tool calling + JSON-schema/grammar-constrained output where supported) to `LLM_BASE_URL`; model slots via `LLM_MODEL_PRIMARY` / `LLM_MODEL_FAST`. **The default posture (decided 0.8): a dedicated inference box on the table's LAN serves the models — the laptop stays free to run the session.** The compose file still ships an optional `llm` profile (llama.cpp, multi-arch) as the fallback for venues without the box. Unset/unreachable base URL → every AI entry point hides (NG7). **Nothing about the Fixer ever touches the internet.**
- **FR12.14** Retrieval: at book-seed time (FR11.7) per-page text is extracted into Postgres with a full-text index; rules queries retrieve candidate pages, inject them into the prompt as tagged context, and the retrieval provenance (book, printed page) renders as M11 ref chips regardless of what the model writes (FR12.2). Codex retrieval works the same over wiki/log text. Plain Postgres FTS first; vector search only if FTS proves insufficient `[D14]`. Retrieval quality carries extra weight with local models — the context we hand the model *is* most of the answer.
- **FR12.15** Drafts and provenance: every generation is an `ai_generation` record (kind, prompt, model, output, status draft/accepted/rejected) targeted at an entity; accepting applies it and marks the entity AI-assisted in metadata; nothing auto-applies. A visible per-campaign usage/cost meter keeps spend honest (§15).
- **FR12.16** Resource discipline (there is no per-token bill; the budget is the laptop): the **fast** slot (small quantized model) handles mechanical tasks — music tagging, token labeling, region naming — and is the default *during live sessions* so inference never starves the table (R11); the **primary** slot does prep-time fiction and conversations. Prefix caching (llama.cpp slot cache / vLLM prefix cache) keeps the Fixer's campaign context cheap to re-send; the usage meter reports tokens and latency instead of dollars.

**Campaign-state awareness** *(core tools P1; the catalog grows as each module lands)*

The Fixer is only as useful as what it can see. Its grounding contract:

- **FR12.17** A **read-only state tool catalog** spanning everything the GM can see, served by the same Zod-typed service layer as the app itself (§7) — never raw table rows, but the **engine-derived view the table actually plays with** (pools with provenance, current monitors, wound modifiers applied), queried **live at call time**: mid-combat, "who's hurt worst?" reflects this pass, not last save. Reads are free and unlogged-to-players; every *write* still lands as a draft (Principle 8).

| Tool | Returns | From |
|---|---|---|
| `get_campaign` | settings, house-rule flags, in-game date, active session + scene | P1 |
| `list_characters` / `get_character` | full derived sheet: attributes, pools (with provenance), limits, monitors + wounds, current Edge, ammo/recoil, sustained spells; karma/nuyen balances | P1 |
| `get_ledger` | karma/nuyen history with reasons and session links | P1 |
| `get_encounter` | combatants, initiative order + current pass, acting combatant, monitors, status effects, grunt/PR state | P1 |
| `get_session_log` | recent rolls, damage, reveals, table-talk, scene markers | P1 |
| `search_books` / `search_codex` / `get_page` | rules retrieval with page provenance; lore pages incl. GM-only content | P1 / P4 |
| `get_scene` | active scene: environment modifiers, tokens + positions + hidden flags, revealed fog regions, pins | P2 |
| `list_npcs` / `get_npc` | stat block + persona sheet (traits, goals, secrets, knowledge boundary) + appearances and codex links | P3 |
| `get_threat_readout` | the planner's math for an encounter vs. the live party (FR10.5) | P3 |
| `list_contacts` | per-character contacts: Connection, Loyalty, favors owed/owing | P4 |
| `list_runs` / `get_run` | status, objectives, opposition links, payout, awards | P4 |
| `get_calendar` | in-game timeline, lifestyle due dates, upcoming beats | P4 |
| `get_magic_state` / `get_matrix_state` | spirits + services, sustained spells, foci; OS scores, marks | P5 / P6 |

- **FR12.18** **Situation snapshot:** during live sessions, Fixer conversations are automatically prefixed with a compact, cache-friendly snapshot — active scene + environment, encounter one-liner (turn, pass, who's up), and a party status line (monitors, Edge, notable conditions) — so the common questions ("can Static take another hit?", "whose turn after the spirit?") answer instantly without a tool round-trip; anything deeper, the model reaches for the catalog.
- **FR12.19** **Spoiler guard:** when a draft targets a player-facing surface (recap, revealed page, a line pushed to the TV/log), the Fixer flags any GM-only fact it drew on — "this mentions the hidden sniper and the Johnson's real employer — reveal or cut?" — because it can see everything, and players mustn't, until the GM says so (Principle 4 applied to prose).

### M5 — Campaign codex *(Phase 4)*

- **FR5.1** Wiki pages with Markdown, tags, and typed kinds: NPC, faction, location, run, item, generic lore. Kinds add light structure (an NPC page has an optional stat block section and portrait; a run page has the fields in FR5.5) but stay free-form underneath.
- **FR5.2** Visibility per page *and per section*: GM-only, shared, or per-player. GM-only content is server-filtered (Principle 4). One-click "reveal" flips a section/page to shared and announces it in the session log.
- **FR5.3** `[[Wiki-links]]` between pages with backlinks; unresolved links render as create-prompts. Map pins link here (FR9.3).
- **FR5.4** Handouts: uploaded images/PDFs attached to pages or sessions, staged privately, revealed live.
- **FR5.5** Runs: Johnson, hook, objectives, opposition links (encounters from FR10.4), agreed payout, actual outcome, karma/nuyen awards (which post to ledgers when the GM confirms), and an after-action recap.
- **FR5.6** NPC/grunt stat templates and archetype templates live in the codex (user-entered, page-referenced — never shipped) and are the source for M4 combatants, M10 generation, and M7 hosts.
- **FR5.7** In-game calendar: current date advanced by the GM; sessions, runs, lifestyle rent due-dates, and timeline events pinned to in-game dates. (Sixth World dates, e.g. campaign opens 2076-05-12.)
- **FR5.8** Contacts per character: name, archetype, Connection, Loyalty, notes, favors owed/owing; shared-with-GM by default; linkable to codex NPC pages.

### M6 — Sessions *(Phase 4)*

- **FR6.1** A session entity: real-world date, attendance, linked run(s), the session log (from M2), GM prep notes (private) and shared recap.
- **FR6.2** "Start session" puts the campaign in live mode (presence indicators, log recording, encounter launching, scene following); "end session" closes the log and prompts the award/recap flow.
- **FR6.3** Recap publishing: shared recap + headline events (big rolls, downed combatants, karma awards) formatted and posted to Discord via webhook, on explicit GM action. With the app offline to players between sessions, **the recap is their only between-session window into the campaign** — this feature carries more weight than its size suggests.

### M7 — Matrix toolkit *(Phase 6, on demand — no decker in the party)*

With no decker or technomancer at the table (Q3, 0.6), this module waits: the GM runs the occasional NPC host by hand (or with an M4 encounter and free-form rolls) until a Matrix-focused character joins the campaign. The design stays in the doc so it's ready when that day comes.

- **FR7.1** Host builder: rating, ASDF array, configured IC roster, notes; saved as codex templates; attachable to encounters (FR10.4).
- **FR7.2** Live host runner: launch IC one per host action phase, host initiative tracked in the M4 tracker (Matrix combatants mix with meat ones in the same encounter).
- **FR7.3** Overwatch Score tracker per persona: manual increments, "add defender's hits" shortcut from linked opposed rolls, elapsed-time accrual timer per table rules — all adjustable; loud warning approaching 40, convergence flagged at 40.
- **FR7.4** Marks bookkeeping: who has how many marks on what; actions can note their mark requirement.
- **FR7.5** Noise calculator (distance/spam-zone modifiers, editable table) applied as a modifier source for Matrix pools.
- **FR7.6** Technomancer support at parity where cheap (Resonance in place of gear stats, complex forms as roll entries, sprite tracking mirroring spirit tracking in M8). Deep dives (compiling tasks etc.) stay manual-entry.

### M8 — Magic toolkit *(Phase 5 — leads the deep-rules phase: the party runs a mage/shaman and an adept)*

- **FR8.1** Casting flow from the sheet: pick spell (user-entered), choose Force (limit = Force), roll, then a linked Drain resistance roll — Drain value from the spell's user-entered drain code (min 2), soaked with the tradition's attributes; unresisted Drain is Stun unless Force exceeds Magic, then Physical. Applied to the caster's monitor on confirm.
- **FR8.2** Sustained spells tracked with automatic −2 per spell on the caster's pools, exempting those sustained by foci or quickening (toggles). Sustained AoE spells can show as token auras (FR9.6).
- **FR8.3** Spirit tracker: bound/unbound spirits with Force, services countdown, and one-tap "spend service"; spirits join encounters as combatants and tokens.
- **FR8.4** Foci bookkeeping (bonded foci, active toggles injecting their modifiers) and reagent counters.
- **FR8.5** Adept powers render as passive/toggled modifier sources on the sheet.

---

## 7. System architecture

### 7.1 Shape

A deliberately boring three-piece system, sized for ~10 concurrent users and one server:

```
┌────────────────────┐   HTTPS (REST + static)   ┌──────────────────────────┐
│  Browser SPA        │◄─────────────────────────►│  API server (Node/TS)     │
│  React, phone-first │   WebSocket:              │  Fastify + ws             │
│  ├─ sheet/log/track │    persisted events +     │  ├─ REST for CRUD         │
│  └─ the Grid        │    ephemeral channel      │  ├─ WS hub: rooms, replay,│
│     (PixiJS canvas) │◄─────────────────────────►│  │   visibility filter,   │
└────────────────────┘                            │  │   ephemeral relay      │
        ▲                                         │  ├─ rules engine (shared) │
        │ served by                               │  ├─ dice service (CSPRNG) │
        └─────────────────────────────────────────┤  ├─ NPC generator         │
                                                  │  └─ Fixer AI service ─────┼──► local LLM
                                                  │     (agent loop · RAG ·   │    llama.cpp / vLLM
                                                  │      drafts · usage meter)│    (OpenAI-compat,
                                                  └─────┬──────────┬─────────┘     on laptop or LAN)
                                                        │          │
                                                  ┌─────▼────┐ ┌───▼──────────┐
                                                  │ Postgres  │ │ File storage │
                                                  │ (JSONB +  │ │ maps·handouts│
                                                  │  book FTS)│ │ tokens·audio │
                                                  └───────────┘ └──────────────┘
                                                        │
                                     the ONLY      ┌────▼──────────────────────┐
                                     outbound ─────│ Discord (recap webhook)   │
                                                   └───────────────────────────┘
```

- **One deployable:** the server serves the built SPA statically in production. Docker Compose runs `app` + `postgres` + a backup cron — no reverse proxy on the LAN (§8), and every image is multi-arch (amd64/arm64) so the host laptop's architecture doesn't matter. `[D3]` `[D8]`
- **Server-authoritative state:** dice are rolled server-side; combat, scene, token, and fog state mutate through server commands; clients render events. No client is ever trusted with hidden data or RNG (Principles 4–5, G5).
- **Two event classes on one socket** (§11): *persisted* events (the replayable campaign log) and *ephemeral* events (token-drag interim positions, pings, pointer trails — relayed, throttled, never stored).
- **The Grid client is a PixiJS (WebGL) canvas** `[D9]` inside the React shell, lazy-loaded so non-map views stay light. Layered stage: map images → grid → zones/walls → tokens → templates/drawings → fog → GM overlay. Fog geometry and token positions are server state; rendering is the client's job.
- **No horizontal scaling, by design:** one Node process, in-process pub/sub. Redis, queues, and clustering are complexity we will never need at this scale.
- **The Fixer runs server-side** as an agentic loop against a **local OpenAI-compatible LLM** (llama.cpp or vLLM, `[D12]`), with tools that are the app's own services, typed with the same Zod schemas as everything else in `contracts` — the full read-only state catalog of FR12.17 (`get_character`, `get_encounter`, `get_scene`, `get_npc`, `search_books`, …) plus draft-producing actions (`generate_npc`, `propose_geometry`, `draft_wiki_page`, `suggest_fog_reveal`, `tag_track`) — using OpenAI-style function calling, with grammar/JSON-schema constrained output for structured drafts. Streaming relays to the GM's panel over the existing WS. **Inference never leaves the laptop (or the LAN box the GM points it at)** — the Discord webhook remains the only outbound traffic in the whole system, and the app runs fully without the LLM (NG7).

### 7.2 The load-bearing decision: a pure, shared rules engine `[D4]`

All SR5 math lives in **`packages/rules`** — pure TypeScript functions with zero I/O and zero dependencies on the server or the DOM:

```
(sheet JSON, campaign house-rule flags, situational state) ──► derived character
(roll request, RNG stream) ──────────────────────────────────► resolved roll
(damage event, combatant state) ─────────────────────────────► new combatant state
(archetype template, tier, RNG stream) ──────────────────────► generated NPC      (M10)
(scene environment, distance, weapon ranges) ────────────────► situational modifiers (M9)
```

Why this shape:

- **Shared:** the browser uses it for instant pool previews and provenance tooltips; the server uses the *same code* to authoritatively resolve rolls. No drift between what the player saw and what the server rolled.
- **Testable:** pure functions make the scary part (SR5 correctness) the most testable part (§17).
- **Override-friendly:** the engine's output is always "computed value + provenance"; overrides are inputs layered on top, not patches to the engine.
- **Reused everywhere:** the NPC generator validates its output through the same derivation (a generated NPC is just a sheet), and the Grid's range/environment math produces ordinary `Modifier`s — new features keep landing on the same spine.

The engine's core abstraction is the **modifier pipeline**. Everything that changes a number — cyberware, adept powers, wounds, sustained spells, status effects, scene environment, range bands, GM fiat — is a `Modifier`:

```ts
interface Modifier {
  id: string;
  source: { kind: 'cyberware'|'quality'|'power'|'spell'|'wound'|'status'
                 |'scene'|'range'|'situational'|'override'; ref?: string };
  target: ModifierTarget;      // e.g. 'attr.REA', 'initiative.dice', 'limit.physical',
                               //      'pool.skill.perception', 'pool.all'
  op: 'add' | 'set' | 'cap';
  value: number;
  active: boolean;             // toggled by gear state, sustaining, scene, etc.
  note?: string;
}
```

Derivation applies modifiers in a fixed order (base → augmentation → magic → temporary/status → wounds → scene/range/situational → override) and records each contribution, so every derived value carries its receipt. That receipt powers the provenance UI (Principle 3) and makes bug reports trivially diagnosable.

### 7.3 Monorepo layout

```
safehouse/
├─ apps/
│  ├─ web/        # React SPA (Vite); the Grid is a lazy-loaded PixiJS chunk
│  └─ server/     # Fastify + ws, serves web build in prod
├─ packages/
│  ├─ rules/      # pure SR5 engine incl. generator + environment math
│  ├─ contracts/  # Zod schemas: API DTOs, WS commands/events, sheet & scene schemas
│  └─ db/         # Drizzle schema + migrations
├─ compose.yaml   # the stack, at the root so it reads the one .env
├─ infra/         # Dockerfile, backup scripts
└─ docs/          # this document, ADRs, screenshots
```

`contracts` is the boundary language: the server validates every input against it, the client gets full type inference from it, and the sheet/scene JSON schemas are versioned in it (§9.3).

---

## 8. Technology choices `[D2]`

| Layer | Choice | Rationale | Considered |
|---|---|---|---|
| Language | **TypeScript everywhere** | One language across client/server/rules engine — the shared engine (§7.2) is the whole argument; JSON-native; excellent AI-assisted-dev ergonomics | C#/.NET or Go backend (splits the rules engine or duplicates it — dealbreaker) |
| Frontend | **React 18 + Vite** | Boring, huge ecosystem, fine on phones as an SPA | SvelteKit (fine choice, smaller ecosystem for our UI needs) |
| Map canvas | **PixiJS (WebGL)** `[D9]` | The proven VTT rendering choice (Foundry runs on it): sprite batching for tokens, mask-based fog, smooth pan/zoom on modest hardware; lazy-loaded chunk | Konva/Canvas2D (simpler, but fog + many tokens + lighting later favors WebGL); Three.js (3D we'll never use) |
| UI kit | **Tailwind + shadcn/ui** | Fast to build a dense, dark, cyberpunk-friendly UI that still does light mode | MUI (heavier, harder to theme) |
| Client data | **TanStack Query + Router**, Zustand for session/live state | Query for CRUD caching; a small store for WS-fed live state (tracker, scene, tokens) | Redux (overkill) |
| Server | **Fastify + `ws`** | Minimal, fast, first-class TS; we own the WS hub — rooms, replay, filtering, ephemeral relay are a few hundred lines (§11) | NestJS (ceremony), Socket.IO (features we don't need), tRPC (nice, but REST+Zod is plainer to debug) |
| Database | **PostgreSQL 16 + Drizzle ORM** | JSONB for sheets/templates/scenes + real relational integrity for ledgers/rolls/membership; Drizzle for typed schema & migrations | SQLite+Litestream (viable, but JSONB querying and concurrent WS writes are nicer on PG); MongoDB (ledgers want SQL) |
| Images | **sharp** on upload | Re-encode uploads, strip metadata, generate downscaled map/token variants (§15 caps) | — |
| PDF viewer | **pdf.js**, self-hosted | Deep-linked rulebook pages in-app (M11), consistent on phones, behind our auth — no external viewer, no CDN | Browser-native viewer via `#page=` (kept as fallback; inconsistent on mobile) |
| AI | **Local models via an OpenAI-compatible API** — llama.cpp (`llama-server`, default: multi-arch, CPU/GPU) or vLLM (if the host has a proper NVIDIA GPU) `[D12]`; two model slots (primary/fast); tool calling + grammar/JSON-schema constrained output | Zero data leaves the machine, zero per-token cost, works with no internet — the purest fit for the LAN posture; retrieval-derived citations (FR12.2) keep rules answers verifiable regardless of model quality | Anthropic/OpenAI cloud APIs (stronger models, but reintroduce outbound data flow, per-session cost, and an internet dependency — revisit only if local quality disappoints); Ollama (fine too, same OpenAI-compat surface — llama.cpp/vLLM preferred for grammar control and serving features) |
| Retrieval | **Postgres full-text search** over extracted book pages + codex `[D14]` | One database, zero new infra, good enough for 17 books + a campaign wiki | pgvector + embeddings (upgrade path if FTS recall disappoints) |
| Image generation | **Optional adapter slot, P6** | Map art and token portraits are nice-to-have; no provider commitment yet — layout copilot and map vision don't need it | — |
| Auth | **QR-code join links → long-lived per-device tokens** (GM account owns the campaign; TV joins as a kiosk display device); roles enforced server-side; no passwords `[D7 rev.]` | Works with zero public callback URL — the app never leaves the LAN; sign-in friction at the table is one camera scan | Discord OAuth (needs a public redirect URL — dropped with laptop hosting; the outbound recap webhook stays), magic-link email (needs deliverability the LAN posture doesn't) |
| Files | Local disk volume; S3-compatible optional | Maps, handouts, token art, audio for one group — tens of GB at most | — |
| TLS/proxy | **None — plain HTTP on the table's Wi-Fi**; the app serves everything on one port | LAN-only with no public domain means no ACME; skipping TLS keeps player phones and the TV friction-free (no cert warnings). PWA features (P6) would need localhost or a local cert — decide then | Caddy with internal CA (per-device cert trust for 7 people — only worth it if hosting ever leaves the laptop) |
| Deploy | **Docker Compose on the GM's laptop** (decided 0.5) `[D3]` `[D8]` — images built **multi-arch (linux/amd64 + linux/arm64)** via buildx so the host's architecture doesn't matter; LAN-only during sessions, localhost between them; no remote access needed (players don't touch it between sessions) | €0/mo, one-command up, the whole campaign travels with the laptop | VPS (~€5–10/mo) — the fallback if always-on hosting is ever wanted |
| Testing | **Vitest** (unit/property), **Playwright** (e2e) | §17 | — |
| CI | **GitHub Actions**: typecheck, lint, unit, e2e-smoke on PR | Keep main deployable | — |

---

## 9. Data model

### 9.1 Entity overview

```
users ─┬─ memberships ─── campaigns ──┬─ invites
       │                              ├─ game_sessions ─── (log = ws_events slice)
       └─ characters ◄────────────────┤
             │  ├─ sheet (JSONB)      ├─ scenes ──┬─ tokens
             │  ├─ character_revisions│           ├─ drawings (sketches/templates)
             │  ├─ ledger_entries     │           └─ fog state (in scene JSONB)
             │  └─ contacts           ├─ encounters ─── combatants ──(token_id?)
             │                        ├─ rolls
             │                        ├─ wiki_pages ─── wiki_revisions
             │                        ├─ attachments (maps, handouts, tokens, audio)
             │                        ├─ npc_templates (incl. gen params) / grunt_groups
             │                        ├─ roll_tables (names, quirks, loot, custom)
             │                        ├─ matrix_hosts
             │                        ├─ runs
             │                        └─ ws_events (event log, pruned)
```

### 9.2 Tables (abridged; authoritative version lives in `packages/db`)

| Table | Key fields | Notes |
|---|---|---|
| `users` | id, email, discord_id, display_name | PII is email at most (G7, §13) |
| `campaigns` | id, name, gm_user_id, settings JSONB, ingame_date | settings = house-rule flags, webhook URL |
| `memberships` | campaign_id, user_id, role (`gm`\|`player`\|`observer`) | |
| `characters` | id, campaign_id, owner_user_id, name, status, **sheet JSONB**, sheet_version, chummer_blob | sheet is the live snapshot; raw import kept |
| `character_revisions` | character_id, seq, sheet JSONB, cause, created_by | every accepted mutation (FR3.8) |
| `ledger_entries` | id, character_id, currency (`karma`\|`nuyen`), delta, reason, state (`pending`\|`approved`\|`rejected`), session_id?, run_id?, created_by, approved_by | append-only; balances are sums (FR3.6) |
| `rolls` | id, campaign_id, session_id?, actor, kind, request JSONB (pool breakdown/provenance), faces int[], hits, ones, glitch, limit?, limited_hits, edge_action?, opposed_link?, visibility, created_at | immutable (G5) |
| `scenes` | id, campaign_id, name, state (`draft`\|`active`\|`archived`), grid JSONB (unit m, size, offset), environment JSONB (light/visibility/glare/wind per FR9.11), geometry JSONB (walls/zones/doors/pins), fog JSONB (named regions + revealed set), audio_ref? | environment feeds the engine as `scene` modifiers |
| `tokens` | id, scene_id, source (`character`\|`combatant`\|`npc_template`\|`prop`), source_id?, name, x, y, size, rotation, art_ref, hidden, bars_visibility, aura JSONB? | positions in grid units; hidden tokens filtered server-side (FR9.7) |
| `drawings` | id, scene_id, kind (`sketch`\|`template`), geometry JSONB, created_by, expires_at? | pings/pointer trails are ephemeral, never stored |
| `encounters` | id, campaign_id, scene_id?, name, state (`prep`\|`live`\|`done`), turn, pass | |
| `combatants` | id, encounter_id, token_id?, source, name, init_base, init_score, init_kind, monitors JSONB, effects JSONB, visibility, acted_this_pass, copilot JSONB (quick-roll rack, morale state) | grunt groups keep per-member ticks |
| `npc_templates` | id, campaign_id, name, statblock JSONB, gen JSONB (role tags, tier curves, ranges, loadout slots — FR10.1), persona JSONB (traits, voice, goals, secrets[], knowledge[] — FR12.5/12.6), page_ref | stats user-entered/procedural; persona may be AI-drafted, GM-accepted |
| `grunt_groups` | id, campaign_id, template_id, size, professional_rating, group_edge | |
| `roll_tables` | id, campaign_id?, kind (`names`\|`quirks`\|`motivations`\|`custom`), title, entries JSONB (weighted), visibility | shipped defaults are original writing (FR2.11, FR10.2) |
| `books` | id, campaign_id, code (`SR5`\|`RG`\|…), title, attachment_id, page_offset, shared | the rules library (M11); offset maps printed→PDF page |
| `book_pages` | book_id, printed_page, text, tsv (FTS index) | extracted at seed time; the Fixer's rules-retrieval substrate (FR12.14) |
| `ai_conversations` | id, campaign_id, kind (`fixer`\|`npc`), npc_ref?, messages JSONB, created_at | GM-only; NPC transcripts linkable to codex pages |
| `ai_generations` | id, campaign_id, kind, target (entity ref), prompt, model, output JSONB, status (`draft`\|`accepted`\|`rejected`), usage JSONB | Principle 8's paper trail (FR12.15); usage feeds the cost meter |
| `audio_tracks` | id, campaign_id, attachment_id, title, mood_tags[] | GM's local music library, Fixer-tagged (FR12.10) |
| `wiki_pages` | id, campaign_id, kind, title, content_md, sections JSONB (per-section visibility), tags[], visibility | FR5.1–5.3; `wiki_revisions` mirrors |
| `matrix_hosts` | id, campaign_id, name, rating, asdf JSONB, ic_roster JSONB, notes | |
| `runs` | id, campaign_id, title, johnson_page_id?, state, payout JSONB, awards JSONB, recap_md | FR5.5 |
| `game_sessions` | id, campaign_id, date, attendance[], prep_notes_md (gm), recap_md, state | |
| `contacts` | id, character_id, name, archetype, connection, loyalty, notes, npc_page_id? | |
| `attachments` | id, campaign_id, kind (`map`\|`token`\|`handout`\|`portrait`\|`asset`\|`audio`), path, mime, size, visibility, variants JSONB | sharp-generated downscales for maps/tokens |
| `ws_events` | id (monotonic per campaign), campaign_id, type, payload JSONB, visibility, created_at | replay log (§11); pruned after ~30 days except session logs |
| `devices`, `invites` | device: user_id, role, token hash, label ("Sam's phone", "table TV"), revoked_at | QR-join auth (FR1.1/1.3); revocable per device |

Relational where money/trust lives (ledgers, rolls, membership, token positions), JSONB where the shape is rich and evolving (sheets, scenes, stat blocks, effects). That's the whole philosophy.

### 9.3 The sheet JSON

Versioned (`sheet_version`) with migrations in `packages/contracts`. Skeleton (abridged):

```jsonc
{
  "v": 1,
  "identity": { "alias": "Static", "metatype": "elf", "portraitId": null, "notes": "…" },
  "attributes": { "bod": 3, "agi": 5, "rea": 4, "str": 2, "wil": 4, "log": 6, "int": 4, "cha": 3,
                   "edg": { "max": 4, "current": 3 }, "ess": 4.2, "mag": 0, "res": 0 },
  "skills": [ { "id": "hacking", "rating": 6, "attr": "log", "spec": "Hosts", "group": null } ],
  "qualities": [ { "name": "Codeslinger", "ref": { "book": "SR5", "page": 71 }, "mods": [ /* Modifier[] */ ] } ],
  "augments": [ { "name": "Datajack", "essence": 0.1, "ref": { "book": "SR5", "page": 452 }, "mods": [] } ],
  "weapons":  [ { "name": "Ares Predator V", "skillId": "pistols", "acc": 5, "dv": "8P", "ap": -1,
                   "modes": ["SA"], "rangeCat": "heavy-pistol",
                   "ammo": { "cap": 15, "current": 15 }, "ref": { "book": "SR5", "page": 426 } } ],
  "armor":    [ { "name": "Armor Jacket", "rating": 12, "worn": true, "ref": { "book": "SR5", "page": 437 } } ],
  "spells": [], "powers": [], "complexForms": [],
  "matrix": { "deck": { "name": "…", "asdf": [5,4,4,3], "programs": [] } },
  "gear": [], "lifestyles": [ { "name": "Low", "costPerMonth": 2000, "paidThrough": "2076-06-01" } ],
  "rangeTables": { "heavy-pistol": [5, 20, 40, 60] },
  "overrides": [ /* Modifier[] with source.kind = 'override' */ ]
}
```

Note `ref` fields and user-entered `rangeTables` throughout: page references and owner-entered numbers are how we stay useful without shipping content (G6). Every list is user-entered or Chummer-imported — and every `ref` is one tap from the actual page via M11 (that [Ares Predator V ref](shadowrunfiftheditioncorerulebook_V2.pdf#page=431) opens the core book at printed p.426, offset +5 applied).

---

## 10. Dice service and rules engine details

### 10.1 Roll resolution flow

```
Player taps "Perception" on sheet (active scene: "Warehouse — dim light")
  └► client preview: pool 9 = INT 4 + Perception 3 + Vigilance +2 − wounds 0;
     scene: dim light −1 shown as a removable chip                (rules engine, local)
      └► WS command roll.request { characterId, poolRef, mods[], limit, edge?, visibility }
          └► server: authorize → recompute pool with same engine (authoritative) → CSPRNG faces
              → resolve hits/ones/glitch/limit/edge semantics → persist to rolls + ws_events
                  └► broadcast roll.created (visibility-filtered) → all clients render from the event
```

- **Entropy:** Node `crypto.randomInt` per die. No seeds exposed; fairness is auditable via the immutable log (pool provenance + raw faces stored per FR2.6/G5), not via reproducibility. (The NPC generator *does* use seeds — for reproducible squads, not fairness.)
- **Client preview vs. server truth:** the same engine version runs both sides; a mismatch (stale sheet) resolves in the server's favor and refreshes the client's sheet cache.
- **Edge semantics** are encoded exactly as FR2.3 and unit-tested; exploding sixes (Rule of Six) roll server-side in the same transaction.

### 10.2 Formulas the engine owns (SR5 core)

Implemented with per-value provenance; all overridable (Principle 2):

- **Limits:** Physical = ⌈(STR×2 + BOD + REA)/3⌉ · Mental = ⌈(LOG×2 + INT + WIL)/3⌉ · Social = ⌈(CHA×2 + WIL + ESS)/3⌉
- **Condition monitors:** Physical = 8 + ⌈BOD/2⌉ · Stun = 8 + ⌈WIL/2⌉ · Overflow = BOD (+augment mods)
- **Wound modifier:** −1 per 3 filled boxes per monitor, cumulative across monitors; applied to pools and Initiative Score
- **Initiative:** Physical REA + INT + 1d6 (augments add dice, cap 5d6) · Astral INT×2 + 2d6 · VR cold DP + INT + 3d6 · VR hot DP + INT + 4d6; combat turn = descending scores, −10 per pass, repeat while > 0
- **Movement:** walk AGI×2 m / run AGI×4 m per turn (engine-derived for the Grid's ruler, FR9.8)
- **Glitches:** ones > ⌊dice/2⌋ → glitch; glitch with 0 hits → critical
- **Soak:** BOD + modified Armor (AP applies); if modified DV ≤ modified AV, damage becomes Stun
- **Environment & range:** the SR5 environmental table (light/glare, visibility, wind) and per-weapon range bands compose into the standard −1/−3/−6/−10 tiers per RAW, emitted as `scene`/`range` modifiers (FR9.9, FR9.11) — table editable per campaign
- **Essence:** augment Essence costs reduce ESS; MAG/RES reduced per Essence lost
- **Sustaining:** −2 dice per sustained spell (focus/quickening exemptions per FR8.2)
- **Generation:** archetype template + tier → attribute/skill/loadout sampling within GM ranges, then full derivation as above so output is immediately playable (FR10.2)
- **Karma costs** for standard advancement (FR3.7) and **recoil** (progressive, per-weapon note) — assistive, GM-editable

Anything not listed resolves through manual entry (Principle 5). The engine grows by demand from real sessions, not by trying to swallow the rulebook up front.

---

## 11. Real-time design

- **Rooms:** one WS room per campaign; joining requires an authenticated session and membership. Presence (who's online, who's viewing the encounter/scene) is broadcast.
- **Persisted events — the source of sync:** every state-changing action appends a `ws_events` row (monotonic id per campaign) and broadcasts it. Clients track `last_event_id`; on reconnect they send it and the server **replays the gap** (or sends a fresh snapshot if the gap is too old). This one mechanism makes flaky table Wi-Fi a non-event.
- **Ephemeral events — the feel of a shared table:** token-drag interim positions, pings, and pointer trails relay through the hub at a throttled rate (~10–15 Hz per actor) and are *never stored or replayed*. A drag ends with one persisted `token.moved` carrying the final position; a reconnecting client gets correct final state and simply misses the cosmetic motion. Same socket, one flag, two lifecycles.
- **Commands up, events down:** clients send intent (`roll.request`, `token.move`, `fog.reveal`, `encounter.advance`); the server validates against `contracts`, mutates, appends, broadcasts. Clients never gossip state to each other.
- **Visibility filtering at the hub:** every event carries a visibility scope; the hub filters per-connection before send. Hidden rolls, GM combatants, and hidden tokens simply don't exist on player sockets (Principle 4) — a hidden token's reveal is a *new* entity arriving, not a CSS change.
- **Ordering:** the server is the single writer; per-campaign event ids give a total order. No CRDTs, no OT — wiki editing uses last-write-wins with a soft edit-lock indicator; scene authoring is GM-only so conflicts don't arise.
- **Optimistic UI** for the sender's own token drag and pending actions only, never for shared state; the server's final position wins.

### Event catalog (representative)

| Event | Payload core | Kind | Emitted on |
|---|---|---|---|
| `roll.created` | roll record | persisted | dice service |
| `log.posted` | text/scene marker | persisted | table talk, scene framing |
| `encounter.updated` | encounter + combatants delta | persisted | launch, advance, interrupt, edit |
| `combatant.damaged` | monitors, wound mod | persisted | damage apply/undo (incl. copilot chains) |
| `sheet.updated` | character id, revision seq | persisted | override, advancement, import |
| `ledger.changed` | entry | persisted | award/spend/approval |
| `scene.activated` | scene id | persisted | GM switches the table's scene |
| `scene.updated` | geometry/environment delta | persisted | GM authoring |
| `token.added` / `token.moved` / `token.updated` / `token.removed` | token, final position | persisted | placement, drag end, bars/aura/reveal |
| `token.dragging` | token id, interim x/y | **ephemeral** | during drag, throttled |
| `fog.updated` | region ops | persisted | reveal/hide, staged reveals |
| `drawing.added` / `drawing.cleared` | geometry | persisted | sketches, AoE templates |
| `ping` / `pointer` | position trail | **ephemeral** | table gestures |
| `handout.revealed` / `wiki.revealed` | page/section/attachment ref | persisted | GM reveal |
| `os.changed` | persona, score | persisted | Matrix toolkit |
| `clock.advanced` | ingame date | persisted | GM |
| `presence.changed` | user, state | ephemeral | connect/disconnect/view |

---

## 12. API sketch

REST for CRUD (codex, sheets, prep, scene authoring), WS for live intent + events (§11). All I/O validated by `packages/contracts` (Zod) on the server; DTO types inferred client-side from the same schemas.

```
GET    /join/:code                   POST /api/devices/:id/revoke   # QR join → device token; revoke a lost phone
GET    /api/campaigns/:id            PATCH /api/campaigns/:id
POST   /api/campaigns/:id/invites    POST /api/invites/:token/accept
GET    /api/campaigns/:id/characters POST /api/characters (import: multipart .chum5)
GET    /api/characters/:id           PATCH /api/characters/:id (mutations create revisions)
POST   /api/characters/:id/ledger    POST /api/ledger/:entryId/approve
CRUD   /api/scenes/:id               POST /api/scenes/:id/activate
POST   /api/scenes/:id/tokens        PATCH/DELETE /api/tokens/:id
POST   /api/scenes/:id/fog           # region ops: reveal | hide | define-named
POST   /api/generator/npc            POST /api/generator/group     # template+tier+seed
POST   /api/encounters/:id/stage     # place combatants as tokens on the linked scene
CRUD   /api/roll-tables/:id          POST /api/roll-tables/:id/roll
CRUD   /api/books                    PATCH /api/books/:id  # code, offset, shared
GET    /read/:bookCode?p=426         # pdf.js viewer at printed page (auth + share checked)
POST   /api/fixer/chat               # GM-only; streams over WS; tool calls server-side
POST   /api/npcs/:id/converse        # in-character mode (FR12.6), GM-only
POST   /api/generations/:id/accept   # apply a draft (or /reject); provenance recorded
POST   /api/scenes/:id/analyze       # map vision → proposed geometry/regions draft
POST   /api/audio/retag              # Fixer re-tags the music library (haiku-tier)
GET    /api/campaigns/:id/wiki?tag=… CRUD /api/wiki/:id (+ /reveal)
CRUD   /api/npc-templates, /grunt-groups, /matrix-hosts, /runs, /sessions
POST   /api/attachments (multipart)  GET  /files/:id (auth + visibility checked)
GET    /api/campaigns/:id/rolls?session=…      (paginated log)
WS     /ws?campaign=:id              (commands/events per §11)
```

Error envelope `{ error: { code, message, details? } }`; per-device bearer tokens (HttpOnly cookie where possible — the `Secure` flag is N/A on LAN HTTP, §8) + CSRF token for mutating REST routes; rate limits on join, rolls, and generation.

---

## 13. Security, privacy, and roles

### Capability matrix

| Capability | GM | Player | Observer |
|---|:-:|:-:|:-:|
| Campaign settings, invites, ownership | ✔ | — | — |
| Edit any character / approve ledger entries / award karma-nuyen | ✔ | — | — |
| Edit own character, propose spends, roll from own sheet | ✔ | ✔ | — |
| Override derived values | anywhere | own sheet (flagged to GM) | — |
| Author scenes: maps, walls, fog, environment; place/reveal any token | ✔ | — | — |
| Move own token; ping; measure; draw temporary sketches | ✔ | ✔ | — |
| See GM layer, hidden tokens, GM-only wiki/notes/rolls/combatants | ✔ | — | — |
| Generate NPCs, run copilot, reveal handouts/pages, advance clock | ✔ | — | — |
| Edit shared codex pages | ✔ | ✔ (GM-toggleable) | — |
| View active scene (revealed areas), shared codex, roll log, encounter public view | ✔ | ✔ | ✔ |
| Post table talk / free rolls / roll public tables | ✔ | ✔ | — |

### Rules of the house

- **Server-side secrecy only.** Visibility is enforced in queries and the WS hub — never by hiding elements client-side. Hidden tokens' coordinates never reach player sockets; fog *reveal state* is authoritative server-side (the rendered fog is cosmetic, the hidden-token filter is the actual secret-keeper). The test suite asserts both at the socket (§17).
- **Minimal PII:** email + Discord id + display name. No analytics, no third-party trackers. It's a table of friends, not a product.
- **Uploads:** allow-list mime types (images, PDF, audio), size caps, images re-encoded and metadata-stripped server-side (sharp), files served behind auth with visibility checks — a GM-only map must not leak via URL guessing.
- **Standard web hygiene:** parameterized queries via ORM, Zod on every boundary, dependency audit in CI, secrets via env file outside the repo.
- **LAN-only posture:** the server binds to the laptop — reachable on the table's Wi-Fi during sessions, localhost between them. No open ports to the internet, no public URL, no tunnel. The threat model at the table is curious players, not the internet — which is exactly what server-side visibility filtering handles.
- **The table display is untrusted like any player screen:** the TV joins as a kiosk `display` device with observer-grade visibility and zero capabilities; the hub's filtering means it can only ever show what players may see (FR9.19).
- **AI is local, so the LAN posture holds absolutely:** inference runs on the laptop (or a GM-designated box on the same LAN); book text, campaign data, and conversations never leave the machine. The Discord webhook — recaps the GM explicitly publishes — is the *only* outbound traffic in the entire system. All AI features remain individually toggleable and GM-only.
- **Backups are a security feature:** see §15–16.

---

## 14. Licensing and content strategy

Shadowrun 5e is owned by Catalyst Game Labs (under license from Topps); there is **no OGL/SRD**. This shapes the product more than any technical constraint:

1. **The app ships zero game content.** No rules text, spell/gear/quality descriptions, stat blocks, tables, or artwork from any book. The engine implements *mechanics* (formulas, procedures — §10.2), which is the standard line fan tools like Chummer have operated behind for years, but we stay conservative anyway.
2. **All content is user-entered or user-imported.** Sheets come from the user's own Chummer files or their own typing. NPC archetype templates, spells, gear, and weapon range tables exist only as the user's records with `ref` page citations (e.g. "SR5 p.426") instead of reproduced text.
3. **The NPC generator ships no book stat blocks.** Its stat output is parameterized sampling from GM-authored template ranges; the flavor tables it ships (names, quirks, motivations) are our own original writing. `[D10]`
4. **Maps and art:** the app ships only our own original assets (silhouette tokens, UI art). Map images are the GM's uploads — their sourcing (drawn, purchased packs, free packs) is the GM's responsibility, same as on Roll20.
5. **Chummer interop:** we parse the user's own `.chum5` save. We do **not** bundle or redistribute Chummer's data files. (Chummer5a itself is GPL; we link to it, we don't embed it.)
6. **Naming/trademarks:** the product name and branding avoid "Shadowrun" and CGL trade dress — hence a codename like *Safehouse*. UI flavor is generic cyberpunk.
7. **Private use now, check before sharing:** for our table this is comfortably fine. If we ever want to open the repo or host for strangers, review CGL's current fan-content policy first and strip anything borderline. Test fixtures use **original characters**, not book archetypes.
8. **The rules library (M11) is the GM's own purchased PDFs, uploaded to the GM's own server, for the GM's own table.** The app never bundles, ships, or publicly serves them; they never enter the git repo (§16); access sits behind auth with per-book controls. The owner has opted to share in-app reading with campaign members (Q12) — a private-group decision about their own copies. If the instance is ever opened beyond the group, the library goes private.
9. **AI and the books:** with local inference (D12), book text is processed entirely on the GM's own machine — it never leaves, which makes the licensing story as clean as reading the book itself. The Fixer's posture is still **citation, not recitation** — answers quote sparingly and deep-link to the owned PDF (FR12.2); AI answers are never published beyond the table. AI-generated *fiction* (personas, backstories, lore) is original content and carries no book text.

---

## 15. Non-functional requirements

| Concern | Requirement |
|---|---|
| Latency — rolls | Roll tap → result visible on all connected clients p95 < 500 ms over WAN (< 250 ms LAN); sheet interactions feel instant (local engine previews) |
| Latency — Grid | Own token drag echoes locally at render framerate; other clients see interim motion ≤ 200 ms behind; final position authoritative < 500 ms. Pan/zoom stays smooth (target 60 fps, floor 30) on a mid-range laptop and a 3-year-old phone with a 60-token scene |
| Availability | The server runs when the GM runs it — session-time on the LAN plus prep on localhost. "Friday night sacred": no upgrades or migrations on session days; a laptop sleep or restart mid-session recovers fully via event replay (§11 — fog, tokens, tracker included) |
| Reconnect | A phone dropping Wi-Fi for 60 s rejoins with zero user action and no missed persisted events; only cosmetic motion is lost |
| Devices | Player session views designed at 390 px (sheet, log, tracker, and the Grid *play* view: pan/zoom, own-token move, ping); scene *authoring* is desktop-only (NG5); the table display runs full-screen in a TV browser for 6+ hours without interaction |
| Media caps | Map images ≤ 40 MB / ≤ 8192×8192 upload, server-generated downscaled variants served by viewport; token art re-encoded to standard sizes; audio loops ≤ 10 MB; book PDFs ≤ 200 MB each, streamed by byte-range so a phone opening one page doesn't download the book |
| Data durability | Nightly `pg_dump` + uploads-volume sync + pre-session snapshot, retained 30 days, copied off-box; quarterly restore drill (a backup that's never been restored is a rumor) |
| Data integrity | Ledgers and rolls append-only; character history recoverable via revisions; scene/token state recoverable via event replay |
| Capacity | 10 concurrent users, 1 campaign active, years of log history — trivial for one Postgres; no perf engineering beyond indexes, pagination, and Grid render discipline |
| Accessibility | Real buttons/labels, keyboard-navigable GM screens, WCAG AA contrast in both themes; dice results and token states distinguishable without color alone |
| AI latency | Streaming always; first token depends on hardware and model size — the *fast* slot must stream promptly enough for table use on the actual laptop, or session-time features fall back to it being prep-only. AI work never blocks table flow — generation runs async and lands as drafts |
| AI availability & resources | $0 per session — inference is local, on the **dedicated LAN inference box** (decided 0.8), so the laptop never shares resources with the model. Every AI feature degrades to its manual path when the box is absent or down (NG7); the compose `llm` fallback profile covers away games. The usage meter reports tokens and latency |
| Bundle | Initial JS < 500 KB gz (no Pixi); the Grid is a lazy chunk < 900 KB gz including PixiJS; codex editor lazy-loaded |

---

## 16. Deployment and operations

- **`compose.yaml`:** `app` (server + built SPA) · `postgres:16` (volume) · `backup` (cron: nightly dump + uploads sync to cloud/external drive). One command before the session: `pnpm docker:up` — rebuilds from the checkout, stamps the image with its commit, and prints which build is running (the same stamp sits in the page footer and on `/healthz`). No reverse proxy — plain HTTP on the LAN (§8).
- **Multi-arch by construction:** images built with `docker buildx` for **linux/amd64 + linux/arm64**; every base image and native dependency in the stack (Node, Postgres, sharp/libvips) ships both, and CI builds both platforms — the stack runs whether the host laptop is ARM or AMD64. Choosing a dependency with an x86-only native binary is a build failure, not a surprise.
- **Join QR:** the GM screen shows a QR encoding the laptop's current LAN URL + invite code (FR1.1) — nobody ever types an IP address, and a new venue's Wi-Fi just means a fresh QR.
- **Config via env:** DB URL, session secret, Discord webhook URL, `LLM_BASE_URL` + `LLM_MODEL_PRIMARY` / `LLM_MODEL_FAST` (optional — unset disables all AI cleanly), file-store path, base URL.
- **Inference topology (decided 0.8):** a **dedicated inference box on the LAN** runs llama.cpp or vLLM and serves `LLM_BASE_URL`; the laptop never competes with the model for RAM/GPU. The optional `llm` compose profile (llama.cpp, multi-arch, models in a gitignored `models/` folder) remains as the away-game fallback when the box isn't at the venue. Model sizing gets tuned once the box's hardware is pinned down during P1.
- **Migrations:** Drizzle Kit, run on container start against a lock; never on session days (§15).
- **Observability, right-sized:** structured JSON logs (pino) with request/campaign ids; `/healthz`; an in-app GM-visible "server status" chip (incl. WS connection counts). No metrics stack — the log and 7 users will tell us.
- **Cost:** €0/mo — it runs on the GM's laptop. No domain, no tunnel, no certificates, no cloud. **Minus the Roll20 subscription once §18's exit checklist clears.**
- **Roll20 migration is manual, once:** re-upload map images, copy journal entries into the codex, recreate rollable tables. Roll20's export options are limited; there is no automated importer worth building for a one-time move — we do it as part of P2/P4 acceptance.
- **The book PDFs stay out of git:** the repo's `.gitignore` excludes `*.pdf` from day one (they're already sitting in this folder). `pnpm seed:books` imports them into the app's file store, registers codes/offsets (FR11.7), **and extracts per-page text into `book_pages` for the Fixer's retrieval** (FR12.14); the backup cron covers the file store, so the library survives the same way every other upload does.
- **Environments:** local dev (compose with hot reload) and prod. No staging — pre-session freeze + backups are our safety net, honest for a hobby project.

---

## 17. Testing strategy

Effort goes where wrongness hurts: the rules engine, secrecy, and Grid sync.

1. **Rules engine (Vitest, exhaustive):**
   - Unit tests per formula in §10.2, including boundaries (glitch on pool 7 requires 4+ ones; limit clipping; overflow spill; wound-mod steps at 3/6/9 boxes; 5d6 initiative cap; Essence→MAG reduction; environmental tier composition; range-band edges).
   - **Property tests:** hits ≤ pool; limited hits ≤ limit unless Push the Limit; monitors never negative; modifier pipeline order-independent within a phase; every derived value's provenance sums to its total; **every generated NPC is engine-valid** (derivable limits/monitors/pools) and within its template's ranges; same seed → identical squad.
   - **Statistical sanity** with injected deterministic RNG: hit rate ≈ 1/3 over large N; Rule of Six expectation checks; generator distributions stay inside template bounds.
   - **Golden files:** original test characters (§14.7) with hand-verified derived sheets; Chummer import fixtures; generator fixtures (template + tier + seed → exact expected NPC). The regression net for every engine change.
2. **Server integration (REST+WS against real Postgres via testcontainers):** auth/role gates per §13 matrix; **secrecy tests** — a player connection must never receive a GM-visibility event, a hidden token's coordinates, or a GM-only query result, asserted at the socket; ledger approval flow; event replay after simulated disconnect restores tracker, tokens, and fog exactly.
3. **E2E (Playwright), the Friday-night script:** two browser contexts (GM + player-phone viewport): join → GM activates scene, player sees map with staged fog → roll visible to both with provenance including the scene modifier → launch encounter from scene, tokens become combatants → initiative passes advance; acting token highlights → GM drags a token, player sees it move; player moves own token → copilot chain: player attacks NPC → defense/soak/boxes applied → wound modifier appears in the NPC's next pool and on its token bar → hidden GM token invisible to player until revealed → staged fog region revealed → end session → ledger and recap present. **This one scenario gates release.**
4. **Grid performance smoke:** scripted scene with 60 tokens + fog on a throttled headless profile — frame budget and event-rate assertions, so a "fun" feature doesn't quietly wreck table latency.
5. **CI:** typecheck + lint + unit on every push; integration + e2e-smoke on PR to main; deploy is a tagged manual action.

---

## 18. Roadmap

Nights-and-weekends pacing; each phase ends in something the table actually uses. No calendar dates — exit criteria instead. Phases P2–P4 order can flex to table demand, but the default below front-loads what Roll20 does today (maps) and what it never did (opposition tools).

| Phase | Contents | Done when |
|---|---|---|
| **P0 — Skeleton** | Repo, CI (incl. multi-arch image builds), compose deploy, QR-join auth (M1), campaign + members, empty shell UI | The group joins on phones — and the TV joins as a display — at a real table, via QR |
| **P1 — Run the table (MVP)** | Dice engine + roll log + rollable tables (M2), Chummer import + sheet view + monitors/Edge/ammo + basic ledger entries (M3 core), combat tracker (M4), rules library + deep refs (M11), **the Fixer core: chat, cited rules research, lore search, brainstorm (FR12.1–12.4)**, TV view: tracker + roll feed, GM quick notes | **A full real session runs on it** — dice, initiative, damage on the TV, and every rules argument settled by asking the Fixer or tapping the ref — with Roll20 still open only for the map |
| **P2 — The Grid** | Scenes + map building + pins (FR9.1–9.3), tokens + bars + hidden tokens (FR9.4–9.7), SR5 ruler + range bands + scene environment (FR9.8–9.11), AoE + scatter (FR9.12), manual fog + staged reveals (FR9.13–9.14), pings/drawings (FR9.15), tracker integration (FR9.10), full-scene table display on the TV (FR9.19–9.21), **Fixer: map vision, basic layout copilot, fog NL commands, token labeling (FR12.8–9, 12.11)** | **The Roll20 tab closes mid-session and nobody reopens it.** Combat runs on our map, on the big screen, and "reveal the lobby" just works |
| **P3 — The Opposition Kit** | Archetype templates + generator (FR10.1–10.3), encounter builder + party-aware threat readout (FR10.4–10.6), combat copilot: quick-rolls, resolved chains, morale, hints (FR10.7–10.10), **Fixer: NPC personalities/backstories + in-character conversations (FR12.5–12.6)** | The GM preps an evening's opposition — statted *and* storied — in under 30 minutes, runs a firefight without a spreadsheet, and improvs any NPC's voice on demand |
| **P4 — Campaign memory** | Codex + visibility + handouts (M5), sessions + recap→Discord (M6), ledger approval flow (FR3.6), contacts, calendar, **Fixer: codex drafting + recap drafts (FR12.7, 12.12)**; Roll20 journal/handout content migrated (§16) | Between-session life happens in-app; recaps write themselves for editing; **Roll20 subscription cancelled** — the exit checklist below is green |
| **P5 — Deep SR5** | **Magic toolkit first (M8)** — casting/drain flow, sustained spells, spirits, foci, adept powers (party: mage/shaman + adept, per 0.6); advancement editor (FR3.7); template library polish; **Fixer: stagecraft — mood-tagged music library + scene matching (FR12.10)** | A magic-heavy run needs no side spreadsheets; the sam's recoil/ammo/'ware math is invisible; the room sounds like the scene |
| **P6 — Stretch & on-demand** | Matrix toolkit (M7 — waits for a decker), token vision + dynamic lighting (FR9.16), Matrix overlay (FR9.17), native priority char-gen (FR3.9), **image-gen adapter: map art + token portraits**, PWA offline sheet cache, campaign export/archive | Only if the table comes to want them |

### Roll20 exit checklist (the success criterion, itemized)

| Roll20 feature we use | Safehouse home | Ready in |
|---|---|---|
| Maps, grid, tokens | M9 scenes/tokens | P2 |
| Fog of war | FR9.13–9.14 (manual + staged) | P2 |
| Measurement/ruler | FR9.8–9.9 (better: SR5-native) | P2 |
| Dice + macros | M2 (better: limits/Edge/glitches) | P1 |
| Initiative tracker | M4 (better: initiative passes) | P1 |
| Character sheets | M3 via Chummer import | P1 |
| Handouts | FR5.4 staged reveals | P4 (interim: image drops in the log from P1) |
| Journal/notes | M5 codex | P4 |
| Rollable tables | FR2.11 | P1 |
| Shared map on the table TV | FR9.19–9.21 table display | P1 basic (tracker/rolls) · P2 full scene |
| Jukebox/ambient audio | Not used (Q9 resolved) | ✓ nothing to replace |
| Voice/video | Stays on Discord (NG3) | already true |
| Dynamic lighting | Not used (Q9 resolved) | ✓ manual fog is the plan |
| PDFs open in a separate reader (not Roll20, but same pain) | M11 — refs deep-link into the book, in-app | P1 |

Rules of the road: ship P1 before gold-plating anything; every phase leaves `main` deployable; feature requests from actual sessions jump the queue.

---

## 19. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Rules-engine scope spiral** — SR5 is a swamp of exceptions | Modifier pipeline + override-everything means partial coverage is still useful (Principles 2/5); engine grows only from real session demand; golden tests keep regressions out |
| R2 | **Licensing** — CGL content is closed | §14: no shipped content, page refs only, generator ships original flavor + parameterized stats only, neutral branding, private use; review before any public release |
| R3 | **Solo-dev burnout** | Phases are independently valuable; P1 is deliberately small; boring tech; the app degrades gracefully if development pauses — and Roll20 remains available as the fallback until its exit checklist is green |
| R4 | **Chummer format drift** | Pin tested Chummer versions; keep raw XML for re-mapping; unmapped-fields report + manual entry fallback |
| R5 | **Mid-session failure** (server restart, Wi-Fi) | Event-log replay (§11) covers tracker, tokens, and fog; state snapshot recovery; pre-session backup; "dumb mode" manual tracker as last resort |
| R6 | **Players don't adopt it** | Phone-first UX; Discord stays for talk (NG3) with rolls mirrored in; the GM using it well is the adoption strategy |
| R7 | **Data loss** | Append-only ledgers/rolls, revisions, nightly + pre-session backups incl. uploads, restore drills (§15) |
| R8 | **Realtime bugs corrupt shared state** | Single-writer server, total event order, commands validated by contracts, replay from log rather than client patching; ephemeral traffic can't touch persisted state by construction |
| R9 | **The Grid is where hobby VTTs die** — vision/lighting especially | Hard phase gates: manual fog ships first and stays first-class permanently; FR9.16 only starts after P2–P4 are in weekly use; PixiJS gives proven rendering patterns; NG1 caps the ambition (no 3D/physics/effects); perf smoke tests in CI (§17.4) keep the Grid honest |
| R10 | **Threat readouts get treated as promises** — SR5 has no CR and dice pools swing | Estimates show their math (Principle 3), are labeled as estimates, and sit beside live tuning levers (FR10.6); the copilot never acts without the GM |
| R11 | **Local AI: model quality, and the inference box being down or left at home** | Resource contention is solved by design — inference lives on a dedicated LAN box (D12), not the session laptop. For quality: retrieval does the heavy lifting so the model synthesizes rather than recalls (FR12.14); citations come from retrieval, so a weak model can't fake a page (FR12.2); grammar-constrained output keeps structured drafts valid; fast/primary slots size work appropriately (FR12.16). Box absent → clean degradation to manual paths (NG7); the Fixer advises, the GM adjudicates |
| R12 | **AI output drifts into reproducing book text or flattening the campaign's voice** | Citation-not-recitation posture (§14.9): AI rules answers stay at the table and quote sparingly; generated fiction is original and grounded in *this campaign's* codex, not generic sprawl-flavored mush; drafts are edited by a human before they're canon (Principle 8) |

---

## 20. Decision log and open questions

Defaults adopted in this draft — each is cheap to reverse *now* and expensive later:

| # | Decision | Status |
|---|---|---|
| D1 | ~~Companion platform, not a VTT~~ → **Full tactical Grid is core** (M9): map making, tokens, fog, SR5-native measurement. Scope capped by NG1 (2D, no physics/effects); vision/lighting phased last | **Revised 0.2** |
| D2 | TypeScript monorepo; React/Vite + Fastify/ws + Postgres/Drizzle (§8) | **Accepted 0.4** |
| D3 | Docker Compose **on the GM's laptop**, images built **multi-arch (amd64 + arm64)**; LAN-only during sessions, localhost between; no remote access, nothing internet-facing | **Accepted 0.5** |
| D4 | Server-authoritative dice & state; pure shared rules engine | Proposed |
| D5 | Chummer import is the character pipeline; native char-gen (FR3.9) confirmed as a real P6 goal, not a maybe | **Accepted 0.6** |
| D6 | Discord remains the talk layer; app posts into it, doesn't replace it | Proposed |
| D7 | ~~Discord OAuth + magic link~~ → **QR-code join links minting long-lived per-device tokens** (players and the TV scan at the table); no passwords, no external IdP; Discord kept for the outbound recap webhook only | **Revised 0.5** |
| D8 | Single-node, no horizontal scaling, no Redis/queues | Proposed |
| D9 | PixiJS (WebGL) renders the Grid, as a lazy-loaded chunk | Proposed 0.2 |
| D10 | Generator ships original flavor tables only; stats are parameterized from GM-authored templates | Proposed 0.2 |
| D11 | Refs are structured `{book, page}` and deep-link into the GM's own uploaded PDFs via self-hosted pdf.js with per-book page offsets; **library shared with the table** (per Q12), per-book GM-only toggle in reserve; books never enter git, never ship with the app | Accepted 0.4 |
| D12 | AI provider: **local models via an OpenAI-compatible API — llama.cpp or vLLM — served from a dedicated inference box on the table's LAN** (laptop compose profile as away-game fallback). Two model slots (primary for prep/fiction, fast for live mechanical tasks), configured by env base URL. Nothing AI ever touches the internet; box absent = AI-free app | **Accepted 0.8** |
| D13 | **Stats are procedural, fiction is AI:** the rules engine generates and validates every number; the Fixer writes personalities, stories, and lore. AI never invents mechanics | Proposed 0.7 |
| D14 | Retrieval is **Postgres full-text search** over extracted book/codex text; pgvector held as an upgrade path, not a day-one dependency | Proposed 0.7 |

**Open questions for the table (answers slot into §6/§18 without restructuring):**

1. ~~Confirm D2/D3 — stack and hosting?~~ **Resolved 0.5: TypeScript stack confirmed; Docker on the GM's laptop, multi-arch (ARM64/AMD64), LAN-only.**
2. ~~Confirm D7 — Discord sign-in?~~ **Obsolete 0.5:** sign-in is QR device tokens at the table; Discord remains only as the outbound recap webhook, which needs no player accounts.
3. ~~Which sourcebooks are in play, and which get mechanical support first?~~ **Fully resolved 0.6:** all 17 books are loaded (M11); party composition (street sam + mage/shaman + adept) sets the mechanical order — combat core (P1/P3), then **magic (M8) leads P5** including Street Grimoire options as they come up; Matrix depth waits for a decker (M7 → P6).
4. ~~House rules to encode as campaign flags from day one?~~ **Resolved 0.6: none — the table plays RAW.** The engine implements straight SR5 core; the house-rule flag system stays in the architecture (it costs nothing and future house rules land as flags, not code), but ships empty.
5. ~~Native character creation eventually, or Chummer-forever?~~ **Resolved 0.6: native eventually** — FR3.9 stays a committed P6 goal; Chummer remains the builder until then.
6. ~~Promote a Rigger toolkit?~~ **Resolved 0.6: no rigger in the party** — vehicles/drones stay on tokens, generic sheet sections, and the tracker. Revisit only if a rigger joins.
7. ~~Campaign name?~~ **Deferred by choice (0.6):** naming waits. *Safehouse* remains the working title everywhere. To keep deferral cheap, the name is data — campaign settings and theming config, never hardcoded — so renaming later is a settings change, not a refactor.
8. **Which Roll20 features does the table *actually* use today?** Walk the §18 exit checklist together — especially dynamic lighting and the jukebox (Q9), the two that move phases if the answer is "weekly."
9. ~~Do we use Roll20's dynamic lighting and/or jukebox today?~~ **Resolved 0.4: neither.** FR9.16/FR9.18 stay P6 and get built only on genuine future demand; manual fog + Discord audio carry us.
10. ~~Map art pipeline?~~ **Resolved 0.5: a mix of all three** — ready-made images, scanned hand-drawn maps, and in-app assembly. FR9.2 ships upload-first tooling in P2 (with scan-friendly controls); the prop-stamp assembly layer grows from P3 onward.
11. ~~Grid default: 1 m or 2 m per square?~~ **Resolved 0.6: 1 m per square** (FR9.1's default confirmed); per-scene override remains for big outdoor maps.
12. ~~Book sharing (FR11.5): shared with players or GM-only?~~ **Resolved 0.4: shared** — players can open refs and read the books in-app; per-book GM-only toggle stays available.

---

## Appendix A — Glossary (selected)

| Term | Meaning here |
|---|---|
| **Hit** | A die showing 5 or 6 |
| **Limit** | Cap on usable hits (Physical/Mental/Social, weapon Accuracy, spell Force) |
| **Glitch / critical glitch** | Ones on more than half the dice rolled / a glitch with zero hits |
| **Edge** | Luck attribute spent for the actions in FR2.3; "burning" permanently reduces it |
| **Initiative pass** | One trip through the turn order; scores drop 10 after each; act again while > 0 |
| **Condition monitor** | Physical/Stun damage track; filled boxes impose wound modifiers |
| **Overwatch Score (OS)** | Heat accumulated by illegal Matrix actions; convergence at 40 |
| **Grunt / Professional Rating** | Simplified NPC extras / their competence-and-morale tier |
| **Scene** | A map + grid + environment + fog + tokens, staged by the GM, activated for the table |
| **The Grid** | Safehouse's tactical layer (M9) — and, in-world, the Matrix's street name; the pun is intentional |
| **Table display** | The big TV's kiosk view: player-visible scene, tracker, and reveals, steered by the GM (FR9.19–9.21) |
| **The Fixer** | The GM's AI copilot (M12) — in-world, the one who knows everyone and sets up the job |
| **Persona sheet** | An NPC's fiction block: traits, voice, goals, secrets, knowledge boundary (FR12.5–12.6) |
| **Draft (AI)** | An `ai_generation` awaiting GM accept/edit/reject — the only way AI output becomes canon (Principle 8) |
| **Archetype template** | GM-authored generator input: role tags + tier curves + loadout slots (FR10.1) |
| **Copilot** | The GM-side automation that rolls and resolves for NPCs, always with override (FR10.7–10.10) |
| **Ephemeral event** | Relayed live but never stored: drags-in-motion, pings, pointers (§11) |
| **Provenance** | The stored breakdown of how the engine computed any value |
| **`ref`** | A structured `{book, page}` citation stored in place of reproduced content — one tap opens the GM's own PDF at that printed page (M11) |
| **Page offset** | Printed page − PDF page, per book; the core rulebook's is +5 (measured) |

## Appendix B — Sample WS roll exchange

```jsonc
// client → server
{ "cmd": "roll.request", "campaignId": "c1", "characterId": "ch7",
  "kind": "simple", "poolRef": { "skillId": "perception" },
  "mods": [ { "id": "scene-dim-light", "target": "pool", "op": "add", "value": -1,
              "source": { "kind": "scene", "ref": "sc3" }, "active": true,
              "note": "Warehouse — dim light" } ],
  "limit": { "kind": "mental" }, "visibility": "public" }

// server → room (after authoritative recompute + CSPRNG)
{ "event": "roll.created", "id": 48122, "roll": {
    "actor": { "characterId": "ch7", "name": "Static" },
    "request": { "pool": 8, "breakdown": [
      { "label": "INT", "value": 4 }, { "label": "Perception 3", "value": 3 },
      { "label": "Vigilance", "value": 2 },
      { "label": "Warehouse — dim light", "value": -1 } ],
      "limit": { "kind": "mental", "value": 5 } },
    "faces": [6,5,5,2,1,1,3,4], "hits": 3, "ones": 2,
    "glitch": "none", "limitedHits": 3, "edgeAction": null } }
```

*(The scene's environment arrived as an ordinary modifier with provenance — the Grid and the dice engine meet in the pool breakdown. This exchange is the contract the whole live layer hangs off.)*

---

*Next step once this is reviewed: turn §18 P0 into a checklist and cut the first stone — repo, compose file, auth walking skeleton. Watch your back. Shoot straight. Conserve ammo. And never, ever cut a deal with a dragon.*
