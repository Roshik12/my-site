# QuickShare security setup (do these in order)

## What was actually wrong
- The Firebase `apiKey` in the page source is **not a secret** (every Firebase web app exposes it). Protection comes from rules, not from hiding it.
- The database rules were fully open (`.read: true, .write: true`), so anyone could read, modify or delete everything.
- Group passwords were stored as **plain text** in `groups/<id>/password`, readable by any visitor.
- Group IDs were inserted into the page as HTML (XSS), and file links from the database were trusted blindly.

## 1. Enable Anonymous sign-in (before anything else)
Firebase Console > Authentication > Sign-in method > Anonymous > Enable > Save.
Also Authentication > Settings > Authorized domains: keep only roshik.com.np, www.roshik.com.np (and your *.vercel.app preview if you use it).

## 2. Deploy the new code
git add -A, commit, push. Vercel adds the security headers from vercel.json.

## 3. Publish the rules
- Realtime Database > Rules > paste database.rules.json > Publish.
- Storage > Rules > paste storage.rules > Publish.

## 4. Delete the old leaked data
Realtime Database > Data > hover the `groups` node > delete it (it holds old plain-text passwords).
Old groups stop working; create them again. If you reused a group password elsewhere, change it there.

## 5. Restrict the API key
Google Cloud Console > APIs & Services > Credentials > the Browser key used by Firebase >
Application restrictions: Websites > add https://roshik.com.np/* and https://www.roshik.com.np/* > Save.

## 6. Optional: App Check
Firebase Console > App Check > register the web app with reCAPTCHA v3, then enforce it for Realtime Database and Storage.

## Honest limits
- The home note is keyed by your network IP by design: anyone on the same network can read it. Do not store passwords or secrets in it.
- Messages are protected from outsiders but are not end-to-end encrypted: the site owner (you, via the Firebase console) can read them.
- Call codes are 8 characters (about 1 trillion combinations) and rooms cannot be listed; treat a code like a one-time link.
