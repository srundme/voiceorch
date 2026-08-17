/**
 * Content-Security-Policy for the dashboard SPA + API HTML responses.
 *
 * `'unsafe-inline'` is required for the GTM/gtag bootstrap in index.html.
 * Script hosts are allowlisted so a successful XSS cannot load arbitrary
 * third-party payloads. Connect is left on `https:` because BYO providers
 * and Razorpay talk to several origins.
 */
export const dashboardCspDirectives: Record<string, string[]> = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'self'"],
  formAction: ["'self'", "https://accounts.google.com"],
  scriptSrc: [
    "'self'",
    "'unsafe-inline'",
    // Chrome treats AudioWorklet.addModule(blob:) as a script, not a worker.
    // workerSrc blob: is not enough — without this, live test fails with
    // "Unable to load a worklet's module."
    "blob:",
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://www.googleadservices.com",
    "https://googleads.g.doubleclick.net",
    "https://connect.facebook.net",
    "https://checkout.razorpay.com",
    "https://cdn.razorpay.com",
  ],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
  imgSrc: ["'self'", "data:", "blob:", "https:"],
  mediaSrc: ["'self'", "blob:"],
  connectSrc: ["'self'", "https:", "wss:", "ws:"],
  frameSrc: [
    "'self'",
    "https://api.razorpay.com",
    "https://checkout.razorpay.com",
    "https://www.google.com",
  ],
  workerSrc: ["'self'", "blob:"],
  ...(process.env["NODE_ENV"] === "production" ? { upgradeInsecureRequests: [] } : {}),
};
