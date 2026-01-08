import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { formatPhone } from "../lib/utils";
import ttlLogo from "../assets/ttl-logo.png";

type FormState = {
  name: string;
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
};

const initialFormState: FormState = {
  name: "",
  phone: "",
  email: "",
  password: "",
  confirmPassword: "",
};

export function AuthPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("login");
  const [form, setForm] = useState<FormState>(initialFormState);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const emailValid = /^\S+@\S+\.\S+$/.test(form.email);
  const phoneValid =
    !form.phone.trim() || /^\+60\d{6,12}$/.test(formatPhone(form.phone));

  const handleCreateAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!form.name.trim()) {
      setError("Full name is required.");
      return;
    }
    if (!emailValid) {
      setError("Enter a valid email address.");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!phoneValid) {
      setError("Phone number must start with +60 and contain only digits.");
      return;
    }

    setLoading(true);
    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        form.email,
        form.password,
      );

      const phoneValue = formatPhone(form.phone);
      await setDoc(doc(db, "users", credential.user.uid), {
        name: form.name.trim(),
        phone: phoneValue ? phoneValue : null,
        email: form.email.toLowerCase(),
        position: null,
        employeeId: null,
        normalRate: 0,
        otRate: 0,
        isAdmin: false,
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      });

      navigate("/");
    } catch (err: unknown) {
      if (err && typeof err === "object") {
        const code = (err as { code?: string }).code;
        if (
          code === "auth/email-already-in-use" ||
          code === "auth/email-already-exists"
        ) {
          setError("Email already in use.");
          return;
        }
      }
      setError(err instanceof Error ? err.message : "Unable to create account.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!emailValid) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        form.email,
        form.password,
      );
      await setDoc(
        doc(db, "users", credential.user.uid),
        {
          email: form.email.toLowerCase(),
          lastLoginAt: serverTimestamp(),
        },
        { merge: true },
      );
      navigate("/");
    } catch (err: unknown) {
      if (err && typeof err === "object") {
        const code = (err as { code?: string }).code;
        if (
          code === "auth/invalid-credential" ||
          code === "auth/user-not-found" ||
          code === "auth/wrong-password" ||
          code === "auth/invalid-email"
        ) {
          setError("Email or password is wrong.");
          return;
        }
        const message = (err as { message?: string }).message;
        if (message && /invalid/i.test(message)) {
          setError("Email or password is wrong.");
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
            Sign in or create an account to continue.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Account Access</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                setActiveTab(value);
                setError(null);
              }}
            >
              <TabsList className="w-full">
                <TabsTrigger value="login" className="flex-1">
                  Login
                </TabsTrigger>
                <TabsTrigger value="create" className="flex-1">
                  Create Account
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      value={form.email}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          email: event.target.value,
                        }))
                      }
                      placeholder="you@example.com"
                      required
                    />
                    {!emailValid && form.email ? (
                      <p className="text-xs text-red-600">
                        Enter a valid email address.
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
              </TabsContent>

              <TabsContent value="create">
                <form onSubmit={handleCreateAccount} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="create-name">Full Name</Label>
                    <Input
                      id="create-name"
                      value={form.name}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          name: event.target.value,
                        }))
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="create-phone">Phone (+60...)</Label>
                    <Input
                      id="create-phone"
                      value={form.phone}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          phone: event.target.value,
                        }))
                      }
                      placeholder="+60123456789"
                    />
                    {!phoneValid ? (
                      <p className="text-xs text-red-600">
                        Phone numbers must start with +60 and contain digits
                        only.
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="create-email">Email</Label>
                    <Input
                      id="create-email"
                      type="email"
                      value={form.email}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          email: event.target.value,
                        }))
                      }
                      placeholder="you@example.com"
                      required
                    />
                    {!emailValid && form.email ? (
                      <p className="text-xs text-red-600">
                        Enter a valid email address.
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="create-password">Password</Label>
                    <div className="flex gap-2">
                      <Input
                        id="create-password"
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
                  <div className="space-y-2">
                    <Label htmlFor="create-confirm-password">
                      Confirm Password
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="create-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        value={form.confirmPassword}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            confirmPassword: event.target.value,
                          }))
                        }
                        required
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowConfirmPassword((value) => !value)}
                      >
                        {showConfirmPassword ? "Hide" : "Show"}
                      </Button>
                    </div>
                  </div>
                  {error ? (
                    <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                      {error}
                    </p>
                  ) : null}
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Creating..." : "Create Account"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
