VIVIMESS — QUICK START (Windows)

START THE APP
1) Install Node.js LTS (https://nodejs.org/) if you have not already.
2) Extract this ZIP into a folder.
3) Open the ViviMess folder in Visual Studio Code.
4) Choose Terminal > New Terminal.
5) Run these commands, one at a time:

   npm install
   npm start

6) Open Chrome at http://localhost:3000

OWNER / ADMIN ACCOUNT
Username: viva
Password: vivaich11

Sign in with this account to see Creator Studio in the left menu.
Creator Studio lets you visually change the site name, welcome text and colors,
turn Friends / Calls / Video / Screen sharing on or off, and optionally add custom CSS.

FEATURES
- Account registration and login
- Editable profile
- Search users, add and remove friends
- Realtime direct messages
- WebRTC voice/video calls and screen sharing controls

IMPORTANT LIMITATIONS
- This is an early starter build, not a production-ready public service.
- The database is a local JSON file (data.json) and lives on the computer running the server.
- Other people cannot reach localhost on your computer. To make it public, deploy it to a hosting provider with HTTPS.
- Calls between different networks may need a TURN server; the included STUN server will not work through every router/firewall.
- Before public launch: set a strong JWT_SECRET, use a real database, HTTPS, TURN, rate limiting, email verification, password reset, backups and moderation.
- Keep the owner password private. Change the starter password before exposing the app publicly.
