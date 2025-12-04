const CLIENT_EMAILS = {
  sitrixx: "sitrixx1@gmail.com",
  moizkhan: "moizkhan_007@hotmail.com",
  // add more clients here
};

module.exports = async (req, res) => {
  // --- CORS headers ---
  res.setHeader("Access-Control-Allow-Origin", "*"); // you can restrict later
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  // 1) CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // 2) Simple health check
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "Contact endpoint is live. Use POST to send form data.",
    });
  }

  // 3) Only POST is allowed for sending
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { Resend } = require("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const clientKey = req.query.client || "sitrixx";
    const toEmail = CLIENT_EMAILS[clientKey];

    if (!toEmail) {
      return res.status(400).json({ ok: false, error: "Unknown client" });
    }

    const { name, email, phone, message, service } = req.body || {};

    if (!email || !name) {
      return res
        .status(400)
        .json({ ok: false, error: "Name and email are required" });
    }

    const LOGO_URL =
      "https://raw.githubusercontent.com/MoizMasud/sitrixx-website/main/public/favicon.png";

    const html = `
      <div style="
        font-family: Arial, sans-serif;
        max-width: 520px;
        margin: 0 auto;
        padding: 20px;
        background: #ffffff;
        border-radius: 12px;
        border: 1px solid #e5e7eb;
      ">

        <!-- Logo -->
        <div style="text-align:center; margin-bottom:20px;">
          <img 
            src="${LOGO_URL}"
            alt="Sitrixx"
            width="120"
            style="border-radius:6px; display:block; margin:0 auto;"
          />
        </div>

        <h2 style="color: #6C3EF8; margin-bottom: 16px;">
          🚀 New Lead from Sitrixx Website
        </h2>

        <p style="font-size: 15px; color: #444; margin-bottom: 20px;">
          A new visitor contacted you through your site. Here are the details:
        </p>

        <div style="
          background: #f9f9ff;
          padding: 16px;
          border-radius: 10px;
          border: 1px solid #ececff;
        ">
          <p><strong>Client:</strong> ${clientKey}</p>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> 
            <a href="mailto:${email}" style="color:#6C3EF8;">${email}</a>
          </p>
          <p><strong>Phone:</strong> ${phone || "Not provided"}</p>
          <p><strong>Service:</strong> ${service || "Not specified"}</p>

          <p><strong>Message:</strong></p>
          <p style="
            white-space: pre-line;
            margin-top: 6px;
            border-left: 3px solid #6C3EF8;
            padding-left: 10px;
          ">
            ${message || ""}
          </p>
        </div>

        <p style="margin-top: 25px; font-size: 13px; color: #777;">
          Hit reply to respond directly to this lead.
        </p>
      </div>
    `;

    const result = await resend.emails.send({
      from: "Leads <leads@sitrixx.com>",
      to: toEmail,
      reply_to: email,
      subject: `New lead from ${clientKey} website`,
      html,
    });

    console.log("Resend result:", result);

    if (result?.error) {
      return res.status(500).json({ ok: false, error: result.error });
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to send email",
      detail: err.message,
    });
  }
};
