import { AlertCircle } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="h-12 w-12 rounded-2xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
          <AlertCircle className="h-6 w-6 text-white/35" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-white/75">Page not found</h1>
          <p className="mt-1 text-sm text-white/35">The page you are looking for does not exist.</p>
        </div>
        <Link href="/app">
          <button className="text-[13px] text-violet-400 hover:text-violet-300 transition-colors">
            Back to dashboard
          </button>
        </Link>
      </div>
    </div>
  );
}
