// Which model the AI roles use, and where. Settings, not constants, because model
// names are retired: change AI_MODEL, not the code. Server only.
//
// The roles run on Gemini through Vertex AI. On Cloud Run the service signs in as its
// own service account, so no API key exists anywhere. GOOGLE_CLOUD_PROJECT turns the
// AI on; without it every role answers from its scripted fixture.

export const DEFAULT_MODEL = "gemini-3.8-flash";
/** Tried once when the main model fails, so a retired or overloaded model does not stop the AI. */
export const DEFAULT_FALLBACK_MODEL = "gemini-2.5-flash";

export function aiModel(): string {
  return process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
}

export function aiFallbackModel(): string {
  return process.env.AI_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;
}

/** Vertex location. Gemini 3.8 Flash answers only on "global". */
export function aiLocation(): string {
  return process.env.GOOGLE_CLOUD_LOCATION?.trim() || "global";
}

export function aiProject(): string | undefined {
  return process.env.GOOGLE_CLOUD_PROJECT?.trim() || undefined;
}
