const express = require("express");
const { chromium } = require("playwright");
const dns = require("dns").promises;
const net = require("net");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
const PORT = process.env.PORT || 10000;
const PASSWORD = process.env.PRIVATE_BROWSER_PASSWORD;
const sessions = new Map();
let browser;

// Real Chrome user-agent (keep in sync with Chromium version when possible)
const REAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    return (
      p[0] === 10 ||
      p[0] === 127 ||
      p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      p[0] >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    return (
      x === "::1" ||
      x === "::" ||
      x.startsWith("fc") ||
      x.startsWith("fd") ||
      x.startsWith("fe80:") ||
      x.startsWith("::ffff:127.")
    );
  }
  return true;
}

async function publicHttpUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (net.isIP(host)) return !isPrivateIp(host);
  try {
    const records = await dns.lookup(host, { all: true });
    return records.length > 0 && records.every((r) => !isPrivateIp(r.address));
  } catch {
    return false;
  }
}

function auth(req, res, next) {
  if (!PASSWORD)
    return res.status(503).json({ error: "Le serveur doit être configuré avec PRIVATE_BROWSER_PASSWORD." });
  if (!safeEqual(req.get("x-browser-password"), PASSWORD))
    return res.status(401).json({ error: "Mot de passe incorrect." });
  next();
}

async function getSession(req, res) {
  const id = req.get("x-session-id");
  const s = sessions.get(id);
  if (!s) {
    res.status(404).json({ error: "Session expirée. Recharge la page pour en créer une nouvelle." });
    return null;
  }
  s.lastUsed = Date.now();
  return s;
}

async function newSession() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: REAL_UA,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    colorScheme: "dark",
    acceptDownloads: false,
    // serviceWorkers allowed – needed by many modern sites (ChatGPT, Claude, etc.)
    serviceWorkers: "allow",
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
      "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    },
    // Permissions that help with media sites
    permissions: ["geolocation", "notifications", "microphone", "camera"],
  });

  // Keep the browser environment unmodified so websites can perform their
  // normal security checks. CAPTCHA challenges must be completed by the user.
  const page = await context.newPage();
  const pendingCredentials = [];
  await page.exposeBinding("__privateBrowserCredentialPrompt", (_source, data) => {
    if (!data || typeof data.password !== "string" || !data.password) return;
    const item = {
      site: (() => { try { return new URL(data.url || page.url()).hostname; } catch { return "Site Web"; } })(),
      url: String(data.url || page.url()).slice(0, 2000),
      username: String(data.username || "").slice(0, 500),
      secret: data.password.slice(0, 2000),
      createdAt: Date.now()
    };
    // Keep only the latest few prompts in server memory; never log or persist credentials.
    pendingCredentials.push(item);
    if (pendingCredentials.length > 3) pendingCredentials.shift();
  });
  await page.addInitScript(() => {
    const readForm = (form) => {
      const fields = Array.from(form.querySelectorAll("input"));
      const pass = fields.find(el => el.type === "password" && el.value);
      if (!pass) return;
      const user = fields.find(el => /user|email|login|identifier/i.test((el.name || "") + " " + (el.autocomplete || "") + " " + (el.type || "")) && el.type !== "password");
      window.__privateBrowserCredentialPrompt?.({
        url: location.href,
        username: user?.value || "",
        password: pass.value
      });
    };
    document.addEventListener("submit", event => {
      if (event.target instanceof HTMLFormElement) readForm(event.target);
    }, true);
    document.addEventListener("click", event => {
      const button = event.target?.closest?.('button, input[type="submit"], [role="button"]');
      if (!button) return;
      const form = button.form || button.closest("form") || document.querySelector("form");
      if (form) readForm(form);
    }, true);
  });

  // Block only private / local destinations
  // Validate network destinations while keeping ordinary CAPTCHA resources available.
  // Cache DNS checks briefly to avoid a DNS lookup for every image/script request.
  const hostChecks = new Map();
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) return route.continue();
    let allowed = false;
    try {
      const host = new URL(url).hostname.toLowerCase();
      const cached = hostChecks.get(host);
      if (cached && Date.now() - cached.time < 30000) allowed = cached.allowed;
      else {
        allowed = await publicHttpUrl(url);
        hostChecks.set(host, { allowed, time: Date.now() });
      }
    } catch {}
    if (!allowed) return route.abort("blockedbyclient");
    return route.continue();
  });

  // Start on Google
  await page.goto("https://www.google.com/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});

  const id = crypto.randomUUID();
  const session = { context, page, pendingCredentials, lastUsed: Date.now() };
  sessions.set(id, session);

  // OAuth and account providers often open a separate popup window.
  // Follow that popup in the remote screen instead of leaving the user on the old page.
  context.on("page", (popup) => {
    if (popup === page) return;
    session.page = popup;
    popup.on("close", () => {
      if (session.page === popup && !page.isClosed()) session.page = page;
    });
  });
  return id;
}

app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/api/login", (req, res) => {
  if (!PASSWORD) return res.status(503).json({ error: "Mot de passe serveur non configuré." });
  if (!safeEqual(req.body?.password, PASSWORD)) return res.status(401).json({ error: "Mot de passe incorrect." });
  res.json({ ok: true });
});

