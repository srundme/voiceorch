const SUPPORTED_GOOGLE_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3.1-flash-live-preview",
]);

export function unsupportedAgentModel(
  provider: string | null | undefined,
  model: string | null | undefined,
): string | null {
  const normalizedProvider = provider?.trim().toLowerCase();
  const normalizedModel = model?.trim();
  if (normalizedProvider !== "google" || !normalizedModel) return null;
  return SUPPORTED_GOOGLE_MODELS.has(normalizedModel) ? null : normalizedModel;
}

