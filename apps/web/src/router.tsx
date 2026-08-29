/**
 * Route table (BUILD_CONVENTIONS "Web architecture").
 *
 * One route element per feature entry file under `src/features/*`, so work on
 * a feature stays inside that feature's own directory and this file only needs
 * an edit when a route is added, removed, or moved between chunks.
 *
 * These are all built features now, with one deliberate exception: `gm/scenes`
 * still renders a placeholder card, because scene authoring actually lives in
 * the Grid's GM panel — see `features/gm/ScenesPage.tsx` before assuming that
 * route is unfinished work.
 */
import { Suspense, lazy, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import CampaignHome from './components/shell/CampaignHome.js';
import CampaignLayout from './components/shell/CampaignLayout.js';
import JoinPage from './components/shell/JoinPage.js';
import Landing from './components/shell/Landing.js';
import NotFound from './components/shell/NotFound.js';
import BooksPage from './features/gm/BooksPage.js';
import FixerPage from './features/gm/FixerPage.js';
import GeneratorPage from './features/gm/GeneratorPage.js';
import GmHome from './features/gm/GmHome.js';
import ScenesPage from './features/gm/ScenesPage.js';
import SessionsPage from './features/gm/SessionsPage.js';
import GridPage from './features/grid/GridPage.js';
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

export const router = createBrowserRouter([
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
      {
        path: 'gm',
        children: [
          { index: true, element: <GmHome /> },
          // RunsBoard lives under features/codex/, so it rides that chunk.
          { path: 'runs', element: <Chunk><RunsBoard /></Chunk> },
          { path: 'scenes', element: <ScenesPage /> },
          { path: 'generator', element: <GeneratorPage /> },
          { path: 'fixer', element: <FixerPage /> },
          { path: 'books', element: <BooksPage /> },
          { path: 'sessions', element: <SessionsPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
]);
