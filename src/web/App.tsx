import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router';
import { AppShell } from './layout/AppShell';
import { AccessDeniedPage } from './pages/AccessDeniedPage';
import { AdminPage } from './pages/AdminPage';
import { ClientsPage } from './pages/ClientsPage';
import { DashboardPage } from './pages/DashboardPage';
import { InvoicePage } from './pages/InvoicePage';
import { InvoicesListPage } from './pages/InvoicesListPage';
import { LinePresetsPage } from './pages/LinePresetsPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PrintPage } from './pages/PrintPage';
import { ProfilePage } from './pages/ProfilePage';
import { QuoteBillingPage } from './pages/QuoteBillingPage';
import { QuoteEditorPage } from './pages/QuoteEditorPage';
import { QuotesListPage } from './pages/QuotesListPage';
import { TemplatePickerPage } from './pages/TemplatePickerPage';
import { queryClient } from './query';
import { RequireAuth } from './session/RequireAuth';

// Routeur de données (et non <BrowserRouter>) : requis par useBlocker pour la confirmation avant de quitter une page modifiée.
export const routes = createRoutesFromElements(
  <>
    <Route path="/connexion" element={<LoginPage />} />
    <Route path="/acces-refuse" element={<AccessDeniedPage />} />
    <Route element={<RequireAuth />}>
      <Route path="/imprimer/:type/:id" element={<PrintPage />} />
      <Route path="/bienvenue/modele" element={<TemplatePickerPage mode="onboarding" />} />
      <Route path="/bienvenue/entreprise" element={<ProfilePage mode="onboarding" />} />
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="devis" element={<QuotesListPage />} />
        <Route path="devis/:id" element={<QuoteEditorPage />} />
        <Route path="devis/:id/facturation" element={<QuoteBillingPage />} />
        <Route path="factures" element={<InvoicesListPage />} />
        <Route path="factures/:id" element={<InvoicePage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="lignes-types" element={<LinePresetsPage />} />
        <Route path="profil" element={<ProfilePage mode="settings" />} />
        <Route path="profil/modele" element={<TemplatePickerPage mode="settings" />} />
      </Route>
    </Route>
    <Route path="*" element={<NotFoundPage />} />
  </>,
);

// Créé au premier rendu seulement : importer `routes` (tests) ne touche pas à l'historique du navigateur.
let browserRouter: ReturnType<typeof createBrowserRouter> | null = null;

export function App() {
  browserRouter ??= createBrowserRouter(routes);
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={browserRouter} />
    </QueryClientProvider>
  );
}
