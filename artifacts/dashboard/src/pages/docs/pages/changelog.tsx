import { useQuery } from "@tanstack/react-query";

interface ChangelogEntry {
  sha: string;
  type: string;
  scope: string | null;
  description: string;
  date: string;
}

interface ChangelogRelease {
  date: string;
  dateLabel: string;
  features: ChangelogEntry[];
  fixes: ChangelogEntry[];
  improvements: ChangelogEntry[];
  other: ChangelogEntry[];
}

export default function ChangelogPage() {
  const { data, isLoading, error } = useQuery<ChangelogRelease[]>({
    queryKey: ["changelog"],
    queryFn: async () => {
      const res = await fetch("/api/docs/changelog");
      if (!res.ok) throw new Error("Failed to fetch changelog");
      return res.json();
    }
  });

  return (
    <div>
      <h1>Changelog</h1>
      <p>New updates and improvements to SnapServe.</p>

      <div className="mt-12 space-y-16">
        {isLoading && (
          <div className="space-y-12">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-6 w-32 bg-white/10 rounded mb-6"></div>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="h-5 w-20 bg-white/10 rounded-full"></div>
                    <div className="h-5 flex-1 bg-white/10 rounded"></div>
                  </div>
                  <div className="flex gap-4">
                    <div className="h-5 w-20 bg-white/10 rounded-full"></div>
                    <div className="h-5 w-3/4 bg-white/10 rounded"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
            Failed to load changelog. Please try again later.
          </div>
        )}

        {data && data.length === 0 && (
          <div className="p-6 rounded-lg border border-white/10 text-center text-muted-foreground text-sm">
            Changelog is syncing from the repository. Check back soon.
          </div>
        )}

        {data && data.map((release) => (
          <div key={release.date} className="relative">
            <h2 className="text-xl font-semibold mb-6 sticky top-0 bg-[#0B0D12]/80 backdrop-blur py-2 z-10">
              {release.dateLabel}
            </h2>
            
            <div className="space-y-4">
              {release.features.length > 0 && release.features.map(entry => (
                <div key={entry.sha} className="flex items-start gap-4">
                  <span className="mt-0.5 shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
                    New
                  </span>
                  <span className="text-muted-foreground leading-relaxed">
                    {entry.scope && <strong className="text-foreground mr-1">{entry.scope}:</strong>}
                    {entry.description}
                  </span>
                </div>
              ))}

              {release.improvements.length > 0 && release.improvements.map(entry => (
                <div key={entry.sha} className="flex items-start gap-4">
                  <span className="mt-0.5 shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    Improvement
                  </span>
                  <span className="text-muted-foreground leading-relaxed">
                    {entry.scope && <strong className="text-foreground mr-1">{entry.scope}:</strong>}
                    {entry.description}
                  </span>
                </div>
              ))}

              {release.fixes.length > 0 && release.fixes.map(entry => (
                <div key={entry.sha} className="flex items-start gap-4">
                  <span className="mt-0.5 shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                    Fix
                  </span>
                  <span className="text-muted-foreground leading-relaxed">
                    {entry.scope && <strong className="text-foreground mr-1">{entry.scope}:</strong>}
                    {entry.description}
                  </span>
                </div>
              ))}

              {release.other.length > 0 && release.other.map(entry => (
                <div key={entry.sha} className="flex items-start gap-4">
                  <span className="mt-0.5 shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold bg-white/5 text-muted-foreground border border-white/10">
                    Other
                  </span>
                  <span className="text-muted-foreground leading-relaxed">
                    {entry.scope && <strong className="text-foreground mr-1">{entry.scope}:</strong>}
                    {entry.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
