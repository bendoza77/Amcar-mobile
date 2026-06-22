const nodemailer = require("nodemailer");

const isConfigured = () =>
    Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);

const transporter = () =>
    nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT) || 587,
        secure: Number(process.env.EMAIL_PORT) === 465,
        auth: {
            user: process.env.EMAIL_USER,
            // Gmail shows App Passwords in groups ("abcd efgh ijkl mnop");
            // strip whitespace so a direct paste authenticates either way.
            pass: (process.env.EMAIL_PASS || "").replace(/\s+/g, "")
        }
    });

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

    await transporter().sendMail({
        from: process.env.EMAIL_FROM || `Amcar <${process.env.EMAIL_USER}>`,
        to,
        subject: `${code} is your Amcar code`,
        text: `Your Amcar verification code is ${code}. It expires in 10 minutes.`,
        html
    });
};

module.exports = { sendOtpEmail, isConfigured };
