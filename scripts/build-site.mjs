import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const browserExtensions = new Set(['.html', '.css', '.js', '.png', '.svg', '.ico', '.webmanifest']);
const manifests = new Set(['manifest.json']);

rmSync(output, { recursive: true, force: true });
mkdirSync(output);

for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && (browserExtensions.has(extname(entry.name)) || manifests.has(entry.name))) {
        cpSync(join(root, entry.name), join(output, entry.name));
    }
}

// These directories contain assets referenced by the existing browser pages.
for (const directory of ['js', 'brand']) {
    cpSync(join(root, directory), join(output, directory), {
        recursive: true,
        filter: (source) => {
            const entry = lstatSync(source);
            return entry.isDirectory() || (entry.isFile()
                && (browserExtensions.has(extname(source)) || extname(source) === '.json'));
        },
    });
}

for (const page of ['index.html', 'login.html', 'user-admin.html', 'projects.html', 'audit.html']) {
    if (!existsSync(join(output, page))) throw new Error(`Required release page missing: ${page}`);
}
console.log(`Built MSR browser assets in ${output}`);

const commit = process.env.COMMIT_REF || process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Release commit must be a full Git SHA');
const assets = Object.fromEntries([
    'index.html', 'login.html', 'work-inbox.html', 'record.html', 'dashboard.js', 'work-pages.js',
    'styles.css', 'js/utils/data-health.js', 'js/utils/work-summary.js', 'js/utils/pdf-export.js',
    'js/utils/auth-guard.js', 'js/utils/project-scope.js',
].map(file => [file, createHash('sha256').update(readFileSync(join(output, file))).digest('hex')]));
writeFileSync(join(output, 'release.json'), JSON.stringify({ commit, assets }, null, 2) + '\n');
