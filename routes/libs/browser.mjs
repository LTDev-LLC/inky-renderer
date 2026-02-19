import puppeteer from "@cloudflare/puppeteer";

// Get a random Browser Rendering session
async function getBrowserSession(endpoint) {
    const sessions = ((await puppeteer.sessions(endpoint))
        ?.filter?.((v) => !v.connectionId)
        ?.map?.((v) => v.sessionId) ?? []);

    return sessions.length
        ? sessions[Math.floor(Math.random() * sessions.length)]
        : null;
}

export {
    getBrowserSession as default,
    getBrowserSession
}