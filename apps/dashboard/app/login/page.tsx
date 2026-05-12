import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { safeInternalPath } from "@/lib/auth/safe-redirect";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; e?: string }>;
}) {
  // Already signed in → bounce to the intended destination, sanitized.
  const user = await getUser();
  const params = await searchParams;
  if (user) redirect(safeInternalPath(params.next, "/widgets"));

  return (
    <div className="relative flex flex-1 flex-col">
      <div className="opera-glow pointer-events-none absolute inset-0 -z-10" />

      <header className="flex items-center justify-between px-8 py-6 sm:px-12">
        <Link href="/" className="block">
          <Image
            src="/logo.png"
            alt="Opera Concierge"
            width={220}
            height={48}
            priority
            className="h-10 w-auto"
          />
        </Link>
        <span className="text-xs uppercase tracking-[0.2em] text-opera-muted">
          Sign in
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 pb-24 sm:px-12">
        <div className="opera-card p-7">
          <h1 className="text-xl font-semibold tracking-tight text-opera-white">
            Operator sign in
          </h1>
          <p className="mt-2 text-sm text-opera-muted">
            Enter your email. We'll send a magic link — no password.
          </p>

          <LoginForm initialError={params.e ?? null} />

          <p className="mt-6 text-xs text-opera-muted/80">
            Access is restricted to allowlisted emails. Set{" "}
            <code className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono">
              ALLOWED_EMAILS
            </code>{" "}
            in your environment.
          </p>
        </div>
      </main>
    </div>
  );
}
