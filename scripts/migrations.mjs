// The migration files as scripts/database.sh reads them, and the comparison
// of a database's recorded history with those files. Reads files only; it
// never connects to a database.
//
//   node scripts/migrations.mjs list                 version|name|md5|shape, in filename order
//   node scripts/migrations.mjs shape <file>         plain | wrapped
//   node scripts/migrations.mjs without-commit <file>   a wrapped migration up to its COMMIT; line
//   node scripts/migrations.mjs pending               files the history on stdin does not have yet
//   node scripts/migrations.mjs differing             files whose recorded text differs (names must match)
//
// `pending` and `differing` read the recorded history on stdin, one line per
// migration: version|name|md5 of its text|number of parts it was stored in.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS = join('supabase', 'migrations');
const FILE = /^([0-9]+)_([a-z0-9_]+)\.sql$/;
const isBegin = line => /^\s*BEGIN\s*;\s*$/i.test(line);
const isCommit = line => /^\s*COMMIT\s*;\s*$/i.test(line);

// Text is compared without its trailing newlines: the history stores a file
// with or without the last one, depending on the tool that recorded it.
export const textChecksum = text => createHash('md5').update(text.replace(/\n+$/, '')).digest('hex');

// How a migration handles its own transaction. A migration and its history
// record must commit together, which is only possible for these two shapes:
//   plain    no BEGIN; or COMMIT; line (001 to 011)
//   wrapped  BEGIN; is its first statement and COMMIT; its last line
// Anything else ("mixed") could commit half of a migration, and is refused.
export function migrationShape(text) {
    const lines = text.split('\n');
    const begins = lines.filter(isBegin).length;
    const commits = lines.filter(isCommit).length;
    if (!begins && !commits) return 'plain';
    const statements = lines.filter(line => line.trim() && !line.trim().startsWith('--'));
    return begins === 1 && commits === 1 && isBegin(statements[0]) && isCommit(statements.at(-1)) ? 'wrapped' : 'mixed';
}

// A wrapped migration without its final COMMIT; line, so the history record
// can be added inside the migration's own transaction.
export function withoutCommit(text) {
    if (migrationShape(text) !== 'wrapped') throw new Error('Only a migration wrapped in BEGIN; and COMMIT; has a COMMIT; line to leave out');
    const lines = text.split('\n');
    return lines.slice(0, lines.findLastIndex(isCommit)).join('\n') + '\n';
}

// Every migration, in the order it is applied: filename order, which must
// also be the order of the version numbers the history is sorted by.
export function migrationFiles(directory = join(root, MIGRATIONS)) {
    const names = readdirSync(directory).filter(name => name.endsWith('.sql')).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const files = names.map(file => {
        const match = FILE.exec(file);
        if (!match) throw new Error(`A migration must be named <number>_<lowercase_name>.sql: ${file}`);
        const text = readFileSync(join(directory, file), 'utf8');
        const shape = migrationShape(text);
        if (shape === 'mixed') throw new Error(`${file} must either have no BEGIN; or COMMIT; line, or start with BEGIN; and end with COMMIT;`);
        return { file, path: join(MIGRATIONS, file), version: match[1], name: match[2], md5: textChecksum(text), shape };
    });
    files.forEach((entry, index) => {
        if (index && !(files[index - 1].version < entry.version)) {
            throw new Error(`${entry.file} must have a later number than ${files[index - 1].file}; the history is kept in number order`);
        }
    });
    return files;
}

export function parseRecorded(text) {
    return text.split('\n').filter(Boolean).map(line => {
        const [version, name, md5, parts] = line.split('|');
        return { version, name, md5, parts: Number(parts) };
    });
}

// What a database has recorded, against the files. `problems` is empty only
// when the history is exactly the first files, in order: same numbers, same
// names and (unless namesOnly) the same text. Then `pending` lists the files
// not applied yet. `differing` lists files recorded under the right number
// and name but with other text.
export function compareHistory(recorded, files, { namesOnly = false } = {}) {
    const problems = [];
    const differing = [];
    const label = entry => `${entry.version}_${entry.name}`;
    recorded.forEach((row, index) => {
        const file = files[index];
        if (!file) { problems.push(`the database has ${label(row)}, which is not among the migration files`); return; }
        if (row.version !== file.version || row.name !== file.name) {
            problems.push(`migration ${index + 1} is ${label(row)} in the database and ${label(file)} in the files`);
            return;
        }
        if (row.parts === 1 && row.md5 === file.md5) return;
        differing.push(file);
        if (!namesOnly) {
            problems.push(row.parts === 1
                ? `${label(file)} was recorded with different text than the file has now`
                : `${label(file)} was recorded in ${row.parts} parts, not as the file`);
        }
    });
    return { problems, differing, pending: problems.length ? [] : files.slice(recorded.length) };
}

function readStdin() { return readFileSync(0, 'utf8'); }

function main([command, argument]) {
    if (command === 'list') {
        for (const entry of migrationFiles()) console.log([entry.version, entry.name, entry.md5, entry.shape].join('|'));
        return;
    }
    if (command === 'shape' || command === 'without-commit') {
        if (!argument) throw new Error(`Usage: migrations.mjs ${command} <file>`);
        const text = readFileSync(argument, 'utf8');
        if (command === 'without-commit') { process.stdout.write(withoutCommit(text)); return; }
        const shape = migrationShape(text);
        if (shape === 'mixed') throw new Error(`${argument} must either have no BEGIN; or COMMIT; line, or start with BEGIN; and end with COMMIT;`);
        console.log(shape);
        return;
    }
    if (command === 'pending' || command === 'differing') {
        const result = compareHistory(parseRecorded(readStdin()), migrationFiles(), { namesOnly: command === 'differing' });
        if (result.problems.length) throw new Error(result.problems.join('\n'));
        for (const entry of command === 'pending' ? result.pending : result.differing) console.log(entry.path);
        return;
    }
    throw new Error('Usage: migrations.mjs list | shape <file> | without-commit <file> | pending | differing');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { main(process.argv.slice(2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
