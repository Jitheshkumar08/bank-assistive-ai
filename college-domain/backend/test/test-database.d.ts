/** Loads .env.test and returns its DATABASE_URL, refusing any database whose name does not end in "_test". */
export function loadTestDatabaseUrl(): { url: string; values: Record<string, string> }
