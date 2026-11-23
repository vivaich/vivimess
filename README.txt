ViviMess 1.1.0 — update package

Included in this update:
- Creator Studio: create custom sidebar tabs, rename and delete them.
- Visual page builder: add text, buttons, images, videos and cards; upload image/video blocks; reorder blocks by dragging; adjust width, text color and corner radius.
- Safe button actions: open another custom tab or award a configured currency amount. Arbitrary JavaScript execution is intentionally not enabled.
- Friend requests: sending a request no longer adds a friend immediately; the recipient must accept.
- Chat attachments: send photos and videos; personal GIF collection lets each user upload GIFs and send them in chats.
- Voice-only calls: camera controls removed; microphone mute and screen sharing remain.
- Startup splash: the login/registration form is hidden while a saved session is checked to prevent a flash on reload.
- Profile keeps the existing unique username and editable display Name; PNG/JPG/WEBP/GIF avatar upload remains available.

Deploy update:
1. Extract this ZIP.
2. In GitHub repository vivimess choose Add file -> Upload files.
3. Upload the contents of this folder, replacing files with the same names.
4. Commit directly to the main branch. Render should deploy the latest commit automatically; if not, use Manual Deploy -> Deploy latest commit.

Important limitations to know before inviting users:
- This project currently stores accounts, messages, GIFs and uploaded media in data.json on the service filesystem. Render Free uses an ephemeral filesystem, so data can be lost after a restart/redeploy. A persistent database and object storage (for example PostgreSQL plus S3-compatible storage) should be connected before using this as a public community.
- Voice calling uses WebRTC with a public STUN server. Some networks require a TURN relay, so calls/screen sharing may not connect on every network until TURN credentials are configured.
- Uploaded images/videos/GIFs are limited to 7 MB each in the UI.
- The visual page builder is a block editor with drag-to-reorder and width/color/radius controls; it is not yet a freeform pixel-position canvas.
