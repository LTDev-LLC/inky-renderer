import { Hono } from 'hono';
import { getTimeZoneInfo } from './libs/timezone.mjs';
import { createMiddleware } from 'hono/factory';
import { encode } from 'cbor2';
import { basicAuth } from 'hono/basic-auth';

// Create versioned endpoint
const v0 = new Hono().basePath('/api/v0');

// Create the cbor middleware
v0.use(createMiddleware(async (c, next) => {
    c.header('Content-Type', 'application/cbor');
    c.setRenderer((content) => {
        return c.body(encode(content));
    });
    await next();
}));

// Create an endpoint for getting timezone data
v0.get('/timezone/:timezone?', async (c) => {
    let _cbor = c.req.query('cbor');
    try {
        return c[_cbor ? 'render' : 'json'](getTimeZoneInfo(
            c.req.param('timezone')
            ?? c.req.query('timezone')
            ?? c.req.query('zone')
            ?? c.req.query('tz')
            ?? c.req.header('x-timezone')
            ?? c.req.header('x-tz')
            ?? c.req?.raw?.cf?.timezone
            ?? undefined
        ));
    } catch (e) {
        return c[_cbor ? 'render' : 'json']({ error: e.message });
    }
});

export { v0 as default, v0 };
