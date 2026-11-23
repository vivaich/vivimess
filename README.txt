VIVIMESS — CREATOR STUDIO BUILD

Run locally:
1. Install Node.js LTS.
2. Open this folder in VS Code.
3. Open Terminal > New Terminal.
4. Run: npm install
5. Run: npm start
6. Visit http://localhost:3000

OWNER ACCOUNT (created automatically on first start)
Username: viva
Password: vivaich11

SECURITY / ROLES
- New accounts are regular users and start with 0 in every currency.
- The viva account is seeded as the owner administrator.
- Only administrators can create/edit currencies, change balances and manage roles.
- The owner account viva cannot be demoted through the role form.
- Admins can grant or revoke administrator role for other accounts.

CURRENCY
- Initial currency: Чекушня.
- All user balances start at 0.
- Admins can create additional currencies and upload an image, GIF or video logo (max 8 MB in the browser; server request limit 12 MB).
- Admins can rename currencies and replace their logo.
- Admins can add/subtract user balances.

IMPORTANT
This remains an early-stage project, not a production-ready public messenger.
The JSON database and uploaded media are stored in data.json on the server filesystem. Free hosting platforms may erase local files after restarts/redeploys. Before public launch, connect persistent database and object storage, configure HTTPS/TURN, add rate limiting, secure owner credentials, backups and moderation.
The existing message/call features are still basic; this build does not yet implement the full requested GIF/photo/video chat attachments, voice-note sending, stickers, quests or drag-and-drop page builder. Those need separate implementation and testing.
