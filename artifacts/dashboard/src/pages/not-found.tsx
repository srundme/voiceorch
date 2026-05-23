import { AlertCircle } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="h-12 w-12 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center">
          <AlertCircle className="h-6 w-6 text-gray-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-700">Page not found</h1>
          <p className="mt-1 text-sm text-gray-400">The page you are looking for does not exist.</p>
        </div>
        <Link href="/app">
          <button className="text-[13px] text-violet-600 hover:text-violet-300 transition-colors">
            Back to dashboard
          </button>
        </Link>
      </div>
    </div>
  );
}
