require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
const { Resend } = require("resend");
const crypto = require("crypto");

const app = express();


// Serve landing page as homepage
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/landing.html");
});

// Serve the tool at /tool
app.get("/tool", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.static(__dirname));

// ── Database ─────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  // Create table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      verified BOOLEAN DEFAULT FALSE,
      verification_token VARCHAR(255),
      verification_expires TIMESTAMP,
      tier VARCHAR(20) DEFAULT 'free',
      analyses_used INTEGER DEFAULT 0,
      analyses_limit INTEGER DEFAULT 1,
      billing_period_start TIMESTAMP,
      stripe_customer_id VARCHAR(255),
      stripe_subscription_id VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Migrate existing tables (safe to run on existing DB)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255)`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMP`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255)`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMP`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_login BOOLEAN DEFAULT TRUE`);
  console.log("Database klaar");
}

// ── Services ─────────────────────────────────────────────────────
const stripeClient = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-this";
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const FROM_EMAIL = process.env.FROM_EMAIL || "ListingPro <noreply@listingpro.nl>";

// ── Email ─────────────────────────────────────────────────────────
async function sendVerificationEmail(email, token) {
  const verifyUrl = APP_URL + "/api/verify?token=" + token;

  // Dev mode: log to console if Resend not configured
  if (!resend) {
    console.log("\n=== VERIFICATIELINK (ontwikkelmodus) ===");
    console.log(verifyUrl);
    console.log("========================================\n");
    return;
  }

  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Verifieer je e-mailadres — ListingPro",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;background:#fff">
        <div style="margin-bottom:24px">
          <span style="font-size:16px;font-weight:600">ListingPro</span>
          <span style="color:#9c9a92;font-size:14px;margin-left:6px">bol.com optimizer</span>
        </div>
        <h2 style="font-size:20px;font-weight:600;margin-bottom:8px;color:#1a1a18">Welkom bij ListingPro</h2>
        <p style="color:#5c5b56;margin-bottom:24px;line-height:1.6">Klik op de knop hieronder om je e-mailadres te bevestigen en je gratis analyse te starten.</p>
        <a href="${verifyUrl}" style="display:inline-block;background:#1a1a18;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 28px;font-size:14px;font-weight:500">E-mailadres bevestigen</a>
        <p style="color:#9c9a92;font-size:12px;margin-top:32px;line-height:1.5">Deze link is 24 uur geldig.<br>Heb je je niet aangemeld bij ListingPro? Dan kun je deze e-mail negeren.</p>
      </div>
    `
  });
}

async function sendPasswordResetEmail(email, token) {
  const resetUrl = APP_URL + "/reset-password.html?token=" + token;
  if (!resend) {
    console.log("\n=== WACHTWOORD RESET LINK ===");
    console.log(resetUrl);
    console.log("=============================\n");
    return;
  }
  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Wachtwoord resetten — ProListing",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;background:#fff">
        <div style="margin-bottom:24px"><span style="font-size:16px;font-weight:600">ProListing</span></div>
        <h2 style="font-size:20px;font-weight:600;margin-bottom:8px;color:#1a1a18">Wachtwoord resetten</h2>
        <p style="color:#5c5b56;margin-bottom:24px;line-height:1.6">Je hebt een wachtwoordreset aangevraagd. Klik op de knop hieronder om een nieuw wachtwoord in te stellen.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#1a1a18;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 28px;font-size:14px;font-weight:500">Nieuw wachtwoord instellen</a>
        <p style="color:#9c9a92;font-size:12px;margin-top:32px;line-height:1.5">Deze link is 1 uur geldig.<br>Heb je geen reset aangevraagd? Dan kun je deze e-mail negeren.</p>
      </div>
    `
  });
}

async function sendWelcomeEmail(email) {
  if (!resend) return;
  await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Welkom bij ProListing — zo haal je het meeste eruit",
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:40px 24px;background:#fff">
        <div style="margin-bottom:24px"><span style="font-size:16px;font-weight:600">ProListing</span></div>
        <h2 style="font-size:20px;font-weight:600;margin-bottom:8px;color:#1a1a18">Welkom bij ProListing!</h2>
        <p style="color:#5c5b56;margin-bottom:16px;line-height:1.6">Je account is geactiveerd. Je hebt 1 gratis analyse om de tool te proberen.</p>
        <p style="color:#5c5b56;margin-bottom:8px;font-weight:500">Zo haal je het meeste uit je eerste analyse:</p>
        <ul style="color:#5c5b56;margin-bottom:24px;padding-left:20px;line-height:1.8">
          <li>Plak je volledige bestaande titel, bullets én beschrijving in</li>
          <li>Hoe meer informatie je geeft, hoe beter de output</li>
          <li>Vul ontbrekende specs in via de invulvelden na de analyse</li>
        </ul>
        <a href="${APP_URL}/tool" style="display:inline-block;background:#1a1a18;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 28px;font-size:14px;font-weight:500">Start je eerste analyse</a>
        <p style="color:#9c9a92;font-size:12px;margin-top:32px">Vragen? Mail naar info@prolisting.nl</p>
      </div>
    `
  });
}

