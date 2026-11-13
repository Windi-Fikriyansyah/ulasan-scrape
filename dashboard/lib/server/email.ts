/**
 * Helper modul rendering dan pengiriman email selamat datang & kredensial akun Reach Leads
 */

export type WelcomeEmailParams = {
  name: string;
  email: string;
  password: string;
  loginUrl: string;
};

export type SendEmailResult = {
  success: boolean;
  provider: "render_service" | "resend" | "smtp" | "console_log";
  messageId?: string;
  error?: string;
};

/**
 * Render template email HTML modern & responsif bertema Reach Leads
 */
export function renderWelcomeEmailHtml({ name, email, password, loginUrl }: WelcomeEmailParams): string {
  const safeName = name || "Pelanggan Terhormat";

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Akses Akun Reach Leads Anda</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #F8F9FA;
      color: #172B4D;
      line-height: 1.6;
    }
    .wrapper {
      width: 100%;
      max-width: 600px;
      margin: 0 auto;
      padding: 30px 20px;
    }
    .card {
      background: #FFFFFF;
      border: 2px solid #172B4D;
      border-radius: 8px;
      padding: 36px 32px;
      box-shadow: 4px 4px 0px #172B4D;
    }
    .badge {
      display: inline-block;
      background-color: #F5C518;
      color: #172B4D;
      font-weight: 800;
      font-size: 13px;
      padding: 4px 10px;
      border-radius: 4px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 26px;
      margin-top: 0;
      margin-bottom: 12px;
      color: #172B4D;
      line-height: 1.2;
    }
    p {
      margin: 0 0 16px 0;
      font-size: 15px;
      color: #333333;
    }
    .credentials-box {
      background-color: #F4F5F7;
      border-left: 4px solid #172B4D;
      padding: 18px 20px;
      margin: 24px 0;
      border-radius: 0 6px 6px 0;
    }
    .cred-row {
      margin-bottom: 8px;
      font-size: 15px;
    }
    .cred-row:last-child {
      margin-bottom: 0;
    }
    .cred-label {
      font-weight: 700;
      color: #5E6C84;
      display: inline-block;
      width: 110px;
    }
    .cred-value {
      font-family: 'Courier New', Courier, monospace;
      font-size: 16px;
      font-weight: 700;
      color: #172B4D;
    }
    .btn {
      display: inline-block;
      background-color: #172B4D;
      color: #FFFFFF !important;
      font-size: 16px;
      font-weight: 700;
      text-decoration: none;
      padding: 12px 28px;
      border-radius: 4px;
      margin: 16px 0 24px 0;
      text-align: center;
    }
    .info-list {
      background: #FFFBE6;
      border: 1px solid #FFE58F;
      border-radius: 6px;
      padding: 16px 20px;
      margin-top: 20px;
      font-size: 14px;
    }
    .info-list ul {
      margin: 8px 0 0 0;
      padding-left: 20px;
    }
    .info-list li {
      margin-bottom: 6px;
    }
    .footer {
      text-align: center;
      margin-top: 28px;
      font-size: 12px;
      color: #7A869A;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="badge">REACH LEADS</div>
      <h1>Halo, ${safeName}!</h1>
      <p>Terima kasih atas pembelian lisensi <strong>Reach Leads</strong>. Akun Anda telah berhasil dibuat secara otomatis dan siap untuk digunakan.</p>

      <div class="credentials-box">
        <div class="cred-row">
          <span class="cred-label">Email:</span>
          <span class="cred-value">${email}</span>
        </div>
        <div class="cred-row">
          <span class="cred-label">Kata Sandi:</span>
          <span class="cred-value">${password}</span>
        </div>
      </div>

      <div style="text-align: center;">
        <a href="${loginUrl}" class="btn" target="_blank">Masuk ke Dashboard Reach Leads</a>
      </div>

      <div class="info-list">
        <strong>Langkah Pertama Anda:</strong>
        <ul>
          <li>Masuk menggunakan email dan kata sandi di atas.</li>
          <li>Unduh dan aktifkan ekstensi browser <strong>Reach Leads Bridge</strong> melalui menu yang tersedia.</li>
          <li>Anda dapat mengganti kata sandi kapan saja di menu <strong>Kelola Akun</strong>.</li>
        </ul>
      </div>

      <p style="margin-top: 24px; font-size: 13px; color: #5E6C84;">
        Jika Anda mengalami kendala saat masuk, silakan balas email ini atau hubungi tim dukungan kami.
      </p>
    </div>

    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} Reach Leads. Hak Cipta Dilindungi.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Render versi teks polos (plain text) untuk fallback email client
 */
