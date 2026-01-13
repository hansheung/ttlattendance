import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithCustomToken } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../lib/firebase";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import ttlLogo from "../assets/ttl-logo.png";

type FormState = {
  userId: string;
  password: string;
};

const initialFormState: FormState = {
  userId: "",
  password: "",
};

export function AuthPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(initialFormState);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const userIdValid = /^[a-zA-Z0-9]{4,20}$/.test(form.userId.trim());

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!userIdValid) {
      setError("User ID must be 4-20 letters or numbers.");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      const login = httpsCallable(functions, "loginWithUserId");
      const response = await login({
        userId: form.userId.trim(),
        password: form.password,
      });
      const { token, isAdmin } = response.data as {
        token: string;
        isAdmin: boolean;
      };
      await signInWithCustomToken(auth, token);
      navigate(isAdmin ? "/admin" : "/user");
    } catch (err: unknown) {
      if (err && typeof err === "object") {
        const code = (err as { code?: string }).code;
        if (
          code === "functions/unauthenticated" ||
          code === "functions/not-found" ||
          code === "functions/permission-denied" ||
          code === "functions/invalid-argument"
        ) {
          setError("User ID or password is wrong.");
          return;
        }
        const message = (err as { message?: string }).message;
        if (message && /invalid/i.test(message)) {
          setError("User ID or password is wrong.");
          return;
        }
      }
      setError(err instanceof Error ? err.message : "Unable to login.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto max-w-md fade-in-up">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 h-20 w-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <img
              src={ttlLogo}
              alt="TTL Attendance logo"
              className="h-full w-full object-contain"
            />
          </div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            TTL Attendance
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Sign in to continue.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Account Access</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-userid">User ID</Label>
                <Input
                  id="login-userid"
                  value={form.userId}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      userId: event.target.value,
                    }))
                  }
                  placeholder="your user id"
                  required
                />
                {!userIdValid && form.userId ? (
                  <p className="text-xs text-red-600">
                    User ID must be 4-20 letters or numbers.
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <div className="flex gap-2">
                  <Input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        password: event.target.value,
                      }))
                    }
                    required
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </Button>
                </div>
              </div>
              {error ? (
                <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Logging in..." : "Login"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
