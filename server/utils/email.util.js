// OTP email delivery via Resend's HTTPS API.
//
// We send over HTTPS (api.resend.com:443) rather than SMTP because cloud
// hosts like Render block outbound SMTP ports (25/465/587), which made the
// old nodemailer/Gmail path hang and fail on the deployed server. HTTPS is
// never blocked, so this works both locally and on Render.

const RESEND_API_URL = "https://api.resend.com/emails";

// Resend won't send from an unverified address. Until you verify your own
// domain in the Resend dashboard, you must use their shared sender
// `onboarding@resend.dev` — and it can only deliver to the email you signed
// up to Resend with. To send OTPs to ANY user, verify a domain and set
// RESEND_FROM to an address on it (e.g. "Amcar <noreply@yourdomain.com>").
const FROM = process.env.RESEND_FROM || "Amcar <onboarding@resend.dev>";

const isConfigured = () => Boolean(process.env.RESEND_API_KEY);

const sendOtpEmail = async (to, code) => {
    const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#F8FAFC;padding:32px">
        <div style="max-width:440px;margin:0 auto;background:#FFFFFF;border-radius:16px;padding:32px;border:1px solid #E5E7EB">
            <h2 style="margin:0 0 8px;color:#111827">Amcar</h2>
            <p style="margin:0 0 24px;color:#6B7280;font-size:14px">
                Use this code to sign in. It expires in 10 minutes.
            </p>
            <div style="text-align:center;background:#EFF4FF;border-radius:12px;padding:20px">
                <span style="font-size:36px;font-weight:700;letter-spacing:12px;color:#2563EB">${code}</span>
            </div>
            <p style="margin:24px 0 0;color:#9CA3AF;font-size:12px">
                If you didn't request this code, you can safely ignore this email.
            </p>
        </div>
    </div>`;

    const res = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: FROM,
            to: [to],
            subject: `${code} is your Amcar code`,
            text: `Your Amcar verification code is ${code}. It expires in 10 minutes.`,
            html
        }),
        // Fail fast rather than holding the request open if Resend is slow.
        signal: AbortSignal.timeout(15_000)
    });

    if (!res.ok) {
        // Surface Resend's error body (bad key, unverified recipient, etc.)
        // so it lands in the server logs instead of a generic failure.
        const detail = await res.text().catch(() => "");
        throw new Error(`Resend API ${res.status}: ${detail}`);
    }
};

module.exports = { sendOtpEmail, isConfigured };
