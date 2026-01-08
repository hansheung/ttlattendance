import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { LoadingScreen } from "./components/common/LoadingScreen";
import { AuthPage } from "./pages/AuthPage";
import { UserDashboard } from "./pages/UserDashboard";
import { AdminDashboard } from "./pages/AdminDashboard";
import { ScannerPage } from "./pages/ScannerPage";
import { RecentSessionsPage } from "./pages/RecentSessionsPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";

function HomeRedirect() {
    const { user, profile, loading } = useAuth();
    if (loading) return <LoadingScreen message="Checking session..." />;
    if (!user) return <Navigate to="/auth" replace />;
    if (profile?.isAdmin) return <Navigate to="/admin" replace />;
    return <Navigate to="/user" replace />;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth();
    if (loading) return <LoadingScreen message="Loading account..." />;
    if (!user) return <Navigate to="/auth" replace />;
    return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
    const { profile, loading } = useAuth();
    if (loading) return <LoadingScreen message="Checking access..." />;
    if (!profile?.isAdmin) return <Navigate to="/user" replace />;
    return <>{children}</>;
}

export default function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<HomeRedirect />} />
                    <Route path="/auth" element={<AuthPage />} />
                    <Route
                        path="/user"
                        element={
                            <RequireAuth>
                                <UserDashboard />
                            </RequireAuth>
                        }
                    />
                    <Route
                        path="/scanner"
                        element={
                            <RequireAuth>
                                <ScannerPage />
                            </RequireAuth>
                        }
                    />
          <Route
            path="/admin"
            element={
              <RequireAuth>
                <RequireAdmin>
                  <AdminDashboard />
                </RequireAdmin>
              </RequireAuth>
            }
          />
          <Route
            path="/sessions"
            element={
              <RequireAuth>
                <RecentSessionsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/reset-password"
            element={
              <RequireAuth>
                <ResetPasswordPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    );
}
