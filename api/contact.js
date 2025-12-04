import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// Map client keys -> destination emails
const CLIENT_EMAILS = {
  "sitrixx": "sitrixx1@gmail.com",
  // add more clients here
};

export default async function handler(req, res) {
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

    await resend.emails.send({
      from: "Leads <leads@sitrixx.com>", // or your verified domain
      to: toEmail,
      subject,
      html
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to send email" });
  }
}
