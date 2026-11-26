# 12 Planes strategy app

The 12 Planes argument map and presentation as a standalone web app, hosted in the EU on Clever Cloud.

- Sign in with your name and a password. The team password edits, the client password suggests.
- Team members edit directly. Client members suggest, and the team accepts or rejects. This is enforced by the server.
- Every change is logged with who and when, and can be reverted.
- Admins manage who has access at `/admin.html`.

## Set up (one time)

### 1. GitHub
Create a private repository, for example `kontrapunkt/12planes-app`, and push this folder to it.

### 2. Brevo (optional, only for email-code sign-in; not needed with passwords)
1. Create an account at brevo.com.
2. Senders, domains and dedicated IPs: add and verify the domain you send from, for example `kontrapunkt.com`. Brevo shows DNS records (DKIM, SPF, DMARC) for your IT team to add.
3. SMTP and API: create an API key. Keep it secret. It goes into Clever Cloud in step 3, never into this repository or a chat.

### 3. Clever Cloud
1. Create an organisation, choose an EU region (Paris).
2. Create an application: Node.js, from your GitHub repository, default instance size (nano or XS is enough).
3. Add a PostgreSQL add-on (DEV plan is fine to start) and link it to the application. This sets `POSTGRESQL_ADDON_URI` automatically.
4. Environment variables on the application:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | A long random string (at least 40 characters). Generate one, never reuse it. |
| `TEAM_PASSWORD` | Password for Kontrapunkt and freelancers. They edit and manage access. |
| `CLIENT_PASSWORD` | Password for the client. They suggest. |
| `APP_URL` | The address people will use, for example `https://12planes.kontrapunkt.com` |
| `CC_NODE_VERSION` | `22` |

5. Deploy. Clever Cloud runs `npm install` and `npm start`.

### 4. Domain (optional)
In Clever Cloud, Domain names: add `12planes.kontrapunkt.com`. Your IT team adds the CNAME record Clever Cloud shows. HTTPS is set up automatically.

### 5. Invite people
Send the link with the right password. Everyone signs in with their name. Manage access (footer of the map, or `/admin.html`) lists everyone who has signed in, where a team member can change a role or turn someone off. Changing a password in Clever Cloud and restarting signs out everyone who used it.

## Updating the content
The map and Present are built from the Claude artifact sources:

```
python3 build.py /path/to/12planes
```

Commit and push. Clever Cloud redeploys. Edits people made in the app are stored in the database and are not affected.

## Moving edits over from the Claude artifact
An admin can POST the artifact database export to `/api/admin/import` as `{"collections": {"content": [...], "suggestions": [...], "decisions": [...], "log": [...]}}`.

## Running locally
```
ADMIN_EMAILS=you@example.com node server.js
```
Without `DATABASE_URL` it uses a temporary in-memory database, and without `BREVO_API_KEY` it prints sign-in codes to the console.
