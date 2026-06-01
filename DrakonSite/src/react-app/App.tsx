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
import SecretRecoverySetupOverlay from "@/react-app/components/SecretRecoverySetupOverlay";
import { RemoteWorkspaceProvider } from "@/react-app/contexts/RemoteWorkspaceContext";
import { useRemoteWorkspace } from "@/react-app/contexts/RemoteWorkspaceContext";
import { useEffectiveUser } from "@/react-app/hooks/useEffectiveUser";
import {
  canAccessRoute,
  getDefaultAuthorizedRoute,
} from "@/react-app/lib/accountAccess";
import { brand } from "@/shared/brand";
import { Loader2 } from "lucide-react";

function AuthLoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950">
      <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
    </div>
  );
}

function ProtectedRoute({
  children,
  routePath,
}: {
  children: React.ReactNode;
  routePath: string;
}) {
  const { user, isPending } = useAuth();
  const { error: remoteWorkspaceError } = useRemoteWorkspace();
  const { effectiveUser, isResolvingRemoteUser } = useEffectiveUser();
  const accessOptions = {
    billingEnabled: brand.features.billingEnabled,
    drakonFindEnabled: brand.features.drakonFindEnabled,
  };

  if (isPending || isResolvingRemoteUser) {
    return <AuthLoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!effectiveUser) {
    return remoteWorkspaceError ? <Navigate to="/login" replace /> : <AuthLoadingScreen />;
  }

  if (!canAccessRoute(effectiveUser, routePath, accessOptions)) {
    return <Navigate to={getDefaultAuthorizedRoute(effectiveUser, accessOptions)} replace />;
  }

  return (
    <>
      {children}
      <SecretRecoverySetupOverlay />
    </>
  );
}

function AuthorizedHomeRedirect() {
  const { user, isPending } = useAuth();
  const { error: remoteWorkspaceError } = useRemoteWorkspace();
  const { effectiveUser, isResolvingRemoteUser } = useEffectiveUser();

  if (isPending || isResolvingRemoteUser) {
    return <AuthLoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!effectiveUser) {
    return remoteWorkspaceError ? <Navigate to="/login" replace /> : <AuthLoadingScreen />;
  }

  return (
    <Navigate
      to={getDefaultAuthorizedRoute(effectiveUser, {
        billingEnabled: brand.features.billingEnabled,
        drakonFindEnabled: brand.features.drakonFindEnabled,
      })}
      replace
    />
  );
}

function AppRoutes() {
  const billingEnabled = brand.features.billingEnabled;
  const drakonFindEnabled = brand.features.drakonFindEnabled;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/" element={<AuthorizedHomeRedirect />} />
      <Route
        path="/ai-agents"
        element={
          <ProtectedRoute routePath="/ai-agents">
            <AIAgentsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute routePath="/dashboard">
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/cameras"
        element={
          <ProtectedRoute routePath="/cameras">
            <CamerasPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/algorithms/:cameraId"
        element={
          <ProtectedRoute routePath="/algorithms/">
            <AlgorithmsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/jobs"
        element={
          <ProtectedRoute routePath="/jobs">
            <JobsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/hub"
        element={
          <ProtectedRoute routePath="/hub">
            <HubPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/chat"
        element={
          <ProtectedRoute routePath="/chat">
            <ChatPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/events"
        element={
          <ProtectedRoute routePath="/events">
            <EventsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/drakon-find"
        element={
          <ProtectedRoute routePath="/drakon-find">
            {drakonFindEnabled ? <DrakonFindPage /> : <Navigate to="/ai-agents" replace />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/billing"
        element={
          <ProtectedRoute routePath="/billing">
            {billingEnabled ? <BillingPage /> : <Navigate to="/ai-agents" replace />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute routePath="/settings">
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/alerts"
        element={
          <ProtectedRoute routePath="/settings">
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
        <RemoteWorkspaceProvider>
          <ThemeProvider>
            <QuickChatProvider>
              <Router>
                <OnboardingProvider>
                  <AppRoutes />
                </OnboardingProvider>
              </Router>
            </QuickChatProvider>
          </ThemeProvider>
        </RemoteWorkspaceProvider>
      </AuthProvider>
    </I18nextProvider>
  );
}
