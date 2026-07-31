/**
 * Structural fingerprint of a libSQL database.
 *
 * Built from PRAGMA output rather than sqlite_master DDL text: production was
 * created by `drizzle-kit push`, which quotes identifiers and cases keywords
 * differently from the generated migration files. Comparing DDL strings would
 * report differences that do not exist.
 */

const LEDGER_TABLE = "__drizzle_migrations";

const quote = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`;

async function describeTable(client, table) {
  const columns = await client.execute(`PRAGMA table_info(${quote(table)})`);
  const foreignKeys = await client.execute(`PRAGMA foreign_key_list(${quote(table)})`);
  const indexList = await client.execute(`PRAGMA index_list(${quote(table)})`);

  const indexes = {};
  for (const index of indexList.rows) {
    const info = await client.execute(`PRAGMA index_info(${quote(index.name)})`);
    const indexColumns = info.rows.map((row) => String(row.name));
    // Implicit primary-key and UNIQUE indexes are named positionally
    // (sqlite_autoindex_<table>_N), so the number shifts when an unrelated
    // constraint is added or removed. Key those by what they constrain; only
    // explicit CREATE INDEX names (origin "c") are stable identifiers.
    const key =
      index.origin === "c" ? String(index.name) : `${index.origin}:${indexColumns.join(",")}`;
    indexes[key] = { unique: Number(index.unique), columns: indexColumns };
  }

  return {
    // Keyed by name, not position: `push` emits columns in schema declaration
    // order while migrations append them, so order carries no information.
    columns: Object.fromEntries(
      columns.rows.map((row) => [
        String(row.name),
        {
          type: String(row.type),
          notNull: Number(row.notnull),
          default: row.dflt_value ?? null,
          primaryKey: Number(row.pk),
        },
      ]),
    ),
    foreignKeys: foreignKeys.rows
      .map((fk) => `${fk.from}->${fk.table}.${fk.to} upd=${fk.on_update} del=${fk.on_delete}`)
      .sort(),
    indexes,
  };
}

export async function buildFingerprint(client) {
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );

  const fingerprint = {};
  for (const row of tables.rows) {
    const table = String(row.name);
    // The ledger is bookkeeping, not schema. Excluding it lets an already
    // migrated database compare equal to a fresh replay of the same migrations.
    if (table === LEDGER_TABLE) continue;
    fingerprint[table] = await describeTable(client, table);
  }
  return fingerprint;
}

export function diffFingerprints(expected, actual) {
  const differences = [];
  const tables = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();

  for (const table of tables) {
    const want = expected[table];
    const got = actual[table];

    if (!want) {
      differences.push(`unexpected table ${table}`);
      continue;
    }
    if (!got) {
      differences.push(`missing table ${table}`);
      continue;
    }

    const columns = [...new Set([...Object.keys(want.columns), ...Object.keys(got.columns)])].sort();
    for (const column of columns) {
      const a = JSON.stringify(want.columns[column] ?? null);
      const b = JSON.stringify(got.columns[column] ?? null);
      if (a !== b) differences.push(`${table}.${column}: expected ${a}, found ${b}`);
    }

    if (JSON.stringify(want.foreignKeys) !== JSON.stringify(got.foreignKeys)) {
      differences.push(
        `${table} foreign keys: expected ${JSON.stringify(want.foreignKeys)}, found ${JSON.stringify(got.foreignKeys)}`,
      );
    }

    const indexKeys = [...new Set([...Object.keys(want.indexes), ...Object.keys(got.indexes)])].sort();
    for (const key of indexKeys) {
      const a = JSON.stringify(want.indexes[key] ?? null);
      const b = JSON.stringify(got.indexes[key] ?? null);
      if (a !== b) differences.push(`${table} index ${key}: expected ${a}, found ${b}`);
    }
  }

  return differences;
}
