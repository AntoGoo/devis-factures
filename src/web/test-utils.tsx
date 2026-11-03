import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

/** Rend `ui` (monté sur `path`) ou un tableau de routes dans un routeur de données en mémoire, nécessaire à `useBlocker`. */
export function renderWithRouter(
  ui: ReactElement | RouteObject[],
  { path = '/', initialEntries = [path], queryClient }: { path?: string; initialEntries?: string[]; queryClient?: QueryClient } = {},
) {
  const routes = Array.isArray(ui) ? ui : [{ path, element: ui }];
  const router = createMemoryRouter(routes, { initialEntries });
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { ...result, router, queryClient: client };
}
