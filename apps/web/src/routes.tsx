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
import NotFound from './components/shell/NotFound.js';
import BooksPage from './features/gm/BooksPage.js';
import AiPage from './features/gm/AiPage.js';
import ArchitectPage from './features/gm/ArchitectPage.js';
import FixerPage from './features/gm/FixerPage.js';
import GeneratorPage from './features/gm/GeneratorPage.js';
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

/** Suspense boundary for the lazy codex chunk — one line while it arrives. */
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
      {
        path: 'gm',
        children: [
          { index: true, element: <GmHome /> },
          // Who is at the table — the first thing the console lists.
          { path: 'party', element: <PartyPage /> },
          // Which AI the Fixer talks to — its own screen, so it can be found.
          { path: 'ai', element: <AiPage /> },
          // RunsBoard lives under features/codex/, so it rides that chunk.
          { path: 'runs', element: <Chunk><RunsBoard /></Chunk> },
          { path: 'scenes', element: <ScenesPage /> },
          { path: 'generator', element: <GeneratorPage /> },
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
