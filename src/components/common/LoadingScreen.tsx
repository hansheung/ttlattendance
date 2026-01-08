export function LoadingScreen({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
      <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-slate-900" />
        {message}
      </div>
    </div>
  );
}
