# memorial

## Admin access and records

The admin interface is available at `/admin.html`. Protect it with a Cloudflare Zero Trust Access self-hosted application and an allow policy for the email addresses that should be able to edit records. The Worker also verifies the Access JWT on `/admin.html`, `/api/admin/*`, and the existing `/api/process` DOCX upload endpoint.

Set these Worker environment variables in Cloudflare:

- `CF_ACCESS_TEAM_DOMAIN`: your team domain, such as `example.cloudflareaccess.com` (without `https://`).
- `CF_ACCESS_AUD`: the audience (AUD) tag for the Access application.
- `GEMINI_API_KEY`: required only to process DOCX uploads.

Include `/admin.html` and `/api/admin/*` in the Access application’s protected paths. Access policies let you add or remove permitted email addresses without changing the Worker. Configure the same Access application to cover `/api/process` if you use DOCX uploads.

The admin page supports creating and editing records, uploading/replacing photos (JPG, PNG, or WebP, up to 8 MB), and removing existing photos. The DOCX batch uploader remains available below the editor.

The admin interface is built with React. Run `npm ci && npm run build` to bundle it into `public/admin.js` before deploying. The deployment workflow runs this build automatically.
