import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';

class RootCAUpdater {
    static DEFAULT_MAX_BYTES = 131072;
    static ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    static CLOUDFLARE_URLS = [
        'https://letsencrypt.org/certs/isrgrootx1.pem',
        'https://letsencrypt.org/certs/isrg-root-x2.pem',
        'https://pki.goog/roots.pem',
    ];
    static MOZILLA_URLS = [
        'https://curl.se/ca/cacert.pem',
    ];

    // Parse CLI args and normalize core options
    constructor() {
        this.scriptName = path.basename(process.argv[1] ?? 'update_root_cas.mjs');

        const { values } = parseArgs({
            args: process.argv.slice(2),
            options: {
                profile: { type: 'string', default: 'webpki' },
                url: { type: 'string', multiple: true },
                out: { type: 'string', default: 'data/certs/root_cas.pem' },
                'max-bytes': { type: 'string', default: String(RootCAUpdater.DEFAULT_MAX_BYTES) },
                'allow-large': { type: 'boolean', default: false },
                help: { type: 'boolean', short: 'h', default: false },
            },
            strict: true,
            allowPositionals: false,
        });

        this.profile = values.profile;
        this.extraUrls = values.url ?? [];
        this.outFile = path.isAbsolute(values.out) ? values.out : path.join(RootCAUpdater.ROOT_DIR, values.out);
        this.maxBytes = Number.parseInt(values['max-bytes'], 10);
        this.allowLarge = values['allow-large'];
        this.help = values.help;
    }

    // Print CLI usage details and examples
    usage() {
        console.log(`Usage: ${this.scriptName} [options]

Options:
  --profile <name>  One of: webpki (default), cloudflare, mozilla, all, custom
  --url <pem-url>   Add one PEM URL (repeatable). Required with --profile custom
  --out <file>      Output PEM bundle path (default: data/certs/root_cas.pem)
  --max-bytes <n>   Fail if output is larger than n bytes (default: ${RootCAUpdater.DEFAULT_MAX_BYTES})
  --allow-large     Skip size guardrail check
  --help            Show this help text

Examples:
  ${this.scriptName}
  ${this.scriptName} --profile cloudflare --out data/certs/cloudflare_roots.pem
  ${this.scriptName} --profile custom --url https://example.com/root.pem --out data/certs/custom.pem
  ${this.scriptName} --profile webpki --max-bytes 300000`);
    }

    // Validate numeric guardrail options before processing
    validate() {
        // Reject invalid max-bytes values early
        if (!Number.isFinite(this.maxBytes) || this.maxBytes <= 0) {
            console.error(`Invalid --max-bytes value. Must be a positive integer.`);
            process.exit(1);
        }
    }

    // Resolve URL list from profile plus any extra custom URLs
    resolveUrls() {
        let urls = [];
        switch (this.profile) {
            case 'cloudflare':
                urls = [...RootCAUpdater.CLOUDFLARE_URLS];
                break;
            case 'mozilla':
            case 'webpki':
                urls = [...RootCAUpdater.MOZILLA_URLS];
                break;
            case 'all':
                urls = [...RootCAUpdater.MOZILLA_URLS, ...RootCAUpdater.CLOUDFLARE_URLS];
                break;
            case 'custom':
                urls = [];
                break;
            default:
                console.error(`Invalid profile '${this.profile}'.`);
                this.usage();
                process.exit(1);
        }

        const finalUrls = [...urls, ...this.extraUrls];
        // Ensure we always have at least one URL to download
        if (finalUrls.length === 0) {
            console.error('No certificate URLs configured. Use --profile or --url.');
            this.usage();
            process.exit(1);
        }
        return finalUrls;
    }

    // Extract PEM certificate blocks from raw text
    parseCertificates(pemText) {
        return (pemText.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? []).map((cert) => cert.trim());
    }

    // Download one PEM source with redirect support
    async downloadPem(url) {
        console.log(`Downloading ${url}`);
        const response = await fetch(url, { redirect: 'follow' });
        // Fail fast when the remote endpoint does not return success
        if (!response.ok)
            throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
        return await response.text();
    }

    // Run full workflow: parse options, fetch, dedupe, and write bundle
    async execute() {
        // Show help and exit without side effects
        if (this.help) {
            this.usage();
            return;
        }

        this.validate();
        await mkdir(path.dirname(this.outFile), { recursive: true });

        const allPemTexts = [],
            urls = this.resolveUrls();
        for (const url of urls)
            allPemTexts.push(await this.downloadPem(url));

        const uniqueCerts = [],
            seen = new Set();
        for (const pemText of allPemTexts) {
            for (const cert of this.parseCertificates(pemText)) {
                // Keep certificate ordering while removing duplicates
                if (!seen.has(cert)) {
                    seen.add(cert);
                    uniqueCerts.push(cert);
                }
            }
        }

        const outData = uniqueCerts.length > 0 ? `${uniqueCerts.join('\n')}\n` : '',
            outBytes = Buffer.byteLength(outData, 'utf8');
        // Enforce output size limit unless explicitly bypassed
        if (!this.allowLarge && outBytes > this.maxBytes) {
            console.error(`Error: ${this.outFile} is ${outBytes} bytes, exceeding max ${this.maxBytes} bytes.`);
            console.error('Use a smaller profile (e.g. --profile cloudflare), increase --max-bytes, or use --allow-large.');
            process.exit(1);
        }

        await writeFile(this.outFile, outData, 'utf8');
        console.log(`Profile: ${this.profile}`);
        console.log(`Wrote ${uniqueCerts.length} certificates to ${this.outFile}`);
        console.log('Next: pio run -t buildfs && upload littlefs.bin (or use OTA filesystem update).');
    }
}

new RootCAUpdater().execute().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
