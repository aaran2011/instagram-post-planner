// Centralized environment access + "is this configured?" helpers.
// Nothing here is ever sent to the client except the boolean `configStatus`.

export const config = {
  appEmail: process.env.APP_EMAIL || "you@example.com",
  appPassword: process.env.APP_PASSWORD || "changeme",
  sessionSecret:
    process.env.SESSION_SECRET ||
    "dev-insecure-session-secret-change-me-please-0123456789",

  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",

  // Public base URL Instagram can reach to fetch media (required for real
  // publishing — Instagram pulls the image/video from a public URL).
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",

  ig: {
    // "Instagram API with Instagram Login" credentials (Instagram app id/secret).
    // No Facebook Page is required with this flow. META_* names are accepted as
    // a fallback for older configs.
    appId: process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID || "",
    appSecret: process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || "",
    redirectUri:
      process.env.INSTAGRAM_REDIRECT_URI ||
      process.env.META_REDIRECT_URI ||
      "http://localhost:4321/api/instagram/callback",
    // A long-lived Instagram token can be provided directly to skip OAuth.
    manualToken: process.env.IG_ACCESS_TOKEN || "",
    manualUserId: process.env.IG_USER_ID || "",
  },
};

export function aiConfigured() {
  return Boolean(config.anthropicKey);
}

export function instagramConfigured() {
  return Boolean(
    (config.ig.appId && config.ig.appSecret) || config.ig.manualToken,
  );
}

export function usingDefaultSecret() {
  return !process.env.SESSION_SECRET;
}

// A client-safe summary of what still needs configuring.
export function configStatus() {
  return {
    ai: aiConfigured(),
    instagram: instagramConfigured(),
    instagramOAuth: Boolean(config.ig.appId && config.ig.appSecret),
    instagramManualToken: Boolean(config.ig.manualToken),
    defaultCredentials:
      !process.env.APP_PASSWORD || !process.env.APP_EMAIL,
    defaultSessionSecret: usingDefaultSecret(),
  };
}
