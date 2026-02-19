import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

class InkplateImageProcessor {
    // Device Constraints
    static TARGETS = {
        INKPLATE10: {
            maxW: 1200,
            maxH: 825,
            def: "ARDUINO_INKPLATE10V2",
            file: "logo"
        },
        INKPLATE6COLOR: {
            maxW: 600,
            maxH: 448,
            def: "ARDUINO_INKPLATECOLOR",
            file: "logo_6color"
        }
    };

    constructor() {
        // Parse command line arguments in the constructor
        const { values, positionals } = parseArgs({
            args: process.argv.slice(2),
            options: {
                scale: { type: 'string', short: 's', default: '0.666' },
                outSrc: { type: 'string', default: 'firmware/src/images' },
                outInc: { type: 'string', default: 'firmware/include/images' }
            },
            allowPositionals: true,
        });

        this.inputFile = positionals[0];
        this.scale = parseFloat(values.scale);
        this.srcDir = values.outSrc;
        this.incDir = values.outInc;
    }

    // Validates input files and creates necessary directories
    validate() {
        // Check if an input file was provided
        if (!this.inputFile) {
            console.error("Usage: node tools/img2logo.mjs <input_file> [--scale 0.666]");
            process.exit(1);
        }

        // Check if the input file actually exists
        if (!existsSync(this.inputFile)) {
            console.error(`❌ Error: Input file '${this.inputFile}' not found.`);
            process.exit(1);
        }

        // Create output directories if they are missing
        if (!existsSync(this.srcDir))
            mkdirSync(this.srcDir, { recursive: true });
        if (!existsSync(this.incDir))
            mkdirSync(this.incDir, { recursive: true });
    }

    // Apple PackBits RLE Compression implementation
    packBitsRLE(data) {
        const output = [];
        let i = 0;
        while (i < data.length) {
            let j = i + 1;
            // Find a run of identical bytes
            while (j < data.length && (j - i) < 127 && data[j] === data[j - 1])
                j++;
            if (j - i > 1) { // Process run of 2 or more identical bytes
                output.push(257 - (j - i)); // Store control byte: -count + 1
                output.push(data[i]);
                i = j;
            } else { // Process literal run
                j = i + 1;
                while (j < data.length && (j - i) < 128) {
                    if (j + 1 < data.length && data[j] === data[j + 1])
                        break;
                    j++;
                }
                output.push(j - i - 1); // Store control byte: count - 1
                for (let k = i; k < j; k++)
                    output.push(data[k]);
                i = j;
            }
        }
        return Buffer.from(output);
    }

    // Clamps a numeric value between 0 and 255
    clamp(val) {
        return Math.max(0, Math.min(255, val));
    }

    // Resizes, dithers, and compresses the image
    async processTarget(imgBuffer, target) {
        const initialMeta = await sharp(imgBuffer).metadata(),
            ratio = Math.min(target.maxW / initialMeta.width, target.maxH / initialMeta.height) * this.scale,
            newW = Math.round(initialMeta.width * ratio),
            newH = Math.round(initialMeta.height * ratio);

        // Resize, flatten, and convert to 1-bit raw
        const { data: rawPixels, info } = await sharp(imgBuffer)
            .resize(newW, newH, { kernel: 'lanczos3' })
            .flatten({ background: '#ffffff' })
            .grayscale()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const width = info.width,
            height = info.height,
            dithered = new Uint8Array(rawPixels.length);

        // Invert grayscale (White 255 -> 0, Black 0 -> 255)
        for (let i = 0; i < rawPixels.length; i++)
            dithered[i] = 255 - rawPixels[i];

        // Manual Floyd-Steinberg Dithering
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const idx = y * width + x,
                    oldPixel = dithered[idx],
                    newPixel = oldPixel < 128 ? 0 : 255;
                dithered[idx] = newPixel;
                const error = oldPixel - newPixel;
                if (x + 1 < width)
                    dithered[idx + 1] = this.clamp(dithered[idx + 1] + (error * 7) / 16);
                if (x - 1 >= 0 && y + 1 < height)
                    dithered[idx + width - 1] = this.clamp(dithered[idx + width - 1] + (error * 3) / 16);
                if (y + 1 < height)
                    dithered[idx + width] = this.clamp(dithered[idx + width] + (error * 5) / 16);
                if (x + 1 < width && y + 1 < height)
                    dithered[idx + width + 1] = this.clamp(dithered[idx + width + 1] + (error * 1) / 16);
            }

