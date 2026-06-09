import Database from "better-sqlite3";
import { defineNode } from "../../../core/node.js";
import {
	type SqliteQueryInput,
	SqliteQueryInputSchema,
	SqliteQueryOutputSchema,
} from "./schemas.js";

export const sqliteQueryNode = defineNode({
	type: "sqlite_query",
	name: "SQLite Query",
	category: "action",
	inputSchema: SqliteQueryInputSchema,
	outputSchema: SqliteQueryOutputSchema,
	executor: async (input: SqliteQueryInput) => {
		const db = new Database(input.dbPath);
		try {
			const stmt = db.prepare(input.query);

			if (input.mode === "run") {
				const info = stmt.run(...(input.params as unknown[]));
				return {
					success: true,
					output: {
						changes: info.changes,
						lastInsertRowid: Number(info.lastInsertRowid),
					},
				};
			}

			if (input.mode === "get") {
				const row = stmt.get(...(input.params as unknown[]));
				return {
					success: true,
					output: { rows: row ? [row as Record<string, unknown>] : [] },
				};
			}

			// mode === "all"
			const rows = stmt.all(...(input.params as unknown[])) as Record<
				string,
				unknown
			>[];
			return {
				success: true,
				output: { rows },
			};
		} finally {
			db.close();
		}
	},
});
