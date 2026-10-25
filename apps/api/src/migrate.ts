// Creates (or updates) the SkillIssue tables in your Tiger Cloud service.
// Usage: DATABASE_URL=postgres://... npm run db:migrate   (or put it in apps/api/.env)
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "./db.ts";

const schema = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../db/schema.sql"), "utf8");
const pool = db();
try {
	await pool.query(schema);
	const { rows } = await pool.query(
		"select hypertable_name from timescaledb_information.hypertables order by 1"
	);
	console.log(`Schema ready. Hypertables: ${rows.map((r) => r.hypertable_name).join(", ")}`);
} catch (e) {
	console.error("Migration failed:", (e as Error).message);
	process.exitCode = 1;
} finally {
	await pool.end();
}
