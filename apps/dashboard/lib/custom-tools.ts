import { z } from "zod";

/**
 * Validation for operator-defined custom tools. Two things matter here:
 *
 * 1. Schema integrity — names must be valid JS identifiers compatible with
 *    OpenAI's tools API, descriptions/params can't be unbounded, the
 *    endpoint MUST be HTTPS (no http://, no data:, no file:, etc.).
 *
 * 2. SSRF defense — even with HTTPS we refuse loopback, link-local, and
 *    RFC1918 hostnames at config-write time. The proxy route re-checks at
 *    request time in case DNS for the host returns a private IP.
 */

export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** Names reserved by the built-in DOM toolset. The widget's session.update
 *  always advertises these; allowing an operator to define a tool with
 *  the same name would either shadow the built-in (broken UX) or cause
 *  some Realtime clients to reject the session for duplicate tool names. */
const RESERVED_TOOL_NAMES = new Set([
  "find_elements",
  "click_element",
  "fill_field",
  "scroll_to_element",
  "read_page",
  "navigate_to",
]);

const PRIVATE_HOST_PATTERN =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc00:|fd00:)/i;

export const customToolSchema = z
  .object({
    name: z
      .string()
      .regex(TOOL_NAME_PATTERN, "Tool name must be snake_case (a-z, 0-9, _), start with a letter, 1-40 chars.")
      .refine((n) => !RESERVED_TOOL_NAMES.has(n), {
        message: "Tool name is reserved (collides with a built-in DOM tool).",
      }),
    description: z.string().min(1).max(500),
    // JSON Schema for the function's parameters. We don't deeply validate
    // the schema shape — OpenAI is the consumer. We DO require it to be an
    // object so the model knows it's calling with named keys.
    parameters: z
      .object({
        type: z.literal("object"),
      })
      .passthrough(),
    endpoint: z
      .string()
      .url()
      .max(2048)
      .refine((u) => {
        try {
          const parsed = new URL(u);
          if (parsed.protocol !== "https:") return false;
          if (PRIVATE_HOST_PATTERN.test(parsed.hostname)) return false;
          return true;
        } catch {
          return false;
        }
      }, "Endpoint must be https:// and not a loopback / RFC1918 host."),
    method: z.literal("POST").default("POST"),
    // 4096 covers Bearer + long JWTs (3K is common, some go higher with
    // custom claims). The proxy forwards verbatim; we just need a sane
    // ceiling to bound DB row size.
    auth_header: z.string().min(1).max(4096).optional(),
    timeout_ms: z.coerce.number().int().min(100).max(30000).optional(),
  })
  .strict();

export const customToolsArraySchema = z
  .array(customToolSchema)
  .max(32)
  .refine(
    (tools) => new Set(tools.map((t) => t.name)).size === tools.length,
    "Tool names must be unique within a widget."
  );

export type ValidatedCustomTool = z.infer<typeof customToolSchema>;
