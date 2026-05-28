import { SignIn } from "@clerk/react";
import { PageHeader } from "@/components/page-header";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SignInPage() {
  return (
    <div className="min-h-screen flex flex-col bg-transparent">
      <PageHeader href={`${basePath}/`} />
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          signUpUrl={`${basePath}/sign-up`}
          fallbackRedirectUrl={`${basePath}/`}
        />
      </main>
    </div>
  );
}
