/**
 * Route table (BUILD_CONVENTIONS "Web architecture").
 * Feature stubs live one-per-file under src/features/* so feature agents
 * replace their own files without touching this one.
 */
import { createBrowserRouter } from 'react-router-dom';
import CampaignHome from './components/shell/CampaignHome.js';
import CampaignLayout from './components/shell/CampaignLayout.js';
import JoinPage from './components/shell/JoinPage.js';
import Landing from './components/shell/Landing.js';
import NotFound from './components/shell/NotFound.js';
import ReaderPage from './components/shell/ReaderPage.js';
import BooksPage from './features/gm/BooksPage.js';
import FixerPage from './features/gm/FixerPage.js';
import GeneratorPage from './features/gm/GeneratorPage.js';
import GmHome from './features/gm/GmHome.js';
import ScenesPage from './features/gm/ScenesPage.js';
import SessionsPage from './features/gm/SessionsPage.js';
import GridPage from './features/grid/GridPage.js';
import SheetPage from './features/sheet/SheetPage.js';
import TablePage from './features/table/TablePage.js';
import TvPage from './features/tv/TvPage.js';

export const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/join/:code', element: <JoinPage /> },
  { path: '/tv/:campaignId', element: <TvPage /> },
  { path: '/read/:bookCode', element: <ReaderPage /> },
  {
    path: '/c/:campaignId',
    element: <CampaignLayout />,
    children: [
      { index: true, element: <CampaignHome /> },
      { path: 'sheet/:characterId', element: <SheetPage /> },
      { path: 'table', element: <TablePage /> },
      { path: 'grid', element: <GridPage /> },
      {
        path: 'gm',
        children: [
          { index: true, element: <GmHome /> },
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
