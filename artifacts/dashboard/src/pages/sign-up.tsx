import { SignUp } from "@clerk/react";
import { PageHeader } from "@/components/page-header";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex flex-col bg-transparent">
      <PageHeader href={`${basePath}/`} />
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <SignUp
          routing="path"
          path={`${basePath}/sign-up`}
          signInUrl={`${basePath}/sign-in`}
          fallbackRedirectUrl={`${basePath}/`}
        />
      </main>
    </div>
  );
}
