import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { minify } from 'html-minifier-terser';
import { parseArgs } from 'node:util';

class HeaderGenerator {
    constructor() {
        // Promisify gzip for async/await usage
        this.gzipAsync = promisify(gzip);

        // Parse command line arguments
        const { values, positionals } = parseArgs({
            args: process.argv.slice(2),
            options: {
                out: { type: 'string', short: 'o', default: 'firmware/include' },
            },
            allowPositionals: true,
        });

        this.inputPath = positionals[0];
        this.outputDir = values.out;
    }

    // Validates input arguments and file existence.
    validate() {
        // Check if an input file was provided
        if (!this.inputPath) {
            console.error("Usage: node tools/html2h.mjs <input_file> [--out <dir>]");
            process.exit(1);
        }

        // Check if the input file actually exists
        if (!existsSync(this.inputPath)) {
            console.error(`Error: File ${this.inputPath} not found.`);
            process.exit(1);
        }
    }

    // Minifies HTML content using html-minifier-terser.
    async minifyContent(content) {
        try {
            return await minify(content, {
                collapseWhitespace: true,
                removeComments: true,
                minifyCSS: true,
                minifyJS: true,
                removeOptionalTags: true,
                removeRedundantAttributes: true,
                removeScriptTypeAttributes: true,
                removeStyleLinkTypeAttributes: true,
                useShortDoctype: true
            });
        } catch (e) {
            console.error("Minification failed:", e.message);
            process.exit(1);
        }
    }

    // Compress the minified content with maximum compression level
    async compressContent(content) {
        return await this.gzipAsync(Buffer.from(content, 'utf-8'), { level: 9 });
    }

    // Generates the C++ header file content.
    generateHeaderContent(headerGuard, filename, gzippedSize, variableName, hexArray) {
        return `#ifndef ${headerGuard}
#define ${headerGuard}

#include <Arduino.h>

// Source: ${filename}
// Size: ${gzippedSize} bytes (Gzipped)

static const size_t ${variableName}_len = ${gzippedSize};
static const uint8_t ${variableName}[] PROGMEM = {
    ${hexArray}
};

#endif
`;
    }

    // Main execution method to process the file.
    async execute() {
        this.validate();
        const filename = basename(this.inputPath);

        // Sanitize filename for C variable naming
        const nameBase = filename.replace(/\./g, '_').toLowerCase(),
            outputBase = filename.endsWith('.html') ? `${nameBase}_html` : nameBase;

        // Define variable name for C array
        const variableName = `${outputBase}_gz`,
            headerFilename = `${outputBase}.h`,
            outputPath = join(this.outputDir, headerFilename),
            headerGuard = `${outputBase.toUpperCase()}_H`;

        console.log(`Processing ${filename}...`);

        // Read the input file content
        const content = await readFile(this.inputPath, 'utf-8');
        const originalSize = Buffer.byteLength(content);

        // Minify the content
        const minified = await this.minifyContent(content);

        // Compress the content
        const gzipped = await this.compressContent(minified);
        const gzippedSize = gzipped.length;

        // Calculate compression ratio
        const ratio = (1 - (gzippedSize / originalSize)) * 100;
        console.log(`  Compressed: ${originalSize} -> ${gzippedSize} bytes (${ratio.toFixed(1)}% reduction)`);

        // Convert buffer to hex string array
        const hexArray = Array.from(gzipped)
            .map(b => '0x' + b.toString(16).padStart(2, '0'))
            .join(', ');

        // Create output directory if it doesn't exist
        if (!existsSync(this.outputDir))
            mkdirSync(this.outputDir, { recursive: true });

        // Generate the final C++ header content
        const fileContent = this.generateHeaderContent(headerGuard, filename, gzippedSize, variableName, hexArray);

        // Write the header file to disk
        await writeFile(outputPath, fileContent);
        console.log(`Created: ${outputPath}`);
    }
}

// Run the generator
new HeaderGenerator().execute();