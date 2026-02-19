import { fallback, imgix, wsrv, RAWGScreenshots, pickOne, parseTags } from "./utils.mjs";
import RAWG from "./libs/RAWG.mjs";

const providers = {
    "nasa": {
        description: "NASA Astronomy Picture of the Day",
        mbhOffset: 2,
        api: async (mode, { env }, headers) => {
            // Parse the API endpoint
            let url = new URL("https://api.nasa.gov/planetary/apod");

            // Set the search params
            url.searchParams.set("api_key", env.NASA_API_KEY)

            // Return the JSON data from the API
            return await (await fetch(url, { headers })).json();
        },
        apiHeaders: async () => [
            ["Accept", "application/json"],
        ],
        headers: async (data, mode) => (data?.url ? [
            ["X-Inky-Message-0", `"${data?.title ?? '???'}"`],
            ["X-Inky-Message-2", `APOD by NASA (${data?.date ?? '???'})`],
        ] : [
            ["X-Inky-Message-0", "Please check your renderer settings!"],
            ["X-Inky-Message-2", "Invalid response from NASA; using Lorem Picsum."],
        ]),
        image: async (data, mode) => {
            return [new URL(data?.hdurl ?? data?.url ?? fallback(mode))];
        },
    },
    "xkcd": {
        description: "xkcd Comics",
        mbhOffset: 2,
        api: async (mode, { env }, headers) => {
            // A "hack" to get a random image from xkcd
            const cache = caches.default,
                infoUrl = "https://xkcd.com/info.0.json";
            let max = 3000; // Safe fallback

            // Try cache
            let cachedRes = await cache.match(infoUrl);
            if (cachedRes) {
                max = (await cachedRes.json()).num;
            } else {
                // Fetch fresh
                try {
                    const res = await fetch(infoUrl);
                    if (res.ok) {
                        // Clone to read body
                        const data = await res.clone().json();
                        max = data.num;

                        // Save to cache for 12 hours (43200 seconds)
                        executionCtx.waitUntil(cache.put(infoUrl, new Response(JSON.stringify(data), {
                            headers: { 'Cache-Control': 'public, max-age=43200' }
                        })));
                    }
                } catch { }
            }

            // Build the API endpoint
            let url = new URL(`https://xkcd.com/${Math.floor(Math.random() * max - 1) + 1}/info.0.json`);

            // Return the JSON data from the API
            return await (await fetch(url, { headers })).json();
        },
        apiHeaders: async () => [
            ["Accept", "application/json"],
        ],
        headers: async (data, mode) => (data?.img ? [
            ["X-Inky-Message-0", `"${data?.title ?? '???'}" (#${data?.num ?? '???'})`],
            ["X-Inky-Message-2", data?.alt ?? '???'],
        ] : [
            ["X-Inky-Message-0", "Please check your renderer settings!"],
            ["X-Inky-Message-2", "Invalid response from xkcd; using Lorem Picsum."],
        ]),
        image: async (data, mode) => {
            return [new URL(data?.img ?? fallback(mode))];
        },
    },
    "unsplash": {
        description: "Unsplash random images",
        mbhOffset: 2,
        api: async (mode, { env }, headers) => {
            // Parse the API endpoint
            let url = new URL("https://api.unsplash.com/photos/random");

            // Set the search params
            url.searchParams.set("client_id", env.UNSPLASH_CLIENT_ID)
            url.searchParams.set("orientation", mode.w > mode.h ? 'landscape' : 'portrait');

            // Return the JSON data from the API
            return await (await fetch(url, { headers })).json();
        },
        apiHeaders: async () => [
            ["Accept", "application/json"],
        ],
        headers: async (data, mode) => (data?.urls?.raw ? [
            ["X-Inky-Message-0", `"${data?.alt_description ?? '???'}"`],
            ["X-Inky-Message-2", `by ${data?.user?.name ?? '???'} (@${data?.user?.username ?? '???'}) on Unsplash (${data?.likes ?? 0} likes)`],
        ] : [
            ["X-Inky-Message-0", "Please check your renderer settings!"],
            ["X-Inky-Message-2", "Invalid response from Unsplash; using Lorem Picsum."],
        ]),
        image: async (data, mode) => {
            return [imgix(new URL(data?.urls?.raw ?? fallback(mode)), mode)];
        }
    },
    "wallhaven": {
        description: "Wallhaven random images",
        mbhOffset: 1,
        api: async (mode, { env, req }, headers) => {
            // Parse the API endpoint
            let url = new URL("https://wallhaven.cc/api/v1/search");

            // Set the search params
            url.searchParams.set("apikey", env.WALLHAVEN_API_KEY); // Wallhaven API key
            url.searchParams.set("sorting", "random"); // Get a random image
            url.searchParams.set("categories", req.query('categories') ?? "101"); // Image categories (general, anime, people)
            url.searchParams.set("purity", req.query('purity') ?? "100"); // Image purity (sfw, sketchy, nsfw)
            url.searchParams.set("ratios", `${(mode.w / mode.h).toFixed(2)}x1`);

            // Return the JSON data from the API
            return await (await fetch(url, { headers })).json();
        },
        apiHeaders: async () => [
            ["Accept", "application/json"],
        ],
        headers: async ({ data = [] }, mode) => (data?.[0]?.path ? [
            ["X-Inky-Message-2", `${data?.[0]?.id ?? '???'} on Wallhaven (${data?.[0]?.views ?? 0} views, ${data?.[0]?.favorites ?? 0} favorites)`],
        ] : [
            ["X-Inky-Message-2", "Invalid response from Wallhaven; using Lorem Picsum."],
        ]),
        image: async ({ data = [] }, mode, { env }) => {
            return [new URL(data?.[0]?.path ?? fallback(mode))];
        }
    },
    "rawg": {
        description: "RAWG Video Game Screenshots",
        mbhOffset: 2,
        api: async (mode, { env, req }, headers) => {
            return await RAWG({
                apiKey: env.RAWG_API_KEY,
                gameId: req.query('gameId') ?? null, // If a specific game ID is provided, use it
                gameSlug: req.query('gameSlug') ?? null, // If a specific game slug is provided, use it
                gameSearch: req.query('gameSearch') ?? null, // If a specific game search term is provided, use it
            });
        },
        apiHeaders: async () => [
            ["Accept", "application/json"],
        ],
        headers: async (data, mode) => (data?.artworks?.length ? [
            ["X-Inky-Message-0", `"${data?.game?.name ?? '???'}" released on ${data?.game?.released ?? '???'}`],
            ["X-Inky-Message-2", `${data?.source ?? '???'} - Game #${data?.game?.id ?? '???'}`],
        ] : [
            ["X-Inky-Message-0", "Please check your renderer settings!"],
            ["X-Inky-Message-2", "Invalid response from RAWG; using Lorem Picsum."],
        ]),
        image: async (data, mode, { req }) => {
            return [new URL(data?.artworks?.length ? wsrv(pickOne(data.artworks), mode) : fallback(mode))];
        }
    },
    "media-gallery": {
        description: "Pull images from the compatible Media Gallery D1 database",
        image: async (data, mode, c) => {
            if (!c.env?.IMAGE_GALLERY_R2 || !c.env?.IMAGE_GALLERY)
                return new URL(fallback(mode));

            // Parse tags
            const tags = parseTags(c.req.query('tags') || c.req.query('tag'));

            // Build query
            let query = "SELECT id, crop FROM media WHERE deleted = 0 AND (type IS NULL OR type = 'image')",
                params = [];

            // Filter by tags if provided
            if (tags.length > 0) {
                query = `SELECT DISTINCT media.id, media.crop
                FROM media, json_each(media.tags)
                WHERE media.deleted = 0
                AND (media.type IS NULL OR media.type = 'image')
                AND json_each.value IN (${tags.map(() => '?').join(',')})`;
                params = tags;
            }

            // Add random ordering
            query += " ORDER BY RANDOM() LIMIT 1";

            // Get a random image
            const result = await c.env.IMAGE_GALLERY.prepare(query).bind(...params).first();
            if (!result?.id)
                return new URL(fallback(mode));

            // Return the R2 URL
            return [
                new URL(`${c.env.IMAGE_GALLERY_R2.replace(/\/$/, '')}/${result.id}`),
                { fit: result.crop ? result.crop : 'cover' }
            ];
        },
    },
}

export {
    providers as default,
    providers
}