/** Legacy route — redirects to Business Home. */
import { Redirect } from "wouter";

export default function CommandCenterRedirect() {
  return <Redirect to="/app/home" />;
}