export function renderWelcomeEmailText({ name, email, password, loginUrl }: WelcomeEmailParams): string {
  const safeName = name || "Pelanggan Terhormat";
  return `Halo ${safeName},

Terima kasih atas pembelian lisensi Reach Leads.
Akun Anda telah berhasil dibuat secara otomatis:

Email: ${email}
Kata Sandi: ${password}

Tautan Masuk:
${loginUrl}

Langkah Selanjutnya:
1. Masuk menggunakan email dan kata sandi di atas.
2. Unduh ekstensi browser Reach Leads Bridge.
3. Anda dapat mengganti kata sandi di menu Kelola Akun.

© ${new Date().getFullYear()} Reach Leads`;
}

/**
 * Mengirim email selamat datang dengan kredensial pembeli
 * Mendukung:
 * 1. Webhook / Microservice Render.com (jika RENDER_EMAIL_URL diset)
 * 2. Resend API (jika RESEND_API_KEY diset)
 * 3. Log Console (fallback aman saat testing lokal)
 */
export async function sendWelcomeEmail(params: WelcomeEmailParams): Promise<SendEmailResult> {
  const html = renderWelcomeEmailHtml(params);
  const text = renderWelcomeEmailText(params);
  const subject = "Detail Akun & Akses Masuk Reach Leads Anda";

  // 1. Opsi A: Kirim via Render Email Webhook / Service
  const renderEmailUrl = process.env.RENDER_EMAIL_URL;
  if (renderEmailUrl) {
    try {
      const renderSecret = process.env.RENDER_EMAIL_SECRET || process.env.API_SECRET_KEY || "";
      const res = await fetch(renderEmailUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(renderSecret ? { Authorization: `Bearer ${renderSecret}`, "X-Render-Secret": renderSecret } : {}),
        },
        body: JSON.stringify({
          to: params.email,
          name: params.name,
          subject,
          html,
          text,
          credentials: {
            email: params.email,
            password: params.password,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[Email Service Render] Gagal kirim email: HTTP ${res.status} - ${errText}`);
        return { success: false, provider: "render_service", error: errText };
      }

      const data = await res.json().catch(() => ({}));
      return { success: true, provider: "render_service", messageId: data.id || data.messageId };
    } catch (err: any) {
      console.error("[Email Service Render] Error:", err);
      return { success: false, provider: "render_service", error: err.message };
    }
  }

  // 2. Opsi B: Kirim via Resend API
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      const fromEmail = process.env.RESEND_FROM || process.env.EMAIL_FROM || "Reach Leads <onboarding@resend.dev>";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [params.email],
          subject,
          html,
          text,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.warn("[Resend] Gagal kirim email:", data);
        return { success: false, provider: "resend", error: data.message || "Gagal kirim via Resend" };
      }

      return { success: true, provider: "resend", messageId: data.id };
    } catch (err: any) {
      console.error("[Resend] Error:", err);
      return { success: false, provider: "resend", error: err.message };
    }
  }

  // 3. Opsi C: Fallback mode console log (berguna saat pengujian sebelum API key diset)
  console.log("--------------------------------------------------");
  console.log(`[Email Service] Simulasi pengiriman email ke: ${params.email}`);
  console.log(`Subject: ${subject}`);
  console.log(`Password: ${params.password}`);
  console.log(`Login URL: ${params.loginUrl}`);
  console.log("--------------------------------------------------");

  return {
    success: true,
    provider: "console_log",
  };
}

