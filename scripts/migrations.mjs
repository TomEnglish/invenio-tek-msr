// The migration files as scripts/database.sh reads them, and the comparison
// of a database's recorded history with those files. Reads files only; it
// never connects to a database.
//
//   node scripts/migrations.mjs list                 version|name|md5|shape, in filename order
//   node scripts/migrations.mjs shape <file>         plain | wrapped
//   node scripts/migrations.mjs without-commit <file>   a wrapped migration up to its final COMMIT;
//   node scripts/migrations.mjs pending               files the history on stdin does not have yet
//   node scripts/migrations.mjs differing             files whose recorded text differs (every file must be recorded, under its name)
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
// Text is compared without its trailing newlines: the history stores a file
// with or without the last one, depending on the tool that recorded it.
export const textChecksum = text => createHash('md5').update(text.replace(/\n+$/, '')).digest('hex');

// The SQL with every comment, quoted string and dollar-quoted body blanked
// out (same length, same line breaks). What is left is top-level SQL, so a
// COMMIT; inside a function body or a comment is not mistaken for the
// migration's own.
export function topLevelSql(text) {
    const blank = chunk => chunk.replace(/[^\n]/g, ' ');
    const wordBefore = index => /[A-Za-z_0-9]/.test(text[index - 1] || '');
    let out = '';
    let i = 0;
    while (i < text.length) {
        let stop = i;
        if (text.startsWith('--', i)) {
            const end = text.indexOf('\n', i);
            stop = end === -1 ? text.length : end;
        } else if (text.startsWith('/*', i)) {
            let depth = 1;
            stop = i + 2;
            while (stop < text.length && depth) {
                if (text.startsWith('/*', stop)) { depth += 1; stop += 2; }
                else if (text.startsWith('*/', stop)) { depth -= 1; stop += 2; }
                else stop += 1;
            }
        } else if (text[i] === "'" || text[i] === '"') {
            const quote = text[i];
            // Only an E'...' string treats a backslash as an escape.
            const escapes = quote === "'" && /[Ee]/.test(text[i - 1] || '') && !wordBefore(i - 1);
            stop = i + 1;
            while (stop < text.length) {
                if (escapes && text[stop] === '\\') stop += 2;
                else if (text[stop] === quote && text[stop + 1] === quote) stop += 2;
                else if (text[stop] === quote) { stop += 1; break; }
                else stop += 1;
            }
        } else {
            const tag = wordBefore(i) ? null : /^\$([A-Za-z_][A-Za-z_0-9]*)?\$/.exec(text.slice(i, i + 80));
            if (tag) {
                const end = text.indexOf(tag[0], i + tag[0].length);
                stop = end === -1 ? text.length : end + tag[0].length;
            }
        }
        if (stop > i) { out += blank(text.slice(i, Math.min(stop, text.length))); i = Math.min(stop, text.length); }
        else { out += text[i]; i += 1; }
    }
    return out;
}

// Top-level statements, each with where it starts in the text.
function topLevelStatements(text) {
    const sql = topLevelSql(text);
    const found = [];
    let start = 0;
    for (let i = 0; i <= sql.length; i++) {
        if (i < sql.length && sql[i] !== ';') continue;
        const raw = sql.slice(start, i);
        if (raw.trim()) found.push({ text: raw.trim().replace(/\s+/g, ' '), start: start + raw.length - raw.trimStart().length, ended: i < sql.length });
        start = i + 1;
    }
    return found;
}

const SHAPE_RULE = 'must either have no transaction statement of its own, or start with BEGIN; and end with COMMIT;';
const CLIENT_RULE = 'must be SQL only: a backslash command of the database client could run outside its transaction';
const TRANSACTION = /^(BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION)\b/i;
function readShape(text) {
    // A backslash outside a string or comment starts a command of the database
    // client (\gexec, \connect, \i), which can end the transaction or run
    // outside it. A migration is SQL only.
    if (topLevelSql(text).includes('\\')) return { shape: 'mixed', rule: CLIENT_RULE };
    const statements = topLevelStatements(text);
    const control = statements.filter(statement => TRANSACTION.test(statement.text));
    if (!control.length) return { shape: 'plain' };
    const last = statements.at(-1);
    return control.length === 2 && /^BEGIN$/i.test(statements[0].text) && /^COMMIT$/i.test(last.text) && last.ended
        ? { shape: 'wrapped', commitAt: last.start }
        : { shape: 'mixed', rule: SHAPE_RULE };
}

// How a migration handles its own transaction. A migration and its history
// record must commit together, which is only possible for these two shapes:
//   plain    no transaction statement of its own (001 to 011)
//   wrapped  BEGIN; is its first statement and COMMIT; its last, and it has
//            no other transaction statement
// Anything else ("mixed") could commit half of a migration, and is refused.
export const migrationShape = text => readShape(text).shape;
// Why a migration cannot be applied as one transaction, or null when it can.
export const migrationProblem = text => readShape(text).rule || null;

// A wrapped migration up to its final COMMIT;, so the history record can be
// added inside the migration's own transaction.
export function withoutCommit(text) {
    const { shape, commitAt } = readShape(text);
    if (shape !== 'wrapped') throw new Error('Only a migration wrapped in BEGIN; and COMMIT; has a COMMIT; to leave out');
    return text.slice(0, commitAt);
}

// Every migration, in the order it is applied: filename order, which must
// also be the order of the version numbers the history is sorted by.
export function migrationFiles(directory = join(root, MIGRATIONS)) {
    const names = readdirSync(directory).filter(name => name.endsWith('.sql')).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const files = names.map(file => {
        const match = FILE.exec(file);
        if (!match) throw new Error(`A migration must be named <number>_<lowercase_name>.sql: ${file}`);
        const text = readFileSync(join(directory, file), 'utf8');
        const problem = migrationProblem(text);
        if (problem) throw new Error(`${file} ${problem}`);
        return { file, path: join(MIGRATIONS, file), version: match[1], name: match[2], md5: textChecksum(text), shape: migrationShape(text) };
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
export function compareHistory(recorded, files, { namesOnly = false, complete = false } = {}) {
    const problems = [];
    // `complete`: every file must already be recorded, none more and none fewer.
    if (complete && recorded.length < files.length) {
        problems.push(`the database records ${recorded.length} migrations and there are ${files.length} migration files`);
    }
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
        const problem = migrationProblem(text);
        if (problem) throw new Error(`${argument} ${problem}`);
        console.log(migrationShape(text));
        return;
    }
    if (command === 'pending' || command === 'differing') {
        const result = compareHistory(parseRecorded(readStdin()), migrationFiles(), { namesOnly: command === 'differing', complete: command === 'differing' });
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
