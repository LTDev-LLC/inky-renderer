import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

class SecretsConverter {
    constructor() {
        // Parse command line arguments
        const { values, positionals } = parseArgs({
            args: process.argv.slice(2),
            options: {
                out: { type: 'string', short: 'o', default: '.dev.vars' },
                force: { type: 'boolean', short: 'f', default: false },
            },
            allowPositionals: true,
        });

        this.inputFile = positionals[0] || '.secrets.json';
        this.outputFile = values.out;
        this.force = values.force;
    }

    // Validates that the input file exists and the output path is safe.
    validate() {
        // Check if the specified input file exists
        if (!existsSync(this.inputFile)) {
            console.error(`Error: Input file '${this.inputFile}' not found.`);
            process.exit(1);
        }

        // Prevent overwriting the output file unless the force flag is used
        if (existsSync(this.outputFile) && !this.force) {
            console.error(`Error: Output file '${this.outputFile}' already exists.`);
            console.error("Use --force to overwrite it, or manually delete it first.");
            process.exit(1);
        }
    }

    // Reads the input file and parses it as JSON.
    async loadInput() {
        try {
            return JSON.parse(await readFile(this.inputFile, 'utf-8'));
        } catch (e) {
            console.error(`Error parsing JSON from '${this.inputFile}': ${e.message}`);
            process.exit(1);
        }
    }

    // Converts JSON data to .dev.vars format and writes to disk.
    async generateOutput(data) {
        try {
            let outputContent = '',
                count = 0;

            // Write each key=value pair to the output file
            for (const [key, value] of Object.entries(data)) {
                // Serialize objects/arrays to JSON strings, otherwise convert to string
                const valStr = (typeof value === 'object' && value !== null)
                    ? JSON.stringify(value)
                    : String(value);

                outputContent += `${key}=${valStr}\n`;
                count++;
            }

            // Write the output file
            await writeFile(this.outputFile, outputContent, 'utf-8');
            console.log(`Success! Generated '${this.outputFile}' with ${count} variables from '${this.inputFile}'.`);
            console.log("You can now run 'npm run dev' or 'npx wrangler dev'.");
        } catch (e) {
            console.error(`Error writing to '${this.outputFile}': ${e.message}`);
            process.exit(1);
        }
    }

    // Main execution flow
    async execute() {
        this.validate();

        // Wait for the file to be read and parsed
        const data = await this.loadInput();

        // Process the data and write the output file
        await this.generateOutput(data);
    }
}

// Instantiate and run the converter
new SecretsConverter().execute();