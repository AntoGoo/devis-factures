import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from './layout/AppShell';
import { AccessDeniedPage } from './pages/AccessDeniedPage';
import { AdminPage } from './pages/AdminPage';
import { ClientsPage } from './pages/ClientsPage';
import { LinePresetsPage } from './pages/LinePresetsPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { QuoteEditorPage } from './pages/QuoteEditorPage';
import { QuotesListPage } from './pages/QuotesListPage';
import { TemplatePickerPage } from './pages/TemplatePickerPage';
import { queryClient } from './query';
import { RequireAuth } from './session/RequireAuth';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/connexion" element={<LoginPage />} />
          <Route path="/acces-refuse" element={<AccessDeniedPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/bienvenue/modele" element={<TemplatePickerPage mode="onboarding" />} />
            <Route path="/bienvenue/entreprise" element={<ProfilePage mode="onboarding" />} />
            <Route element={<AppShell />}>
              <Route index element={<h1 className="page-title">Devis &amp; Factures</h1>} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="devis" element={<QuotesListPage />} />
              <Route path="devis/:id" element={<QuoteEditorPage />} />
              <Route path="clients" element={<ClientsPage />} />
              <Route path="lignes-types" element={<LinePresetsPage />} />
              <Route path="profil" element={<ProfilePage mode="settings" />} />
              <Route path="profil/modele" element={<TemplatePickerPage mode="settings" />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