// ── Middleware ────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || "").split(" ")[1];
  if (!token) return res.status(401).json({ error: "Niet ingelogd" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Sessie verlopen, log opnieuw in" });
  }
}

async function checkUsage(req, res, next) {
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Gebruiker niet gevonden" });

    // Must be verified
    if (!user.verified) {
      return res.status(403).json({ error: "Verifieer eerst je e-mailadres via de link in je inbox" });
    }

    // Auto-reset monthly counter for starter plan
    if (user.tier === "starter" && user.billing_period_start) {
      const resetAt = new Date(user.billing_period_start);
      resetAt.setMonth(resetAt.getMonth() + 1);
      if (new Date() > resetAt) {
        await pool.query("UPDATE users SET analyses_used = 0, billing_period_start = NOW() WHERE id = $1", [user.id]);
        user.analyses_used = 0;
      }
    }

    // Check limit (pro = unlimited)
    if (user.tier !== "pro" && user.analyses_used >= user.analyses_limit) {
      return res.status(402).json({
        error: "Limiet bereikt",
        tier: user.tier,
        used: user.analyses_used,
        limit: user.analyses_limit
      });
    }

    req.dbUser = user;
    next();
  } catch (err) {
    res.status(500).json({ error: "Database fout: " + err.message });
  }
}

// ── Auth routes ───────────────────────────────────────────────────
app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: "Geldig e-mailadres en wachtwoord van minimaal 8 tekens vereist" });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { rows } = await pool.query(
      "INSERT INTO users (email, password_hash, verification_token, verification_expires) VALUES ($1, $2, $3, $4) RETURNING id, email, tier, analyses_used, analyses_limit, verified",
      [email.toLowerCase().trim(), hash, token, expires]
    );
    const user = rows[0];

    try { await sendVerificationEmail(email, token); } catch(e) { console.error("Email fout:", e.message); }

    const jwtToken = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token: jwtToken, user });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Dit e-mailadres is al geregistreerd" });
    res.status(500).json({ error: "Registratie mislukt, probeer opnieuw" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email?.toLowerCase().trim()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
      return res.status(401).json({ error: "E-mailadres of wachtwoord klopt niet" });
    }
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user.id, email: user.email, tier: user.tier, analyses_used: user.analyses_used, analyses_limit: user.analyses_limit, verified: user.verified } });
  } catch (err) {
    res.status(500).json({ error: "Inloggen mislukt" });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, email, tier, analyses_used, analyses_limit, verified FROM users WHERE id = $1",
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Niet gevonden" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/resend-verification", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "Niet gevonden" });
    if (user.verified) return res.json({ ok: true });

    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query("UPDATE users SET verification_token = $1, verification_expires = $2 WHERE id = $3", [token, expires, user.id]);
    await sendVerificationEmail(user.email, token);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Email verification ────────────────────────────────────────────
app.get("/api/verify", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect("/?verify_error=1");
  try {
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE verification_token = $1 AND verification_expires > NOW()",
      [token]
    );
    if (!rows[0]) return res.redirect("/?verify_error=1");
    await pool.query(
      "UPDATE users SET verified = TRUE, verification_token = NULL, verification_expires = NULL WHERE id = $1",
      [rows[0].id]
    );
    res.redirect("/?verified=1");
  } catch (err) {
    res.redirect("/?verify_error=1");
  }
});

