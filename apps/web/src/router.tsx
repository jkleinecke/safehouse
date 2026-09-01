/**
 * The browser router.
 *
 * ⚠ ADD ROUTES IN `./routes.tsx` — the table moved there so it can be imported
 * without a DOM. `createBrowserRouter` reads `window.history` the moment this
 * module is evaluated, which makes the table itself untestable in this
 * package's node-only vitest environment; `navigation.test.tsx` walks
 * `routes` to prove every link the GM sidebar offers lands on a real screen.
 */
import { createBrowserRouter } from 'react-router-dom';
import { routes } from './routes.js';

export { routes } from './routes.js';

export const router = createBrowserRouter(routes);
