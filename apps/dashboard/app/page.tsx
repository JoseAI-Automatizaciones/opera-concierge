import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

// Force dynamic so we can read searchParams (?code=… from the Supabase
// PKCE magic-link redirect that lands on the site root when no explicit
// redirectTo applies).
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;

  // Supabase's PKCE flow can deposit ?code=… at the site root. We can't
  // exchange the code here — Server Components are not allowed to write
  // cookies — so hand off to the /auth/confirm Route Handler which can.
  // The handler does the exchange, runs the allowlist re-check, and
  // bounces the user into the dashboard.
  if (params.code) {
    const target = `/auth/confirm?code=${encodeURIComponent(params.code)}&next=/widgets`;
    redirect(target);
  }

  return (
    <div className="relative flex flex-1 flex-col">
      <div className="opera-glow pointer-events-none absolute inset-0 -z-10" />

      <header className="flex items-center justify-between px-8 py-6 sm:px-12">
        <Image
          src="/logo.png"
          alt="Opera Concierge"
          width={220}
          height={48}
          priority
          className="h-10 w-auto"
        />
        <span className="text-xs uppercase tracking-[0.2em] text-opera-muted">
          Dashboard · v0.1
        </span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 pb-24 pt-12 sm:px-12">
        <div className="flex w-full max-w-3xl flex-col items-center text-center">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.18em] text-opera-amber">
            <span className="size-1.5 rounded-full bg-opera-gold" />
            Premium AI voice agent
          </span>

          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-opera-white sm:text-6xl">
            The agent that operates the web —{" "}
            <span className="text-opera-gold">by voice.</span>
          </h1>

          <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-opera-muted sm:text-lg">
            Drop a script into any website and let visitors talk, search,
            filter, and act. Real-time voice and text powered by OpenAI
            Realtime — operating the web for them.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/widgets"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-opera-gold px-6 text-sm font-medium text-opera-black transition hover:bg-opera-amber"
            >
              Create your first widget
            </Link>
            <a
              href="https://github.com/JoseAI-Automatizaciones/opera-concierge"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center rounded-full border border-white/10 px-6 text-sm font-medium text-opera-white transition hover:border-white/20 hover:bg-white/[0.04]"
            >
              View on GitHub
            </a>
          </div>
        </div>

        <div className="mt-20 grid w-full max-w-4xl gap-4 sm:grid-cols-3">
          {[
            {
              title: "Voice + text",
              body: "Visitors talk or type. Opera Concierge understands intent and acts in real time.",
            },
            {
              title: "Acts on the page",
              body: "Clicks, scrolls, fills, filters, navigates. Universal DOM fallback plus API tools.",
            },
            {
              title: "One-line embed",
              body: "Drop a script tag. Works on Shopify, WordPress, custom — anywhere HTML lives.",
            },
          ].map((card) => (
            <div key={card.title} className="opera-card p-6">
              <h3 className="text-sm font-medium uppercase tracking-[0.18em] text-opera-gold">
                {card.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-opera-muted">
                {card.body}
              </p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-white/[0.05] px-8 py-6 text-xs text-opera-muted sm:px-12">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span>Opera Concierge · A submark of Opera AI</span>
          <span>MIT licensed</span>
        </div>
      </footer>
    </div>
  );
}