// ── Stripe routes ─────────────────────────────────────────────────
app.post("/api/stripe/create-checkout", requireAuth, async (req, res) => {
  if (!stripeClient) return res.status(500).json({ error: "Stripe is niet geconfigureerd. Voeg STRIPE_SECRET_KEY toe aan .env" });
  const { plan } = req.body || {};
  const priceIds = { starter: process.env.STRIPE_PRICE_STARTER, pro: process.env.STRIPE_PRICE_PRO };
  const priceId = priceIds[plan];
  if (!priceId) return res.status(400).json({ error: "Ongeldig plan" });

  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = rows[0];
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripeClient.customers.create({ email: user.email });
      customerId = customer.id;
      await pool.query("UPDATE users SET stripe_customer_id = $1 WHERE id = $2", [customerId, user.id]);
    }
    const session = await stripeClient.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: APP_URL + "/success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: APP_URL + "/",
      metadata: { userId: user.id.toString(), plan }
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/stripe/webhook", async (req, res) => {
  if (!stripeClient) return res.status(400).send("Stripe niet geconfigureerd");
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripeClient.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).send("Webhook signature ongeldig");
  }
  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      const userId = parseInt(s.metadata?.userId);
      const plan = s.metadata?.plan;
      if (userId && plan) {
        await pool.query(
          "UPDATE users SET tier=$1, analyses_limit=$2, analyses_used=0, stripe_subscription_id=$3, billing_period_start=NOW() WHERE id=$4",
          [plan, plan === "pro" ? 999999 : 15, s.subscription, userId]
        );
      }
    }
    if (event.type === "invoice.payment_succeeded") {
      const s = event.data.object;
      if (s.subscription) {
        await pool.query(
          "UPDATE users SET analyses_used=0, billing_period_start=NOW() WHERE stripe_subscription_id=$1 AND tier!='pro'",
          [s.subscription]
        );
      }
    }
    if (event.type === "customer.subscription.deleted") {
      const s = event.data.object;
      await pool.query(
        "UPDATE users SET tier='free', analyses_limit=1, analyses_used=0, stripe_subscription_id=NULL WHERE stripe_subscription_id=$1",
        [s.id]
      );
    }
  } catch (err) {
    console.error("Webhook fout:", err.message);
  }
  res.json({ received: true });
});

// ── Password reset routes ────────────────────────────────────────
app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "E-mailadres vereist" });
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase().trim()]);
    // Always return success to prevent email enumeration
    if (rows[0]) {
      const token = crypto.randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await pool.query("UPDATE users SET reset_token = $1, reset_expires = $2 WHERE id = $3", [token, expires, rows[0].id]);
      try { await sendPasswordResetEmail(email, token); } catch(e) { console.error("Reset email fout:", e.message); }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Fout bij verwerken verzoek" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 8) {
    return res.status(400).json({ error: "Ongeldig verzoek of wachtwoord te kort" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE reset_token = $1 AND reset_expires > NOW()", [token]
    );
    if (!rows[0]) return res.status(400).json({ error: "Link is verlopen of ongeldig" });
    const hash = await bcrypt.hash(password, 10);
    await pool.query("UPDATE users SET password_hash = $1, reset_token = NULL, reset_expires = NULL WHERE id = $2", [hash, rows[0].id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Fout bij opslaan wachtwoord" });
  }
});

// ── Account route ─────────────────────────────────────────────────
app.get("/api/account", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, email, tier, analyses_used, analyses_limit, verified, billing_period_start, created_at FROM users WHERE id = $1",
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Niet gevonden" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/account/cancel", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "Niet gevonden" });
    if (user.stripe_subscription_id && stripeClient) {
      await stripeClient.subscriptions.update(user.stripe_subscription_id, { cancel_at_period_end: true });
    }
    res.json({ ok: true, message: "Abonnement wordt opgezegd aan het einde van de betaalperiode" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send welcome email on first verified login
app.post("/api/auth/welcome", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = rows[0];
    if (user && user.first_login && user.verified) {
      await pool.query("UPDATE users SET first_login = FALSE WHERE id = $1", [user.id]);
      try { await sendWelcomeEmail(user.email); } catch(e) {}
    }
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: true });
  }
});

// ── Analyze route ─────────────────────────────────────────────────
app.post("/api/analyze", requireAuth, checkUsage, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY niet ingesteld" });
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    if (!data.error) {
      await pool.query("UPDATE users SET analyses_used = analyses_used + 1 WHERE id = $1", [req.dbUser.id]);
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────
initDB()
  .then(() => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log("ListingPro draait op http://localhost:" + PORT));
  })
  .catch(err => { console.error("Database init mislukt:", err.message); process.exit(1); });
