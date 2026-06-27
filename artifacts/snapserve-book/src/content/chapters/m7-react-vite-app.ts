import type { Chapter } from "../types";

export const reactViteApp: Chapter = {
  slug: "react-vite-app",
  moduleId: "m7",
  number: "8.1",
  title: "How the Dashboard Is Built",
  summary:
    "React + Vite + Wouter routing, and how the frontend talks to the backend through generated hooks.",
  estMinutes: 14,
  fileRef: "artifacts/dashboard/src/App.tsx",
  prerequisites: ["modules-and-imports"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Everything you've learned so far — audio decoding, the pipeline, adapters, the database — lives on the **server**. But a user never sees any of it. What they actually click is the **dashboard**: a React app where they build agents, watch calls roll in, top up their wallet, and wire up phone numbers.",
        "`App.tsx` is the **front door** of that dashboard. It's a small file with an outsized job: it sets up routing (which URL shows which page), creates the data-fetching client, wires the login token into every API call, and gates the whole app behind authentication. Read this one file and you'll understand the skeleton that every other page hangs off of.",
        "The dashboard is a **Vite + React** single-page app. There's no Next.js, no server-side rendering — just a bundle of JavaScript that the browser downloads once and then runs entirely on the client, talking to the SnapServe API over `fetch`.",
      ],
    },
    {
      kind: "concept",
      title: "Single-page app, client-side routing",
      body: [
        "A traditional website asks the server for a whole new HTML page every time you click a link. A **single-page app (SPA)** loads once, then **rewrites the page in the browser** as you navigate. No full reloads — it feels instant.",
        "For that to work, *something* has to watch the URL bar and decide which component to show. That job is **client-side routing**. SnapServe uses a tiny library called **Wouter** (think React Router, but ~1.5 KB). You give it a list of `<Route path=... component=... />` pairs wrapped in a `<Switch>`, and it renders the first one that matches the current URL.",
        "**Vite** is the build tool underneath. In development it serves your code instantly with hot-reload; for production it bundles everything into optimized static files. The dashboard reads `import.meta.env.BASE_URL` (set by Vite) so the same build can be served from `/` or from a sub-path.",
      ],
    },
    {
      kind: "analogy",
      title: "App.tsx is the lobby of a building",
      body: [
        "Picture an office tower. The **lobby** doesn't do any of the real work — no one closes a deal there — but everyone passes through it. It has a **security desk** (authentication), a **directory board** that tells you which floor to go to (routing), and a **mailroom** that handles every letter going in and out (the data client).",
        "`App.tsx` is that lobby. The actual work happens up in the offices (the page components), but they all rely on the lobby having checked your badge, pointed you to the right floor, and set up the mail.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/dashboard/src/App.tsx",
      language: "typescript",
      intro:
        "Start with the four imports that matter most — they reveal the whole architecture in four lines.",
      code: `import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { AuthProvider, useAuth, SignedIn, SignedOut } from "@/lib/auth";
import { setAuthTokenGetter, setDefaultTimeoutMs, useGetOnboardingStatus } from "@workspace/api-client-react";`,
      lines: [
        {
          lines: "1",
          label: "wouter",
          explanation:
            "The router. `Switch` picks one matching route, `Route` declares a path→component pair, `Redirect` bounces you elsewhere, and `useLocation` reads the current URL. This is the entire routing toolkit.",
        },
        {
          lines: "2",
          label: "@tanstack/react-query",
          explanation:
            "The data-fetching brain. `QueryClient` is a cache for server data; `QueryClientProvider` hands it to the whole tree. Every API call the dashboard makes flows through this.",
        },
        {
          lines: "3",
          label: "@/lib/auth",
          explanation:
            "SnapServe's own auth layer (it replaced Clerk). `SignedIn` / `SignedOut` are gates that render children only when the user is/ isn't logged in; `useAuth` exposes the session token.",
        },
        {
          lines: "4",
          label: "@workspace/api-client-react",
          explanation:
            "The **generated** API client — the bridge to the backend. `useGetOnboardingStatus` is one of dozens of auto-generated hooks (covered next chapter). `setAuthTokenGetter` teaches it how to find the login token.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/dashboard/src/App.tsx",
      language: "typescript",
      intro:
        "Two module-level singletons created once when the app loads: the query client and the router's base path.",
      code: `const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

// …

const basePath = import.meta.env.BASE_URL.replace(/\\/$/, "");`,
      lines: [
        {
          lines: "1-5",
          label: "new QueryClient",
          explanation:
            "Creates the cache for all server data. `retry: false` means a failed request doesn't silently retry (you see the error immediately), and `refetchOnWindowFocus: false` stops it from re-fetching every time you tab back to the window — sensible defaults for a dashboard.",
        },
        {
          lines: "9",
          label: "basePath",
          explanation:
            "Vite injects `BASE_URL` at build time. The `.replace(/\\/$/, \"\")` strips a trailing slash so Wouter's `base` is clean. This lets the exact same bundle run whether it's hosted at the domain root or under a sub-path.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/dashboard/src/App.tsx",
      language: "typescript",
      intro:
        "The single most important wiring in the file: teaching the generated API client where the login token lives. Without this, every authenticated request would go out anonymous.",
      code: `function AuthTokenSync() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);
  return null;
}`,
      lines: [
        {
          lines: "1",
          label: "a component that renders nothing",
          explanation:
            "It `return null` — it has no UI. Its only purpose is the **side effect**: it exists so we can run a `useEffect` at the right point in the React tree. A common pattern for 'do this once the app mounts'.",
        },
        {
          lines: "2",
          label: "grab the token getter",
          explanation:
            "`useAuth()` exposes `getToken`, an async function that reads the current session JWT from `localStorage`.",
        },
        {
          lines: "4",
          label: "setAuthTokenGetter(() => getToken())",
          explanation:
            "Registers a callback with the **module-level** API client. Now, before every fetch, the client calls this getter and attaches an `Authorization: Bearer <jwt>` header. The frontend and the generated client are decoupled — they only know each other through this one function.",
        },
        {
          lines: "5",
          label: "cleanup",
          explanation:
            "When the component unmounts, `setAuthTokenGetter(null)` unhooks it. The cleanup return is React's way of saying 'undo this effect.'",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Bearer token, not cookies",
      body: [
        "The generated client's docs literally warn 'never use `setAuthTokenGetter` in web apps where cookies are sent automatically.' SnapServe **ignores** that advice on purpose: it ditched cookie-based sessions for a **JWT in localStorage**, captured from the Google OAuth redirect fragment. So the dashboard explicitly attaches a `Bearer` token on every call — the same code path the mobile/Expo client uses.",
        "Upside: no CSRF surface and one auth model everywhere. Trade-off: the token lives in `localStorage`, so XSS hygiene matters.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/dashboard/src/App.tsx",
      language: "typescript",
      intro:
        "The route table. `Router` wraps the providers around a `<Switch>` of public routes — the directory board of the lobby.",
      code: `function Router() {
  // Google Cloud Console OAuth app settings — enter these exact URLs:
  //   Homepage URL:       https://<production-domain>/
  //   Privacy policy URL: https://<production-domain>/privacy
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <AuthTokenSync />
        <QueryClientCacheInvalidator />
        <ThemeSync />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignInPage} />
          <Route path="/app/*?" component={ProtectedApp} />
          <Route path="/impersonate" component={ImpersonatePage} />
          <Route path="/book/:slug" component={PublicBookingPage} />
          <Route path="/docs" component={DocsPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/terms" component={TermsPage} />
          <Route component={NotFound} />
        </Switch>
      </QueryClientProvider>
    </AuthProvider>
  );
}`,
      lines: [
        {
          lines: "6-7",
          label: "provider nesting order",
          explanation:
            "`AuthProvider` is outermost so auth is available everywhere; `QueryClientProvider` sits inside it so data hooks can use the token. Order matters — inner components can read outer providers, not vice-versa.",
        },
        {
          lines: "8-10",
          label: "the three side-effect components",
          explanation:
            "`AuthTokenSync` wires the token, `QueryClientCacheInvalidator` wipes the cache when the logged-in user changes, and `ThemeSync` keeps dark/light mode in sync. None render UI — they just run effects at the top of the tree.",
        },
        {
          lines: "11-13",
          label: "the <Switch>",
          explanation:
            "Wouter renders the **first** `Route` whose `path` matches the URL. Top-to-bottom order is the priority. `/` shows `HomeRedirect`, which sends logged-in users to `/app`.",
        },
        {
          lines: "15",
          label: 'path="/app/*?"',
          explanation:
            "The `*?` wildcard matches `/app` and everything under it (`/app/agents`, `/app/calls/42`…). The whole authenticated app is one sub-tree handled by `ProtectedApp`.",
        },
        {
          lines: "23",
          label: "<Route component={NotFound} />",
          explanation:
            "A `Route` with no `path` is the catch-all — it matches anything the routes above didn't. This is the 404 fallback.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/dashboard/src/App.tsx",
      language: "typescript",
      intro:
        "The authenticated sub-tree. This is where `SignedIn` / `SignedOut` decide whether you see the app at all.",
      code: `function ProtectedApp() {
  const { isLoaded } = useAuth();
  if (!isLoaded) return <SnapServeLoader />;
  return (
    <>
      <ImpersonationBanner />
      <SignedIn>
        <Switch>
          {/* Onboarding is full-screen — no sidebar layout */}
          <Route path="/app/onboarding" component={OnboardingPage} />
          {/* All other /app/* routes go through the onboarding gate + Layout */}
          <Route path="/app/*?" component={AppRoutes} />
        </Switch>
      </SignedIn>
      <SignedOut>
        <Redirect to="/" />
      </SignedOut>
    </>
  );
}`,
      lines: [
        {
          lines: "2-3",
          label: "wait for auth to load",
          explanation:
            "`isLoaded` flips true once the token has been read from storage. Until then we show a loader — otherwise we'd flash the login screen for a split second on every refresh.",
        },
        {
          lines: "7-14",
          label: "<SignedIn>",
          explanation:
            "Everything inside only renders for a logged-in user. Inside it, a nested `<Switch>` splits onboarding (full-screen) from the rest of the app (which goes through `AppRoutes`).",
        },
        {
          lines: "15-17",
          label: "<SignedOut> → Redirect",
          explanation:
            "If you're **not** signed in, you get bounced to `/`. This is the hard wall around the dashboard — no token, no app.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/dashboard/src/App.tsx",
      language: "typescript",
      intro:
        "Inside the wall, one more gate: new users are funnelled into onboarding. Notice it uses a generated hook — the first taste of the next chapter.",
      code: `function AppRoutes() {
  const [location] = useLocation();
  const { data: onboardingStatus, isLoading: onboardingLoading } = useGetOnboardingStatus();

  // Don't gate until we know the status
  if (onboardingLoading) {
    return <SnapServeLoader />;
  }

  // Redirect new users to onboarding (except if they're already there).
  const onOnboardingPage = location.startsWith("/app/onboarding");
  if (onboardingStatus?.completed === false && !onOnboardingPage) {
    return <Redirect to="/app/onboarding" />;
  }`,
      lines: [
        {
          lines: "3",
          label: "useGetOnboardingStatus()",
          explanation:
            "A generated TanStack Query hook. One line gives you `data`, `isLoading`, caching, and the `Bearer` token automatically. No hand-written `fetch`. This is the pattern the whole dashboard runs on.",
        },
        {
          lines: "6-8",
          label: "guard on loading",
          explanation:
            "Don't make a routing decision until the status query resolves — otherwise you'd briefly redirect everyone, even returning users.",
        },
        {
          lines: "12",
          label: "=== false, not falsy",
          explanation:
            "It checks `completed === false` explicitly, not just `!completed`. If the query failed and `data` is `undefined`, we must **not** redirect — only an explicit 'not completed' triggers onboarding. A subtle but important correctness detail.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/dashboard/src/App.tsx",
      language: "typescript",
      intro:
        "Finally, the root `App` component that mounts everything — including the one place `basePath` is used.",
      code: `function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="snapserve-ui-theme">
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;`,
      lines: [
        {
          lines: "3-4",
          label: "global providers",
          explanation:
            "`ThemeProvider` (dark mode, persisted under `snapserve-ui-theme`) and `TooltipProvider` wrap everything so any component can use them.",
        },
        {
          lines: "5",
          label: "<WouterRouter base={basePath}>",
          explanation:
            "This is where the base path from earlier is applied. Every route inside is now relative to it, so the app works correctly under a sub-path deployment.",
        },
        {
          lines: "8",
          label: "<Toaster />",
          explanation:
            "Mounted once at the root so any page can fire a toast notification ('Saved', 'Error', …) without re-rendering the whole app.",
        },
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "App.tsx is the hub the whole frontend rotates around. Click a box to jump to its chapter.",
      nodes: [
        { id: "vite", label: "Vite", sublabel: "dev server + bundler" },
        { id: "main", label: "main.tsx", sublabel: "createRoot(<App/>)" },
        { id: "app", label: "App.tsx", sublabel: "THIS FILE — providers + router", current: true },
        { id: "wouter", label: "Wouter <Switch>", sublabel: "client-side routes" },
        { id: "pages", label: "Page components", sublabel: "agent builder, calls…", chapterSlug: "agent-builder" },
        { id: "hooks", label: "Generated hooks", sublabel: "@workspace/api-client-react", chapterSlug: "data-hooks" },
        { id: "server", label: "API server", sublabel: "Express backend", chapterSlug: "express-app" },
      ],
      edges: [
        { from: "vite", to: "main", label: "serves bundle" },
        { from: "main", to: "app", label: "renders <App/>" },
        { from: "app", to: "wouter", label: "mounts routes" },
        { from: "wouter", to: "pages", label: "matched URL" },
        { from: "pages", to: "hooks", label: "useGet…()" },
        { from: "app", to: "hooks", label: "setAuthTokenGetter" },
        { from: "hooks", to: "server", label: "fetch /api/* + Bearer" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What is the job of the `AuthTokenSync` component, which renders `null`?",
          choices: [
            "It displays the user's avatar.",
            "It runs a side effect that registers the session-token getter with the generated API client.",
            "It redirects logged-out users to the login page.",
            "It creates the QueryClient.",
          ],
          correctIndex: 1,
          explanation:
            "It renders no UI; its entire purpose is the `useEffect` that calls `setAuthTokenGetter`, so every API request automatically gets an `Authorization: Bearer` header.",
        },
        {
          prompt: "In Wouter, what does a `<Route />` with no `path` prop do inside a `<Switch>`?",
          choices: [
            "Nothing — it's ignored.",
            "It matches the home page only.",
            "It acts as the catch-all (404) since `<Switch>` renders the first match and it matches anything left.",
            "It throws an error.",
          ],
          correctIndex: 2,
          explanation:
            "`<Switch>` renders the first matching route top-to-bottom. A path-less `Route` placed last matches whatever the routes above didn't — the 404 fallback.",
        },
        {
          prompt: "Why does `AppRoutes` check `onboardingStatus?.completed === false` instead of `!onboardingStatus?.completed`?",
          choices: [
            "They behave identically; it's just style.",
            "So a failed/pending query (data `undefined`) never wrongly redirects — only an explicit 'not completed' does.",
            "Because TypeScript requires strict equality.",
            "To make the redirect faster.",
          ],
          correctIndex: 1,
          explanation:
            "`!undefined` is `true`, which would redirect users whenever the query hasn't resolved or failed. The explicit `=== false` only triggers on a real 'not completed' value.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "The dashboard is a Vite + React single-page app; `App.tsx` is its front door — routing, data client, auth, and theming all start here.",
        "Wouter does client-side routing: `<Switch>` renders the first matching `<Route>`, and a path-less route is the 404 catch-all.",
        "`QueryClient` (TanStack Query) caches all server data; it's provided once at the root and powers every data hook.",
        "`setAuthTokenGetter` is the seam between the React app and the generated API client — it attaches the session JWT as a `Bearer` token on every request.",
        "Authentication is enforced by `<SignedIn>` / `<SignedOut>`, and new users are funnelled to onboarding before they can use the rest of the app.",
      ],
    },
  ],
};
