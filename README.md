# Inky Renderer
Firmware + remote rendering service for Inkplate devices via Cloudflare Workers.

### Image Services (/api/v1/render)
1) [Unsplash](https://unsplash.com/developers)  (/unsplash) - Inkplates: 10, 6COLOR
2) [Wallhaven](https://wallhaven.cc/help/api) (/wallhaven) - Inkplates: 10, 6COLOR
    * Can sometimes contain NSFW content.
3) [NASA APOD](https://api.nasa.gov/) (/nasa) - Inkplates: 10, 6COLOR
4) [xkcd](https://xkcd.com/) (/xkcd) - Inkplates: 10, 6COLOR (can be hard to read)
5) [AI Slop](https://en.wikipedia.org/wiki/AI_slop) (/ai-slop) - Inkplates: 10, 6COLOR
    * Uses [Cloudflare AI](https://developers.cloudflare.com/workers-ai/) to generate a random prompt + resulting image.
6) [RAWG.io](https://rawg.io/) (/rawg) - Inkplates: 10, 6COLOR
    * Pull game screenshots/info using `?gameId=123`, `?gameSlug=game-slug`, `?gameSearch=Game Name` or defaults back to a random game.
7) [Media Gallery](https://github.com/LTDev-LLC/cloudflare-media-gallery) (/media-gallery) - Inkplates: 10, 6COLOR
    * A media gallery for Cloudflare Workers using D1 databases backed by R2 for file storage.

### Render Services (/api/v1/render)
1) [NY Times](https://developer.nytimes.com/) (/news, /nytimes) - Inkplates: 10, 6COLLOR
    * Supports custom section query: `/api/v1/render/news?section=us` (default: world)
    * See [docs](https://developer.nytimes.com/docs/top-stories-product/1/routes/%7Bsection%7D.json/get) for more information.
    * 6COLOR only displays headlines (for now!?)
2) Weather from [Visual Crossing](https://www.visualcrossing.com/) (/weather) - Inkplates: 10, 6COLOR
    * 6COLOR only displays the forecast for the next 3 days while in landscape.
3) [Hacker News](https://news.ycombinator.com/) (/hn) - Inkplates: 10, 6COLOR
    * Uses the [Algolia Search API](https://hn.algolia.com/api).
    * Currently only supports the `/api/v1/search` endpoint. Example: `/render/hn?tags=story`
4) [Google Calendar](https://calendar.google.com/) (/google-calendar) - Inkplates: 10, 6COLOR
    * Must be a public calendar. See [help](https://support.google.com/calendar/answer/41207?hl=en) for more information.
    * Pass multiple `calendarId`'s to the endpoint using commas. Example: `/render/google-calendar?calendarId=123asd,456fgh`

## Device Management & Setup

The Inky Renderer firmware includes built-in tools for managing WiFi credentials and performing OTA (Over-The-Air) updates without needing to remove the SD card or re-flash via USB.

### 1. WiFi Setup (Captive Portal)
Allows you to configure WiFi remotely without the need of flashing your `config.json`.

1.  **Trigger:** Automatic on boot if WiFi fails.
2.  **Display:** The screen will show:
    * **QR Code 1:** Scan to connect to the device's Hotspot (SSID: `Inky-Renderer`, No Password).
    * **QR Code 2:** Scan to open the configuration page (`http://192.168.4.1`).
3.  **Action:** Connect to the network, open the page, and enter your new WiFi credentials.
4.  **Result:** The device will save the settings and reboot.

### 2. Maintenance Mode (OTA Updates)
Maintenance Mode allows you to upload new firmware (`firmware.bin`) or filesystem images (`littlefs.bin`) wirelessly.

* **How to Enter:**
    1.  Press the **RESET** button.
    2.  Immediately hold down the **WAKE** button (GPIO 36).
    3.  **Watch the screen:**
        * Hold for **2 seconds**: Screen shows "Release for WiFi Setup". See `Wifi Setup` above.
        * Hold for **>5 seconds**: Screen shows "Release for Maintenance Mode".
    4.  Release the button when "Maintenance Mode" appears.
* **How to Use:**
    1.  The screen will display the device's IP address and a QR code.
    2.  Scan the QR code or visit the IP address in your browser.
    3.  Select the update type:
        * **Firmware:** For code updates (`firmware.bin`).
        * **Filesystem:** For config/asset updates (`littlefs.bin`).
    4.  Click **Upload & Flash**.

### Button Controls Reference

| Action | Duration | Description |
| :--- | :--- | :--- |
| **Normal Boot** | Click | Simply press Reset (or Wake from sleep) to run normally. |
| **WiFi Setup** | Hold ~2-5s | Forces the device into the Captive Portal to re-configure WiFi. |
| **Maintenance** | Hold >5s | Enters OTA mode for wireless updates. |

### Supported Devices
1) [Inkplate 10](https://soldered.com/collections/inkplate-e-paper-displays/products/inkplate-10?variant=62541031047517)
2) [Inkplate 6COLOR](https://soldered.com/collections/inkplate-e-paper-displays/products/inkplate-6color-e-paper-display?variant=62541030555997)

*Note: I don't currently own any others for testing/development; feel free to PR!*

### Setup
1) Clone the repo.
2) Copy config to data directory + edit.
    * Inkplate 10: Copy `config.example.json` to `config.json`.
    * Inkplate 6COLOR: Copy `config_6color.example.json` to `config_6color.json`.
3) Pull/update (optional) TLS root certificates for device HTTPS/MQTT verification:
    * `npm run certs:update` (default: WebPKI bundle to `data/certs/root_cas.pem`, with embedded-size guardrail)
    * `npm run certs:cloudflare` (small bundle, recommended for tiny LittleFS partitions)
    * `npm run certs:webpki` (full bundle; may exceed small LittleFS partitions)
    * You can also run `npm run certs:help` (or `node tools/update_root_cas.mjs --help`) for custom profiles/URLs/output.
4) Create (optional) Cloudflare resources if pairing with [Media Gallery](https://github.com/LTDev-LLC/cloudflare-media-gallery):
    * D1 Database: `npx wrangler d1 create inky-images`
    * Update `d1_databases` with your new Database ID.
5) Configure secrets:
    * Copy `.secrets.example.json` to `.secrets.json`.
    * Modify the `.secrets.json` file as needed.
    * Run `npm run secrets`.
6) `npm run deploy`
7) Hang on wall.

