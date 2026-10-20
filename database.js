const { AsyncLocalStorage } = require("node:async_hooks");
const fs = require("node:fs");
const path = require("node:path");
const { Pool, types } = require("pg");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Falta DATABASE_URL. Configura la conexión PostgreSQL antes de arrancar O Pachanga.");
}

// PostgreSQL returns int8 and numeric values as strings by default. These fields
// are bounded to safe integer IDs and cent-based amounts in this application.
types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));

const pool = new Pool({ connectionString });
const transactionContext = new AsyncLocalStorage();

function toPostgresPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function query(sql, values = []) {
  const client = transactionContext.getStore() || pool;
  return client.query(toPostgresPlaceholders(sql), values);
}

const db = {
  prepare(sql) {
    return {
      async get(...values) {
        const result = await query(sql, values);
        return result.rows[0] || null;
      },
      async all(...values) {
        const result = await query(sql, values);
        return result.rows;
      },
      async run(...values) {
        const result = await query(sql, values);
        return {
          changes: result.rowCount,
          lastInsertRowid: result.rows[0]?.id,
        };
      },
    };
  },

  async exec(sql) {
    return query(sql);
  },

  getPool() {
    return pool;
  },

  transaction(callback) {
    return async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await transactionContext.run(client, callback);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
  },

  async initialize() {
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await pool.query(schema);

    const userColumns = [
      ["first_name", "TEXT"],
      ["last_name", "TEXT"],
      ["alias", "TEXT"],
      ["password_hash", "TEXT"],
      ["account_status", "TEXT NOT NULL DEFAULT 'active'"],
      ["must_change_password", "INTEGER NOT NULL DEFAULT 0"],
      ["deleted_at", "TEXT"],
      ["created_at", "TEXT"],
      ["photo_url", "TEXT"],
      ["strong_points", "TEXT NOT NULL DEFAULT ''"],
      ["weak_points", "TEXT NOT NULL DEFAULT ''"],
      ["preferred_position", "TEXT NOT NULL DEFAULT ''"],
      ["other_details", "TEXT NOT NULL DEFAULT ''"],
      ["base_role", "TEXT NOT NULL DEFAULT 'principal'"],
    ];
    for (const [column, definition] of userColumns) {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
    }

    const matchColumns = [
      ["match_date", "TEXT"],
      ["match_time", "TEXT NOT NULL DEFAULT '20:00'"],
      ["pitch_price", "NUMERIC(12, 2)"],
    ];
    for (const [column, definition] of matchColumns) {
      await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
    }

    const convocationColumns = [["invited_by_user_id", "BIGINT REFERENCES users(id) ON DELETE SET NULL"]];
    for (const [column, definition] of convocationColumns) {
      await pool.query(`ALTER TABLE convocations ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
    }

    const transactionColumns = [
      ["match_id", "BIGINT REFERENCES matches(id)"],
      ["transaction_type", "TEXT NOT NULL DEFAULT 'manual'"],
      ["adjustment_of", "BIGINT REFERENCES transactions(id)"],
      ["status", "TEXT NOT NULL DEFAULT 'posted'"],
      ["adjusted_by", "BIGINT REFERENCES users(id)"],
      ["adjusted_at", "TEXT"],
    ];
    for (const [column, definition] of transactionColumns) {
      await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
    }

    await pool.query(`
      UPDATE users SET base_role = role
      WHERE role IN ('principal', 'suplente') AND base_role NOT IN ('principal', 'suplente')
    `);
    await pool.query(`
      UPDATE matches
      SET match_date = ((start_date::date + INTERVAL '7 days')::date)::text
      WHERE match_date IS NULL
    `);
    await pool.query(`
      UPDATE matches
      SET match_time = CASE
        WHEN substring(end_date FROM 12 FOR 5) ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
          THEN substring(end_date FROM 12 FOR 5)
        ELSE '20:00'
      END
      WHERE match_time IS NULL OR trim(match_time) = ''
    `);
    await pool.query(`
      UPDATE transactions
      SET match_id = substring(concept FROM '^Partido #([0-9]+): cuota automática$')::bigint,
          transaction_type = 'match_charge'
      WHERE transaction_type = 'manual'
        AND concept ~ '^Partido #[0-9]+: cuota automática$'
        AND EXISTS (
          SELECT 1 FROM matches
          WHERE matches.id = substring(transactions.concept FROM '^Partido #([0-9]+): cuota automática$')::bigint
        )
    `);
  },

  async close() {
    await pool.end();
  },
};

module.exports = db;