        // Pack 1-bit pixels into bytes
        const bytesPerRow = Math.ceil(width / 8),
            packed = new Uint8Array(bytesPerRow * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (dithered[y * width + x] > 127) { // Black/Ink
                    const byteIdx = y * bytesPerRow + Math.floor(x / 8),
                        bitIdx = 7 - (x % 8);
                    packed[byteIdx] |= (1 << bitIdx);
                }
            }
        }

        // Apply RLE compression
        const compressed = this.packBitsRLE(packed);

        // Return compressed data
        return {
            w: width,
            h: height,
            data: compressed,
            rawLen: packed.length
        };
    }

    // Generates C++ source and header file content.
    generateCpp(varName, width, height, data, deviceDef, headerFile) {
        const hex = Array.from(data).map(b => `0x${b.toString(16).toUpperCase().padStart(2, '0')}`);
        const lines = [];
        for (let i = 0; i < hex.length; i += 16)
            lines.push('    ' + hex.slice(i, i + 16).join(', '));

        return `#include <Arduino.h>
#include "images/${headerFile}.h"

#ifdef ${deviceDef}
const int ${varName}_w = ${width};
const int ${varName}_h = ${height};
const int ${varName}_len = ${data.length};
const unsigned char PROGMEM ${varName}_img[] = {
${lines.join(',\n')}
};
#endif\n`;
    }

    generateHeader(varName, deviceDef) {
        const guard = varName.toUpperCase() + '_H';
        return `#ifndef ${guard}
#define ${guard}

#include <Arduino.h>
#ifdef ${deviceDef}
extern const unsigned char ${varName}_img[];
extern const int ${varName}_w;
extern const int ${varName}_h;
extern const int ${varName}_len;
#endif

#endif\n`;
    }

    // Main execution method.
    async execute() {
        if (!this.inputFile || !existsSync(this.inputFile)) {
            console.error("Input file missing or not found.");
            process.exit(1);
        }

        if (!existsSync(this.srcDir))
            mkdirSync(this.srcDir, { recursive: true });
        if (!existsSync(this.incDir))
            mkdirSync(this.incDir, { recursive: true });

        const imgBuffer = await readFile(this.inputFile),
            initialSize = imgBuffer.length;

        console.log(`Processing '${this.inputFile}'...`);
        for (const [key, target] of Object.entries(InkplateImageProcessor.TARGETS)) {
            // Process target
            const metadata = await sharp(imgBuffer).metadata(),
                { w, h, data, rawLen } = await this.processTarget(imgBuffer, target),
                compressedSize = data.length,
                saving = ((1 - (compressedSize / rawLen)) * 100).toFixed(1);

            // Write output files
            await writeFile(join(this.srcDir, `${target.file}.cpp`), this.generateCpp("logo", w, h, data, target.def, target.file));
            await writeFile(join(this.incDir, `${target.file}.h`), this.generateHeader("logo", target.def));

            // Log results
            console.log(`  ${key}:`);
            console.log(`    Initial:    ${metadata.width}x${metadata.height} (${initialSize} bytes)`);
            console.log(`    Resized:    ${w}x${h} (${rawLen} bytes, 1-bit raw)`);
            console.log(`    Compressed: ${compressedSize} bytes (RLE)`);
            console.log(`    Reduction:  ${saving}% from 1-bit buffer\n`);
        }
        console.log("Operation completed.");
    }
}

// Run the processor
new InkplateImageProcessor().execute();