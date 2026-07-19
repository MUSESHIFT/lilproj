# deploying money rundown

money rundown is a weekly gmail money digest you run for yourself. this guide
gets it live on the digitalocean droplet you already own — the same box that
runs the rest of museshift.com (nginx + pm2, persistent disk, sqlite). no paid
services anywhere.

---

## a) why this costs $0

nothing here adds a bill:

- **the server** — it runs on the droplet you already pay for. one more pm2
  process and one more nginx vhost. no new instance.
- **the database** — sqlite in a file on the droplet's real disk. persistent
  disk means the db survives restarts and deploys. no managed postgres.
- **reading gmail** — the gmail api is free at this scale. a single mailbox
  polled every few hours is nowhere near any quota.
- **sending the digest** — gmail smtp is free with an app password. one email a
  week to yourself.
- **the schedule** — plain unix cron. free.

the only things you must supply yourself: google oauth credentials and a gmail
app password. both are free to create. that's it.

---

## b) one-time google cloud setup (free, testing mode)

you need an oauth client so the app can read your gmail, and the gmail api
turned on.

1. go to <https://console.cloud.google.com> and create a project (or reuse one).
2. **apis & services → library →** enable **gmail api**.
3. **apis & services → oauth consent screen**:
   - user type: **external**
   - publishing status: leave it in **testing**
   - add your own gmail address under **test users**
   - add the scope for gmail read access (`.../auth/gmail.readonly`)
4. **apis & services → credentials → create credentials → oauth client id**:
   - application type: **web application**
   - authorized redirect uri:
     `https://rundown.museshift.com/api/auth/google/callback`
   - save the **client id** and **client secret**.

**about testing mode:** an app in testing works fully for the accounts you list
as test users — up to ~100 of them — with no verification and no fee. since this
is just you (or a tiny handful of people), testing mode is all you need. google's
CASA security assessment and the full verification review only become required if
you ever publish this publicly to arbitrary users. you are not doing that now, so
skip it. the one visible effect of testing mode: the consent screen shows an
"unverified app" warning, and refresh tokens can expire after a week of no use —
fine for a mailbox that's polled every 6 hours.

---

## c) environment setup

on the droplet, clone the repo and create the env file:

```bash
cd /root
git clone <your-repo-url> money-rundown
cd money-rundown
cp .env.example .env
```

generate the encryption key (this encrypts your stored gmail tokens at rest):

```bash
openssl rand -hex 32
```

open `.env` and fill in every value — see `.env.example` for what each one is:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from step (b)
- `GOOGLE_REDIRECT_URI` — the exact callback url you authorized
- `MR_ENCRYPTION_KEY` — paste the 64-hex-char value from `openssl` above
- `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`
- `SMTP_USER` / `MAIL_FROM` — your gmail address
- `SMTP_PASS` — a gmail **app password** (google account → security → 2-step
  verification → app passwords). not your normal login password.
- `NODE_ENV=production`
- `APP_BASE_URL=https://rundown.museshift.com`

make sure the data dir exists on the persistent disk — sqlite, logs, and pm2
output all live here:

```bash
mkdir -p /root/money-rundown/data
```

---

## d) build, run, and expose it

**build** the site:

```bash
cd /root/money-rundown
bun install
bun run build
```

**start it under pm2** (uses the config in `deploy/`):

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
```

> port note: `serve.ts` binds port **3000**, which silverbullet also uses by
> default on this droplet. if 3000 is taken, remap one of them before starting —
> otherwise the newer process will fight for the port. `pm2 list` and
> `lsof -iTCP:3000 -sTCP:LISTEN` will tell you what's there.

**put nginx in front of it:**

```bash
sudo cp deploy/nginx-money-rundown.conf \
  /etc/nginx/sites-available/rundown.museshift.com
sudo ln -s /etc/nginx/sites-available/rundown.museshift.com \
  /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

point a `rundown` A record at the droplet in your dns first, then **get the
cert** (free, let's encrypt):

```bash
sudo certbot --nginx -d rundown.museshift.com
```

certbot rewrites the vhost to add https and the redirect. reload nginx if it
doesn't do it for you. the app is now live at
<https://rundown.museshift.com>.

---

## e) install the schedule

two cron jobs do the recurring work — fetching mail and sending the digest:

```bash
crontab deploy/money-rundown.crontab
crontab -l   # confirm it took
```

- **every 6 hours** — `bun run cron:fetch`: pulls recent gmail, classifies the
  money-related mail, runs reconciliation, stores it.
- **mondays at 08:00** — `bun run cron:digest`: builds the week's digest and
  emails it to you.

if you cloned somewhere other than `/root/money-rundown`, edit the `APP_DIR`
line at the top of the crontab first. logs land in `data/cron.log` — tail it
with `tail -f /root/money-rundown/data/cron.log`.

---

## f) how the weekly email flows

end to end, once a week:

1. throughout the week, the 6-hour `cron:fetch` job reads your gmail, picks out
   the money mail (receipts, charges, subscriptions), and reconciles it against
   what's already on record — noting anything worth a second look.
2. monday at 08:00, `cron:digest` gathers that week's findings, formats them as
   plain text and html, and hands them to the mailer.
3. the mailer sends one email — from your gmail, over free smtp — to you.
4. it lands calm and lowercase: here's what moved, here's what's worth a look.
   nothing is flagged as fraud or an accusation; it's a rundown, not an alarm.

that's the whole loop. it runs on hardware you already have, for nothing extra.
