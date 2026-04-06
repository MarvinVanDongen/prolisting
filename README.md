# ListingPro — Deployment handleiding

## Lokaal testen (met auth)

Je hebt nu een database nodig. Makkelijkste optie: Railway gratis tier.

### Stap 1 — Database aanmaken op Railway
1. Ga naar railway.app → New Project → Database → PostgreSQL
2. Klik op de database → Variables → kopieer DATABASE_URL
3. Zet hem in je .env bestand

### Stap 2 — Stripe instellen
1. Ga naar stripe.com → maak een account aan
2. Activeer testmodus (toggle rechtsboven)
3. Ga naar Products → Add product:
   - Naam: "ListingPro Starter" → Price: €19/month recurring → Kopieer Price ID → zet in .env als STRIPE_PRICE_STARTER
   - Naam: "ListingPro Pro" → Price: €49/month recurring → Kopieer Price ID → zet in .env als STRIPE_PRICE_PRO
4. Ga naar Developers → API keys → kopieer Secret key → zet in .env als STRIPE_SECRET_KEY
5. Stripe webhook instellen: zie stap hieronder

### Stap 3 — JWT secret genereren
Open een terminal en run:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Zet de output in .env als JWT_SECRET.

### Stap 4 — Lokaal opstarten
```bash
npm install
npm start
```
Open http://localhost:3000

---

## Online zetten via Railway

### Stap 1 — GitHub repository
```bash
git init
git add .
git commit -m "ListingPro v1.0"
git branch -M main
git remote add origin https://github.com/JOUWUSERNAME/listingpro.git
git push -u origin main
```

### Stap 2 — Railway project aanmaken
1. Ga naar railway.app → New Project → Deploy from GitHub
2. Selecteer je listingpro repository
3. Railway detecteert Node.js automatisch

### Stap 3 — PostgreSQL toevoegen
In je Railway project → New Service → Database → PostgreSQL
Railway koppelt DATABASE_URL automatisch aan je app.

### Stap 4 — Environment variables instellen
In Railway → je app service → Variables → voeg toe:
```
ANTHROPIC_API_KEY    = sk-ant-...
JWT_SECRET           = (jouw gegenereerde string)
STRIPE_SECRET_KEY    = sk_live_... (of sk_test_... voor testen)
STRIPE_WEBHOOK_SECRET = whsec_... (zie hieronder)
STRIPE_PRICE_STARTER = price_...
STRIPE_PRICE_PRO     = price_...
APP_URL              = https://jouw-app.up.railway.app
```

### Stap 5 — Domein ophalen
In Railway → Settings → Domains → Generate Domain
Kopieer de URL (bijv. listingpro.up.railway.app) → zet als APP_URL

### Stap 6 — Stripe webhook instellen
1. In Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Endpoint URL: https://jouw-app.up.railway.app/api/stripe/webhook
3. Events selecteren: checkout.session.completed, invoice.payment_succeeded, customer.subscription.deleted
4. Kopieer Signing secret → zet in Railway als STRIPE_WEBHOOK_SECRET

### Stap 7 — Deploy
Railway deployt automatisch bij elke git push.
```bash
git add . && git commit -m "update" && git push
```

---

## Abonnementen

| Tier     | Analyses    | Prijs        |
|----------|-------------|--------------|
| Gratis   | 3 totaal    | Gratis       |
| Starter  | 50/maand    | €19/maand    |
| Pro      | Onbeperkt   | €49/maand    |

Maandlimieten resetten automatisch op de verlengtdatum via Stripe webhook.

## Testen met Stripe
Gebruik testkaartnummer: 4242 4242 4242 4242
Vervaldatum: willekeurig in de toekomst, CVC: willekeurig 3 cijfers
