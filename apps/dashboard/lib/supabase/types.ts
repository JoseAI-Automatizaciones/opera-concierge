/**
 * Supabase row types for Opera Concierge.
 *
 * Keep these in sync with `supabase/migrations/*`. When the schema changes,
 * regenerate via `supabase gen types typescript --project-id <ref>` and replace.
 */

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
>;

export function toPublicConfig(row: WidgetRow): PublicWidgetConfig {
  return {
    id: row.id,
    name: row.name,
    primary_color: row.primary_color,
    position: row.position,
    voice: row.voice,
    max_session_seconds: row.max_session_seconds,
  };
}
