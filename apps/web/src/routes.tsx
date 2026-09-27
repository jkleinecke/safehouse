/**
 * The route table (BUILD_CONVENTIONS "Web architecture").
 *
 * ADD ROUTES HERE, not in `router.tsx` — that file is now only
 * `createBrowserRouter(routes)`. They are separate because
 * `createBrowserRouter` touches `window.history` at module load, and this
 * package's tests run in plain node with no DOM; keeping the table importable
 * on its own is what lets `navigation.test.tsx` walk every path the GM sidebar
 * and the campaign home advertise and prove each one lands on a real screen.
 *
 * One route element per feature entry file under `src/features/*`, so work on a
 * feature stays inside that feature's own directory and this file only needs an
 * edit when a route is added, removed, or moved between chunks.
 */
import { Suspense, lazy, type ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import CampaignHome from './components/shell/CampaignHome.js';
import CampaignLayout from './components/shell/CampaignLayout.js';
import JoinPage from './components/shell/JoinPage.js';
import Landing from './components/shell/Landing.js';
import WelcomePage from './components/shell/WelcomePage.js';
import NotFound from './components/shell/NotFound.js';
import BooksPage from './features/gm/BooksPage.js';
import AiPage from './features/gm/AiPage.js';
import ArchitectPage from './features/gm/ArchitectPage.js';
// How runners are built in this campaign. It was the tallest panel on the GM
// console and the least often touched; it is a screen of its own now, and it
// keeps the builder's engine behind its own `lazy()` (router.chunks.test.ts).
import ChargenPage from './features/gm/ChargenPage.js';
import FixerPage from './features/gm/FixerPage.js';
import GeneratorPage from './features/gm/GeneratorPage.js';
import NpcsPage from './features/gm/npcs/NpcsPage.js';
import GmHome from './features/gm/GmHome.js';
// The richer roster took this route, exactly as `features/gm/home/PartyPage`
// asked it to: same path, same links out, plus condition monitors, Edge, the
// pools a GM asks for, and the damage/award controls. The console home keeps
// `home/PartyPanel` as its compact summary and links here.
import PartyPage from './features/gm/party/PartyPage.js';
import ScenesPage from './features/gm/ScenesPage.js';
import SessionsPage from './features/gm/SessionsPage.js';
import GridPage from './features/grid/GridPage.js';
// The rules library, role-aware: the GM's calibration shelf, or the shared
// shelf a player can finally reach from their phone (FR11.5).
import LibraryPage from './features/library/LibraryPage.js';
// The self-hosted pdf.js viewer (FR11.3). pdf.js itself is two dynamic hops
// away — React.lazy → PdfSurface → a same-origin `/pdfjs/pdf.mjs` import — so
// the route costs the initial bundle only its chrome (§15).
import ReaderRoute from './features/reader/ReaderRoute.js';
import SheetPage from './features/sheet/SheetPage.js';
import TablePage from './features/table/TablePage.js';
import TvPage from './features/tv/TvPage.js';

// The codex/calendar/runs tree is a lazy chunk (§15 "codex editor
// lazy-loaded"), on the same pattern as the Grid's stage: these three
// `import()` calls are the ONLY references to `features/codex/` from outside
// it, so rollup gives the whole subtree — the Markdown renderer, the page
// editor, the template panels — its own file and the entry chunk never carries
// it. The budget was already met without this; what it buys is that the
// editor's weight can grow without moving the number §15 measures.
const CalendarView = lazy(() => import('./features/codex/CalendarView.js'));
const CodexPage = lazy(() => import('./features/codex/CodexPage.js'));
const RunsBoard = lazy(() => import('./features/codex/RunsBoard.js'));

// The character builder (FR3.9, docs/CHARGEN.md §8.6) is a lazy chunk of its
// own on the same pattern: these two `import()` calls are the only way into
// `features/build/` from outside it, apart from the small entry controls
// (`entry.tsx`) and data hooks (`api.ts`) the roster, the player home and the
// console carry. `router.chunks.test.ts` holds that line.
const BuildListPage = lazy(() => import('./features/build/BuildListPage.js'));
const BuildPage = lazy(() => import('./features/build/BuildPage.js'));

/** Suspense boundary for a lazy route chunk (codex, builder) — one line while it arrives. */
function Chunk({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50dvh] items-center justify-center p-6">
          <span className="mono-label text-faint">loading…</span>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export const routes: RouteObject[] = [
  { path: '/', element: <Landing /> },
  { path: '/join/:code', element: <JoinPage /> },
  { path: '/tv/:campaignId', element: <TvPage /> },
  { path: '/read/:bookCode', element: <ReaderRoute /> },
  // Same viewer, on a path nothing else claims. `/read` is ALSO a server route
  // (the JSON offset mapping); it content-negotiates now, so a hard navigation
  // to `/read/SR5?p=426` lands on the route above. This alias stays as the
  // fallback for a client whose `Accept` header the negotiation cannot read.
  { path: '/book/:bookCode', element: <ReaderRoute /> },
  {
    path: '/c/:campaignId',
    element: <CampaignLayout />,
    children: [
      { index: true, element: <CampaignHome /> },
      // A joining player's onboarding: pick, upload or build their runner.
      { path: 'welcome', element: <WelcomePage /> },
      { path: 'sheet/:characterId', element: <SheetPage /> },
      { path: 'table', element: <TablePage /> },
      { path: 'grid', element: <GridPage /> },
      // M5 codex + calendar are table-wide: players browse shared lore during
      // sessions (§4). The server filters what each device receives.
      { path: 'codex', element: <Chunk><CodexPage /></Chunk> },
      { path: 'codex/:pageId', element: <Chunk><CodexPage /></Chunk> },
      { path: 'calendar', element: <Chunk><CalendarView /></Chunk> },
      // The library is table-wide too (FR11.5 shares books by default); the
      // page itself decides whether this device gets the calibration shelf.
      { path: 'books', element: <LibraryPage /> },
      // Character creation is player-facing and GM-reviewed, so it sits
      // beside the sheet rather than under `gm` (§6 decision 3). The server
      // decides who may read or write which build.
      { path: 'build', element: <Chunk><BuildListPage /></Chunk> },
      { path: 'build/:buildId', element: <Chunk><BuildPage /></Chunk> },
      {
        path: 'gm',
        children: [
          { index: true, element: <GmHome /> },
          // Who is at the table — the first thing the console lists.
          { path: 'party', element: <PartyPage /> },
          // Which AI the Fixer talks to — its own screen, so it can be found.
          { path: 'ai', element: <AiPage /> },
          // Creation level, caps, books, optional rules — set once, off the overview.
          { path: 'chargen', element: <ChargenPage /> },
          // RunsBoard lives under features/codex/, so it rides that chunk.
          { path: 'runs', element: <Chunk><RunsBoard /></Chunk> },
          { path: 'scenes', element: <ScenesPage /> },
          { path: 'generator', element: <GeneratorPage /> },
          { path: 'npcs', element: <NpcsPage /> },
          { path: 'fixer', element: <FixerPage /> },
          // The overarching AI: one brief → pages, NPCs, mapped scenes, as drafts.
          { path: 'architect', element: <ArchitectPage /> },
          // Alias of `/c/:id/books` for anything already pointing here.
          { path: 'books', element: <BooksPage /> },
          { path: 'sessions', element: <SessionsPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
];
