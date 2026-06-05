import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useGetPreferences, useUpdatePreferences, getGetPreferencesQueryKey } from "@workspace/api-client-react";
import { useTheme } from "@/components/theme-provider";
import { useQueryClient } from "@tanstack/react-query";

export function ThemeSync() {
  const { isSignedIn, userId } = useAuth();
  const { theme, setTheme } = useTheme();
  const qc = useQueryClient();
  const updatePrefs = useUpdatePreferences();

  const hydratedForUser = useRef<string | null>(null);

  const prevThemeRef = useRef<string>(theme);

  const { data: prefs } = useGetPreferences({
    query: {
      queryKey: getGetPreferencesQueryKey(),
      enabled: !!isSignedIn && !!userId,
      staleTime: Infinity,
    },
  });

  useEffect(() => {
    if (!userId) {
      hydratedForUser.current = null;
      return;
    }

    if (hydratedForUser.current === userId) return;

    if (!prefs) return;

    const serverTheme = prefs.theme as "light" | "dark" | "system" | null | undefined;
    if (serverTheme && serverTheme !== theme) {
      prevThemeRef.current = serverTheme;
      setTheme(serverTheme);
    } else {
      prevThemeRef.current = theme;
    }

    hydratedForUser.current = userId;
  }, [prefs, userId]);

  useEffect(() => {
    if (!isSignedIn || !userId) return;

    if (hydratedForUser.current !== userId) return;

    if (prevThemeRef.current === theme) return;
    prevThemeRef.current = theme;

    updatePrefs.mutate(
      { data: { theme } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetPreferencesQueryKey() });
        },
      },
    );
  }, [theme, isSignedIn, userId]);

  return null;
}
