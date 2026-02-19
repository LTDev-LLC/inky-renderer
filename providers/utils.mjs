import { Buffer } from 'node:buffer';

// Fallback image
export function fallback(mode) {
    return `https://picsum.photos/${mode.w}/${mode.h}/?blur=5&grayscale`;
}

// Get a fallback response
export async function getFallbackResponse(_mode, _provider) {
    let src = new URL(fallback(_mode));
    return new Response((await fetch(src)).body, {
        ...transform(_mode),
        headers: new Headers([
            ["Content-Type", "image/jpeg"],
            ["X-Image-Size", `${_mode.w}x${_mode.h}`],
            ["X-Image-Source", src],
            ["X-Image-Provider", "Lorem Picsum"],
            ['X-Invalid-Provider', _provider],
        ])
    });
}

// Apply imgix args to the image
export function imgix(img, mode) {
    img.searchParams.set("w", mode.w);
    img.searchParams.set("h", mode.h);
    img.searchParams.set("fit", "fillmax");
    img.searchParams.set("fill", "blur");
    img.searchParams.set("format", "jpg");
    img.searchParams.set("jpeg-progressive", "false");

    // Return the image URL
    return img;
}

// Use wsrv.nl to resize the image
export function wsrv(img, mode) {
    let repl = new URL("https://wsrv.nl/");
    repl.searchParams.set("url", (img instanceof URL) ? img.href : img);
    repl.searchParams.set("w", mode.w);
    repl.searchParams.set("h", mode.h);
    repl.searchParams.set("fit", "fill");

    // Return the image URL
    return repl;
}

// Apply Cloudflare args to the image
export function transform(mode, _headers = [], fit = "pad") {
    let top = _headers.some((h) => h.includes("X-Inky-Message-0")) ? mode.mbh : 0,
        bottom = _headers.some((h) => h.includes("X-Inky-Message-2")) ? mode.mbh : 0,
        _fit = mode.fit ?? fit;

    return {
        cf: {
            image: {
                format: "baseline-jpeg",
                quality: mode.q ?? 'medium-low', // Smaller images = faster rendering!
                fit: _fit,
                background: "#FFF", // Default to white for cleaner inkplate messages
                width: mode.w,
                height: mode.h - (_fit == "cover" ? (top + bottom) : 0),
                saturation: 0, // Grayscale
                ...(mode.mbh > 0 ? {
                    border: {
                        color: "#FFF", // Default to white for cleaner inkplate messages
                        top,
                        bottom,
                    }
                } : {})
            }
        }
    }
}

// Convert base64 string to PNG
export function b64png(b64) {
    return new Response(Buffer.from(b64.replace(/^data:image\/png;base64,/, ''), 'base64'), {
        headers: { 'Content-Type': 'image/png' }
    });
}

// Convert a Response to a ReadableStream
export function responseToReadableStream(response) {
    // If there's already a ReadableStream, you can simply return `response.body`:
    if (!response.body)
        throw new Error("The response has no body or the body was already consumed.");

    return new ReadableStream({
        async start(controller) {
            const reader = response.body.getReader();

            // Continuously pump from the reader until there is no more data
            async function pump() {
                const { done, value } = await reader.read();
                if (done) {
                    // Signal that we're done reading
                    controller.close();
                    return;
                }
                // Enqueue the current chunk and read the next
                controller.enqueue(value);
                return pump();
            }

            // Start reading
            return pump();
        }
    });
}

// A basic function to pick a random element from an array
export function pickOne(arr = []) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Helper to parse and normalize image tags
export function parseTags(tags = null) {
    if (!tags)
        return [];
    try {
        let _tags = tags;
        if (typeof tags === 'string') {
            try {
                const parsed = JSON.parse(tags);
                if (Array.isArray(parsed)) _tags = parsed;
                else _tags = tags.split(',');
            } catch {
                _tags = tags.split(',');
            }
        }

        if (!Array.isArray(_tags))
            _tags = [_tags];

        return _tags
            .map(t => String(t).trim().toLowerCase()
                .replace(/\s+/g, '-')           // Spaces to hyphens
                .replace(/[^a-z0-9-]/g, '_')    // Specials to underscores
                .replace(/^[_]+|[_]+$/g, '')    // Trim leading/trailing underscores
                .replace(/^[-]+|[-]+$/g, '')    // Trim leading/trailing hyphens
            )
            .filter((t, i, a) => t.length > 0 && a.indexOf(t) === i)
            .sort();
    } catch {
        return [];
    }
}