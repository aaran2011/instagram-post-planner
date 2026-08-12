// Minimal email sender for password-reset codes, via Resend's HTTP API
// (no dependency — just fetch). Configure with RESEND_API_KEY.

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendResetCode(to: string, code: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error(
      "Password-reset email isn't configured. Add RESEND_API_KEY (and optionally MAIL_FROM) in your environment.",
    );
  }
  const from = process.env.MAIL_FROM || "Instagram Planner <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: "Your Instagram Planner password reset code",
      html: `
        <div style="font-family:system-ui,Arial,sans-serif;max-width:420px">
          <h2 style="margin:0 0 8px">Password reset</h2>
          <p style="color:#444;margin:0 0 16px">Use this code to reset your Instagram Planner password:</p>
          <div style="font-size:30px;font-weight:700;letter-spacing:6px;background:#f3f7fd;border:1px solid #e2ecf7;border-radius:10px;padding:14px;text-align:center;color:#2563eb">${code}</div>
          <p style="color:#888;margin:16px 0 0;font-size:13px">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
        </div>`,
      text: `Your Instagram Planner password reset code is ${code}. It expires in 10 minutes.`,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error("Could not send the email: " + t.slice(0, 180));
  }
}
