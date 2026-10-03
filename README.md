# X Reply Filter

A Chrome extension for x.com that hides replies from **unverified accounts**, unless you and that account **follow each other**.

## What it does

- Filters replies under any post you open (`x.com/<user>/status/<id>`) and on **Notifications** / **Mentions**.
- An account is shown if it has any verified checkmark (blue, gold or grey) or is a mutual.
- Your own replies are always shown. The original poster's replies are shown by default; you can turn that off.
- Hidden replies collapse to a one-line placeholder you can click to reveal, or can be removed completely.
- Parent posts above the one you opened and the "Discover more" section are left alone.

## How it works

The page doesn't say whether someone follows you, but X's own API responses do. A small script reads the user data X already loads (verification and follow relationship) and remembers your mutuals locally. Nothing is sent anywhere; the only permission used is `storage`.

## Install

1. Download or clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Refresh any open x.com tabs.

After pulling updates, click the reload icon on the extension's card in `chrome://extensions`.

## Troubleshooting

Click the extension icon on an x.com page to see how many replies are hidden and how many accounts it has seen. If it says **0 accounts seen**, X has likely changed its API format; please open an issue.

## License

[MIT](LICENSE)
