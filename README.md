# PTC Status Watch

Public status dashboard + synthetic monitoring for:

- **PTC website:** https://peachtreetownandcountry.com/
- **PTC email domain DNS:** `peachtreetc.com` (MX, SPF, DMARC)
- **Microsoft 365:** Outlook Web + login endpoint + microsoft.com
- **Google Workspace:** Drive + Google sign-in + google.com **plus** official Workspace incidents feed

## How it works

1. A scheduled **GitHub Action** runs every 5 minutes.
2. It performs a set of HTTP + DNS checks (read-only).
3. Results are written to:
   - `public/status.json` (latest)
   - `public/history.json` (rolling history, last 7 days)
4. GitHub Pages hosts the dashboard from the `public/` folder.

## Deploy (GitHub Pages)

1. Push this repo to GitHub.
2. Go to **Settings → Pages**
3. **Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: **main**
   - Folder: **/public**
4. Save.

Your dashboard will be live at:
`https://<your-username-or-org>.github.io/<repo-name>/`

## Local run

Requires Node 20+.

```bash
npm run check
```

Then open `public/index.html` (or serve the folder with any static web server).

## Customize checks

Edit: `config/targets.json`

- Add/remove URLs
- Add DNS checks
- Adjust the Google Workspace “products of interest”

---

### Notes

- This is a **public** dashboard (no secrets). It only uses public HTTP/DNS signals.
- Microsoft’s detailed “Service health” incident data is typically **tenant-only** (Admin Center). This dashboard uses public synthetic checks instead.
