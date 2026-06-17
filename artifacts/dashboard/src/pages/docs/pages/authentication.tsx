import { CodeBlock } from "../CodeBlock";

export default function AuthenticationPage() {
  return (
    <div>
      <h1>Auth & Sessions</h1>
      <p>SnapServe uses Google OAuth for authentication. There are no passwords.</p>

      <h2>Signing in</h2>
      <p>Navigate to app.snapserve.ai → click "Sign in with Google". After granting access, you are redirected back with a 30-day session token stored in your browser.</p>

      <h2>API access</h2>
      <p>All API requests require the session token in the Authorization header:</p>
      <CodeBlock code="Authorization: Bearer <token>" language="http" />
      <p>The token is a signed HS256 JWT. You can extract it from localStorage after signing in:</p>
      <CodeBlock code='const token = localStorage.getItem("voiceorch:session");' language="javascript" />

      <h2>Session expiry</h2>
      <p>Sessions last 30 days. Re-authenticate by visiting the sign-in page again.</p>

      <h2>Admin access</h2>
      <p>Admin endpoints (platform management) use a separate <code>x-admin-token</code> header. This is not available to regular users.</p>
    </div>
  );
}
