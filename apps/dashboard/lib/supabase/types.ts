/**
 * Supabase row types for Opera Concierge.
 *
 * Keep these in sync with `supabase/migrations/*`. When the schema changes,
 * regenerate via `supabase gen types typescript --project-id <ref>` and replace.
 */

export type CustomToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  endpoint: string;
  method: "POST";
  auth_header?: string;
  timeout_ms?: number;
};

/** Operator-facing projection — strips the secret auth_header but keeps a
 *  boolean so the dashboard UI can render "[REDACTED]" placeholder text.
 *  Used inside WidgetRowSafe; ALL paths from server → operator client go
 *  through this so a bearer token never crosses to the browser. */
export type SafeCustomTool = Omit<CustomToolDef, "auth_header"> & {
  has_auth_header: boolean;
};

/** Public-safe projection of a custom tool — what the widget receives.
 *  Excludes endpoint, auth_header, timeout_ms (all server-only). */
export type PublicCustomTool = Pick<
  CustomToolDef,
  "name" | "description" | "parameters"
>;

export type WidgetRow = {
  id: string;
  name: string;
  primary_color: string;
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  system_prompt: string;
  voice: string;
  llm_model: string;
  allowed_origins: string[];
  max_sessions_per_minute: number;
  max_sessions_per_day: number;
  max_session_seconds: number;
  max_response_output_tokens: number;
  /**
   * Operator-supplied OpenAI API key. Server-only — never include in
   * PublicWidgetConfig. Nullable to support widget creation flow where
   * the operator hasn't yet supplied a key.
   */
  openai_api_key: string | null;
  /**
   * Operator-defined custom HTTP tools. Each entry has server-only fields
   * (endpoint, auth_header) and public-safe fields (name, description,
   * parameters). The widget config endpoint returns only the public-safe
   * projection; the proxy route reads the server-only fields directly.
   */
  custom_tools: CustomToolDef[];
  /**
   * HS256 secret for verifying visitor-identity JWTs (Layer 2 signed).
   * Server-only — never include in PublicWidgetConfig or WidgetRowSafe.
   * NULL means signed mode is OFF (unsigned data-opera-user-id is
   * accepted instead). Set means signed mode is the only path —
   * data-opera-user-id is ignored.
   */
  visitor_jwt_secret: string | null;
  /**
   * auth.users.id of the operator who owns this widget. Populated on
   * insert; the dashboard filters queries by this column so each operator
   * only sees their own widgets. Nullable for back-compat with pre-feature
   * rows; new inserts MUST set it.
   */
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Public-safe fields returned by /api/widget/config to the embedded widget.
 * `max_session_seconds` is included so the widget can enforce the wall-clock
 * cap client-side (auto-stop the WebRTC connection at the limit).
 */
export type PublicWidgetConfig = Pick<
  WidgetRow,
  "id" | "name" | "primary_color" | "position" | "voice" | "max_session_seconds"
> & {
  /** Public-safe projection of the operator's custom tools. The widget
   *  forwards these to OpenAI on session.update so the agent can call
   *  them. The endpoint + auth header are never exposed here. */
  custom_tools: PublicCustomTool[];
};

export function toPublicConfig(row: WidgetRow): PublicWidgetConfig {
  return {
    id: row.id,
    name: row.name,
    primary_color: row.primary_color,
    position: row.position,
    voice: row.voice,
    max_session_seconds: row.max_session_seconds,
    custom_tools: (row.custom_tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  };
}

/**
 * Operator-safe shape for the dashboard UI and same-origin management API.
 * Omits `openai_api_key` (must never cross the server→client boundary) but
 * includes a boolean indicator so the UI can show "key set / missing".
 *
 * Use everywhere a widget row leaves the server: API responses, page server
 * components passing data to client components, etc. The realtime session
 * route is the ONLY place that should read the raw `openai_api_key` column,
 * and that data never escapes the route.
 */
export type WidgetRowSafe = Omit<
  WidgetRow,
  "openai_api_key" | "visitor_jwt_secret" | "custom_tools"
> & {
  has_openai_api_key: boolean;
  has_visitor_jwt_secret: boolean;
  custom_tools: SafeCustomTool[];
};

export function toSafeRow(row: WidgetRow): WidgetRowSafe {
  const { openai_api_key: _k, visitor_jwt_secret: _s, custom_tools: _t, ...rest } = row;
  void _k;
  void _s;
  void _t;
  return {
    ...rest,
    has_openai_api_key: Boolean(row.openai_api_key),
    has_visitor_jwt_secret: Boolean(row.visitor_jwt_secret),
    custom_tools: (row.custom_tools ?? []).map((t) => {
      const { auth_header, ...toolRest } = t;
      return { ...toolRest, has_auth_header: Boolean(auth_header) };
    }),
  };
}

/** Columns to SELECT for any path that leaves the server — excludes the key. */
export const WIDGET_SAFE_COLUMNS =
  "id, name, primary_color, position, system_prompt, voice, llm_model, allowed_origins, max_sessions_per_minute, max_sessions_per_day, max_session_seconds, max_response_output_tokens, created_at, updated_at, openai_api_key";

/**
 * Safe-row SELECT helper: still SELECTs openai_api_key from the DB so we can
 * compute `has_openai_api_key`, but the projection drops the actual value
 * before returning to the caller. Use `select("*")` ONLY in the realtime
 * session route where the raw key is required.
 */
export function rowsToSafe(rows: WidgetRow[] | null): WidgetRowSafe[] {
  return (rows ?? []).map(toSafeRow);
}