### TLS Certificate Validation (Firmware)
Firmware now validates TLS certificates for:
* Image fetches over HTTPS
* MQTT when `mqtt.tls=true`
* Timezone API fetches in NTP sync

Configuration:
* `security.caCertPath` (default: `/certs/root_cas.pem`)
* `security.allowInsecure` (default: `false`)

If the CA bundle is missing or invalid:
* `allowInsecure=false`: secure connections fail closed.
* `allowInsecure=true`: firmware falls back to `setInsecure()` for TLS clients.

## Developer Tools

This project includes a suite of Node.js utility scripts to manage environment variables and asset preparation for the Inkplate firmware.

### Prerequisites

Ensure you have the dependencies installed:

```bash
npm install
```

---

### 1. Image to Logo Converter

Converts PNG/JPG images into RLE-compressed C++ arrays for Inkplate's E-Ink displays.

* **Dithering:** Uses Floyd-Steinberg to represent gradients on 1-bit (black/white) screens.
* **Compression:** Employs Apple PackBits RLE to minimize PROGMEM usage.
* **Targets:** Automatically generates assets for both Inkplate 10 and Inkplate 6COLOR.

**Command:**

```bash
npm run img2logo -- assets/logo.png --scale 0.5
```
---

### 2. Web Asset Compiler

Minifies and compresses HTML/CSS/JS into C++ headers for the internal web server.

* **Efficiency:** Uses Gzip (Level 9) and minification to ensure the web UI fits in minimal flash space.

**Command:**

```bash
npm run html2h -- path/to/index.html --out firmware/include
```
---

### 3. Secrets Converter

Converts `.secrets.json` into `.dev.vars` for local Cloudflare Workers development.

**Command:**

```bash
npm run json2env -- .secrets.json --force
```
---

### 4. Automated Asset Pipeline

When adding new images or updating the web interface, run the respective tools to refresh the `firmware/include` and `firmware/src` directories before recompiling the ESP32 firmware.