app.post("/api/session", auth, async (req, res) => {
  try {
    res.json({ sessionId: await newSession() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Impossible de démarrer Chromium." });
  }
});

app.post("/api/:action", auth, async (req, res) => {
  const s = await getSession(req, res);
  if (!s) return;
  const p = s.page,
    b = req.body || {};
  try {
    if (req.params.action === "navigate") {
      let target = String(b.url || "").trim();
      if (!target) return res.status(400).json({ error: "Adresse vide." });
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) {
        target =
          target.includes(".") && !target.includes(" ")
            ? "https://" + target
            : "https://www.google.com/search?q=" + encodeURIComponent(target);
      }
      if (!(await publicHttpUrl(target)))
        return res.status(400).json({
          error: "Adresse bloquée : seules les adresses Web publiques HTTP/HTTPS sont autorisées.",
        });
      await p.goto(target, { waitUntil: "domcontentloaded", timeout: 45000 });
    } else if (req.params.action === "click") {
      await p.mouse.click(Number(b.x), Number(b.y));
      await p.waitForTimeout(250);
    } else if (req.params.action === "type") {
      await p.keyboard.type(String(b.text || "").slice(0, 2000), { delay: 25 });
    } else if (req.params.action === "key") {
      const allowed = [
        "Enter",
        "Backspace",
        "Tab",
        "Escape",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Control+A",
        "Control+C",
        "Control+V",
        "Control+X",
      ];
      if (allowed.includes(b.key)) await p.keyboard.press(b.key);
    } else if (req.params.action === "scroll") {
      await p.mouse.wheel(0, Math.max(-1200, Math.min(1200, Number(b.delta) || 0)));
    } else if (req.params.action === "back") {
      await p.goBack({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    } else if (req.params.action === "forward") {
      await p.goForward({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    } else if (req.params.action === "reload") {
      await p.reload({ waitUntil: "domcontentloaded", timeout: 25000 });
    } else if (req.params.action === "close") {
      await s.context.close();
      sessions.delete(req.get("x-session-id"));
      return res.json({ closed: true });
    } else return res.status(404).json({ error: "Action inconnue." });
    res.json({ ok: true, url: p.url(), title: await p.title().catch(() => "") });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "La page n'a pas répondu. Réessaie ou vérifie l'adresse." });
  }
});

app.get("/api/credential-prompt", auth, async (req, res) => {
  const s = await getSession(req, res);
  if (!s) return;
  res.set("Cache-Control", "no-store");
  res.json({ prompts: s.pendingCredentials.splice(0).map(item => ({
    site: item.site, url: item.url, username: item.username, secret: item.secret
  })) });
});

app.post("/api/autofill", auth, async (req, res) => {
  const s = await getSession(req, res);
  if (!s) return;
  const username = String(req.body?.username || "").slice(0, 500);
  const secret = String(req.body?.secret || "").slice(0, 2000);
  if (!secret) return res.status(400).json({ error: "Mot de passe manquant." });
  try {
    const result = await s.page.evaluate(({ username, secret }) => {
      const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const pass = Array.from(document.querySelectorAll('input[type="password"]')).find(visible);
      if (!pass) return { ok: false, reason: "Aucun champ de mot de passe visible." };
      const form = pass.form || pass.closest("form") || document;
      const candidates = Array.from(form.querySelectorAll('input:not([type="password"]):not([type="hidden"])')).filter(visible);
      const user = candidates.find(el => /user|email|login|identifier/i.test((el.name || "") + " " + (el.autocomplete || "") + " " + (el.type || ""))) || candidates[0];
      const set = (el, value) => {
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter ? setter.call(el, value) : (el.value = value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      if (username && user) set(user, username);
      set(pass, secret);
      return { ok: true, usernameFilled: !!(username && user) };
    }, { username, secret });
    if (!result.ok) return res.status(404).json({ error: result.reason });
    res.json(result);
  } catch {
    res.status(500).json({ error: "Impossible de remplir ce formulaire." });
  }
});

app.get("/api/screenshot", auth, async (req, res) => {
  const s = await getSession(req, res);
  if (!s) return;
  try {
    const image = await s.page.screenshot({ type: "jpeg", quality: 68, timeout: 10000 });
    res.set("Content-Type", "image/jpeg").set("Cache-Control", "no-store").send(image);
  } catch {
    res.status(502).end();
  }
});

app.get("/api/info", auth, async (req, res) => {
  const s = await getSession(req, res);
  if (!s) return;
  res.set("Cache-Control", "no-store").json({
    url: s.page.url(),
    title: await s.page.title().catch(() => ""),
  });
});

// Cleanup inactive sessions (30 min)
setInterval(async () => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastUsed > 30 * 60 * 1000) {
      await s.context.close().catch(() => {});
      sessions.delete(id);
    }
  }
}, 60 * 1000).unref();

(async () => {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-infobars",
      "--window-size=1280,800",
      "--start-maximized",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-breakpad",
      "--disable-component-extensions-with-background-pages",
      "--disable-extensions",
      "--disable-hang-monitor",
      "--disable-ipc-flooding-protection",
      "--disable-popup-blocking",
      "--disable-prompt-on-repost",
      "--disable-renderer-backgrounding",
      "--force-color-profile=srgb",
      "--metrics-recording-only",
      "--enable-features=NetworkService,NetworkServiceInProcess",
      // Helpful for media / WebRTC sites (GeForce Now, video calls, etc.)
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  app.listen(PORT, "0.0.0.0", () => console.log(`Private Browser listening on ${PORT}`));
})();

process.on("SIGTERM", async () => {
  for (const s of sessions.values()) await s.context.close().catch(() => {});
  if (browser) await browser.close();
  process.exit(0);
});
