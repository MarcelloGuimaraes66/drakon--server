import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router";
import { AuthProvider, useAuth } from "@getmocha/users-service/react";
import { ThemeProvider } from "@/react-app/hooks/useTheme";
import { QuickChatProvider } from "@/react-app/hooks/useQuickChat";
import { OnboardingProvider } from "@/react-app/hooks/useOnboarding";
import { I18nextProvider } from "react-i18next";
import i18n from "@/react-app/i18n";
import LoginPage from "@/react-app/pages/Login";
import AuthCallbackPage from "@/react-app/pages/AuthCallback";
import DashboardPage from "@/react-app/pages/Dashboard";
import AIAgentsPage from "@/react-app/pages/AIAgents";
import CamerasPage from "@/react-app/pages/Cameras";
import AlgorithmsPage from "@/react-app/pages/Algorithms";
import JobsPage from "@/react-app/pages/Jobs";
import ChatPage from "@/react-app/pages/Chat";
import EventsPage from "@/react-app/pages/Events";
import BillingPage from "@/react-app/pages/Billing";
import SettingsPage from "@/react-app/pages/Settings";
import DrakonFindPage from "@/react-app/pages/DrakonFind";
import HubPage from "@/react-app/pages/Hub";
import { brand } from "@/shared/brand";
import { Loader2 } from "lucide-react";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isPending } = useAuth();

  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const billingEnabled = brand.features.billingEnabled;
  const drakonFindEnabled = brand.features.drakonFindEnabled;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Navigate to="/ai-agents" replace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ai-agents"
        element={
          <ProtectedRoute>
            <AIAgentsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/cameras"
        element={
          <ProtectedRoute>
            <CamerasPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/algorithms/:cameraId"
        element={
          <ProtectedRoute>
            <AlgorithmsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/jobs"
        element={
          <ProtectedRoute>
            <JobsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/hub"
        element={
          <ProtectedRoute>
            <HubPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/events"
        element={
          <ProtectedRoute>
            <EventsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/drakon-find"
        element={
          <ProtectedRoute>
            {drakonFindEnabled ? <DrakonFindPage /> : <Navigate to="/ai-agents" replace />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/billing"
        element={
          <ProtectedRoute>
            {billingEnabled ? <BillingPage /> : <Navigate to="/ai-agents" replace />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/alerts"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <ThemeProvider>
          <QuickChatProvider>
            <Router>
              <OnboardingProvider>
                <AppRoutes />
              </OnboardingProvider>
            </Router>
          </QuickChatProvider>
        </ThemeProvider>
      </AuthProvider>
    </I18nextProvider>
  );
}
