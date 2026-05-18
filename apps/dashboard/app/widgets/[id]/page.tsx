import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { toSafeRow, type WidgetRow } from "@/lib/supabase/types";
import { EditWidgetForm } from "./EditWidgetForm";
import { VisitorJwtPanel } from "./VisitorJwtPanel";
import { CustomToolsPanel } from "./CustomToolsPanel";

export const dynamic = "force-dynamic";

export default async function EditWidgetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("widgets")
    .select("*")
    .eq("id", id)
    .eq("owner_user_id", user.id)
    .maybeSingle<WidgetRow>();

  if (!data) notFound();
  const widget = toSafeRow(data);
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://your-deploy.vercel.app";

  return (
    <div className="relative flex flex-1 flex-col">
      <div className="opera-glow pointer-events-none absolute inset-0 -z-10" />

      <header className="flex items-center justify-between gap-4 px-8 py-6 sm:px-12">
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
        <div className="flex items-center gap-4">
          <span className="hidden text-xs uppercase tracking-[0.2em] text-opera-muted sm:inline">
            {user.email}
          </span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.16em] text-opera-muted transition hover:border-white/20 hover:text-opera-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10 sm:px-12">
        <div>
          <Link
            href="/widgets"
            className="text-xs uppercase tracking-[0.18em] text-opera-muted hover:text-opera-white"
          >
            ← Back to widgets
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-opera-white">
            {widget.name}
          </h1>
          <p className="mt-1 font-mono text-xs text-opera-muted">{widget.id}</p>
        </div>

        <EditWidgetForm widget={widget} />

        <VisitorJwtPanel
          widgetId={widget.id}
          hasSecret={widget.has_visitor_jwt_secret}
          appUrl={appUrl}
        />

        <CustomToolsPanel
          widgetId={widget.id}
          // widget.custom_tools is already stripped of auth_header by
          // toSafeRow; each entry carries has_auth_header instead. We
          // rehydrate the panel's view-only form with a sentinel string
          // so the operator can SEE which tools have an auth header set
          // and rotate them by typing a fresh value (or leave the
          // sentinel to keep the stored secret).
          initialTools={widget.custom_tools.map((t) => {
            const { has_auth_header: _h, ...display } = t;
            void _h;
            return t.has_auth_header
              ? { ...display, auth_header: "__REDACTED__" }
              : display;
          })}
        />
      </main>
    </div>
  );
}
