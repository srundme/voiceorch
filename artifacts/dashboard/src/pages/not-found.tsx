import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <PageHeader href="/" />
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-12 w-12 rounded-2xl bg-muted border border-border flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Page not found</h1>
            <p className="mt-1 text-sm text-muted-foreground">The page you are looking for does not exist.</p>
          </div>
          <Link href="/app">
            <button className="text-[13px] text-foreground hover:text-zinc-300 transition-colors">
              Back to dashboard
            </button>
          </Link>
        </div>
      </main>
    </div>
  );
}
