const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// Map client keys -> destination emails
const CLIENT_EMAILS = {
  sitrixx: "sitrixx1@gmail.com",
  moizkhan: "moizkhan_007@hotmail.com",
  // add more clients here
};

module.exports = async (req, res) => {
  // --- CORS headers (allow Webflow + your live domain to call this) ---
  res.setHeader("Access-Control-Allow-Origin", "*"); // or restrict to specific domains
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Allow a quick browser check with GET
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "Contact endpoint is live. Use POST to send form data.",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
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

