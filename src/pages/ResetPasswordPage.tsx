import { useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { useAuth } from "../contexts/AuthContext";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"error" | "success" | null>(null);
  const [saving, setSaving] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSave = async () => {
    setStatus(null);
    setStatusType(null);
    if (!user || !user.email) {
      setStatus("User session not available.");
      setStatusType("error");
      return;
    }
    if (!currentPassword || !newPassword || !confirmPassword) {
      setStatus("All fields are required.");
      setStatusType("error");
      return;
    }
    if (newPassword.length < 6) {
      setStatus("New password must be at least 6 characters.");
      setStatusType("error");
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus("Passwords do not match.");
      setStatusType("error");
      return;
    }
    setSaving(true);
    try {
      const credential = EmailAuthProvider.credential(
        user.email,
        currentPassword,
      );
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      window.alert("Password updated. Please log in again.");
      await logout();
      navigate("/auth", { replace: true });
    } catch (err: unknown) {
      let message = "Unable to update password.";
      if (err && typeof err === "object") {
        const code = (err as { code?: string }).code;
        if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
          message = "Current Password is incorrect.";
        } else if ((err as { message?: string }).message) {
          message = (err as { message?: string }).message ?? message;
        }
      }
      setStatus(message);
      setStatusType("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Reset Password"
        action={
          <Button variant="outline" onClick={() => navigate("/user")}>
            Back
          </Button>
        }
      />
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-6 sm:px-6 fade-in-up">
        <Card>
          <CardHeader>
            <CardTitle>Reset Password</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Current Password</Label>
              <div className="flex gap-2">
                <Input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowCurrent((value) => !value)}
                  aria-label={showCurrent ? "Hide password" : "Show password"}
                >
                  {showCurrent ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>New Password</Label>
              <div className="flex gap-2">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowNew((value) => !value)}
                  aria-label={showNew ? "Hide password" : "Show password"}
                >
                  {showNew ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Confirm Password</Label>
              <div className="flex gap-2">
                <Input
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowConfirm((value) => !value)}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                >
                  {showConfirm ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            {status ? (
              <p
                className={
                  statusType === "error"
                    ? "rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600"
                    : "rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                }
              >
                {status}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => navigate("/user")}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
