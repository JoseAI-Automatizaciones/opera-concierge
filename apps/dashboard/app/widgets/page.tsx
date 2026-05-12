import Image from "next/image";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import type { WidgetRow } from "@/lib/supabase/types";
import { CreateWidgetForm } from "./CreateWidgetForm";
import { WidgetRowCard } from "./WidgetRowCard";

export const dynamic = "force-dynamic";

async function loadWidgets(): Promise<WidgetRow[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("widgets")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<WidgetRow[]>();
  return data ?? [];
}

export default async function WidgetsPage() {
  const widgets = await loadWidgets();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://your-deploy.vercel.app";

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
          Widgets
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10 sm:px-12">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-opera-white">
            Your widgets
          </h1>
          <p className="mt-2 text-sm text-opera-muted">
            Each widget is a configuration profile that you embed on one or
            more host sites.
          </p>
        </div>

        <CreateWidgetForm />

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium uppercase tracking-[0.18em] text-opera-gold">
            All widgets · {widgets.length}
          </h2>
          {widgets.length === 0 ? (
            <div className="opera-card p-8 text-center text-sm text-opera-muted">
              No widgets yet. Create one above to get started.
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {widgets.map((widget) => (
                <li key={widget.id}>
                  <WidgetRowCard widget={widget} appUrl={appUrl} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
