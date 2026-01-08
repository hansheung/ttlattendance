import { Button } from "../ui/button";
import ttlLogo from "../../assets/ttl-logo.png";

type PageHeaderProps = {
  title: string;
  onLogout?: () => void;
  action?: React.ReactNode;
};

export function PageHeader({ title, onLogout, action }: PageHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="h-10 w-10 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <img
            src={ttlLogo}
            alt="TTL Attendance logo"
            className="h-full w-full object-contain"
          />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            TTL Attendance
          </p>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        </div>
      </div>
      <div className="shrink-0">
        {action
        ? action
        : onLogout
          ? (
            <Button variant="outline" onClick={onLogout}>
              Logout
            </Button>
          )
          : null}
      </div>
    </header>
  );
}
