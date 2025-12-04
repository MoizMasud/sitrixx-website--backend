const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const CLIENT_EMAILS = {
  sitrixx: "sitrixx1@gmail.com",
  moizkhan: "moizkhan_007@hotmail.com",
  // add more clients here
};

module.exports = async (req, res) => {
  // --- CORS headers ---
  res.setHeader("Access-Control-Allow-Origin", "*"); // later we can lock to your domain
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  // 1) Handle CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // 2) Simple GET check in the browser
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "Contact endpoint is live. Use POST to send form data.",
    });
  }

  // 3) Only allow POST for sending emails
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Lazy-load Resend *only when needed* (POST)
    const { Resend } = require("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const clientKey = req.query.client || "sitrixx";
    const toEmail = CLIENT_EMAILS[clientKey];

    if (!toEmail) {
      return res.status(400).json({ error: "Unknown client" });
    }

    const { name, email, phone, message, service } = req.body || {};

    if (!email || !name) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    const subject = `New lead from ${clientKey} website`;
    const html = `
      <h2>New website lead</h2>
      <p><strong>Client:</strong> ${clientKey}</p>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ""}
      ${service ? `<p><strong>Service:</strong> ${service}</p>` : ""}
      <p><strong>Message:</strong></p>
      <p>${(message || "").replace(/\n/g, "<br>")}</p>
    `;

    await resend.emails.send({
      from: "Leads <leads@sitrixx.com>",
      to: toEmail,
      subject,
      html,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to send email" });
  }
};
