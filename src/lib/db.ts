/** Which database backend is active. */
export type DbSource = "neon" | "pglite";

function readProcessEnv(name: string): string | undefined {
  try {
    if (typeof process === "undefined") return undefined;
    const value = process.env[name];
    return value && value.trim() ? value.trim() : undefined;
  } catch {
    // Workers can throw when process.env is touched outside a request.
    return undefined;
  }
}

/**
 * Vercel and Cloudflare Workers/Pages cannot bootstrap PGLite: there is no
 * wasm data file, and module-scope I/O is forbidden. `CF_PAGES` is only
 * present once the request env is populated, so the user-agent check covers
 * module evaluation too.
 *
 * `DATABASE_URL` is read again on each `getSql()` call. Cloudflare may leave
 * `process.env` empty while this module evaluates and fill it only inside the
 * request. A snapshot taken here would keep booking inserts on the "no
 * database" path after Postgres is configured.
 */
export function isServerlessHost(): boolean {
  try {
    if (typeof process !== "undefined") {
      if (process.env.VERCEL) return true;
      if (process.env.CF_PAGES === "1") return true;
    }
  } catch {
    return true;
  }
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return typeof ua === "string" && ua.includes("Cloudflare-Workers");
}

const serverlessHost = isServerlessHost();
/** Import-time only: decides whether to kick local PGLite before any request. */
const databaseUrlAtImport = readProcessEnv("DATABASE_URL");

/** Neon when DATABASE_URL is set at the moment of the call. PGLite otherwise. */
export function getDbSource(): DbSource {
  return readProcessEnv("DATABASE_URL") ? "neon" : "pglite";
}

export interface Sql {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

const globalRef = globalThis as typeof globalThis & {
  __pgSqlPromise__?: Promise<Sql>;
  __pgliteInstance__?: Promise<import("@electric-sql/pglite").PGlite>;
  __pgliteMigrateChain__?: Promise<void>;
};

const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;
const identity = (v: string) => v;

type Run = <T>(text: string, params: unknown[]) => Promise<T[]>;

function toSql(run: Run): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    run<T>(text, params);
  return sql;
}

function createNeonSql(connectionString: string): Promise<Sql> {
  globalRef.__pgSqlPromise__ ??= (async () => {
    const { Pool, types } = await import("pg");
    types.setTypeParser(OID_INT8, Number);
    types.setTypeParser(OID_DATE, identity);
    types.setTypeParser(OID_INTERVAL, identity);
    const pool = new Pool({ connectionString });
    return toSql(async <T>(text: string, params: unknown[]) => {
      const res = await pool.query(text, params);
      return res.rows as T[];
    });
  })().catch((err) => {
    globalRef.__pgSqlPromise__ = undefined;
    throw err;
  });
  return globalRef.__pgSqlPromise__;
}

async function createPgliteSql(): Promise<Sql> {
  globalRef.__pgliteInstance__ ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite({
      parsers: {
        [OID_INT8]: Number,
        [OID_DATE]: identity,
        [OID_INTERVAL]: identity,
      },
    });
    await pg.waitReady;
    await pg.exec(
      "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    return pg;
  })().catch((err) => {
    globalRef.__pgliteInstance__ = undefined;
    throw err;
  });
  const pg = await globalRef.__pgliteInstance__;

  const migrate = async (): Promise<void> => {
    const migrations = import.meta.glob("/migrations/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const doneRows = await pg.query<{ name: string }>("select name from _migrations");
    const done = new Set(doneRows.rows.map((r) => r.name));
    for (const [path, text] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
      const name = path.split("/").pop() as string;
      if (done.has(name)) continue;
      await pg.transaction(async (tx) => {
        await tx.exec(text);
        await tx.query("insert into _migrations (name) values ($1)", [name]);
      });
    }
  };
  const pass = (globalRef.__pgliteMigrateChain__ ?? Promise.resolve())
    .catch(() => undefined)
    .then(migrate);
  globalRef.__pgliteMigrateChain__ = pass;
  await pass;

  return toSql(async <T>(text: string, params: unknown[]) => {
    const result = await pg.query<T>(text, params);
    return result.rows;
  });
}

let sqlPromise: Promise<Sql> | null = null;
let sqlPromiseKey: string | null = null;

async function createSql(connectionString: string | undefined): Promise<Sql> {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/db is server-only — call getSql() from a createServerFn handler " +
        "or a server route loader, never from client code.",
    );
  }
  if (connectionString) return createNeonSql(connectionString);
  if (serverlessHost || isServerlessHost()) {
    throw new Error(
      "DATABASE_URL is not set. Booking storage is unavailable until Postgres is configured on this host.",
    );
  }
  return createPgliteSql();
}

export function getSql(): Promise<Sql> {
  const connectionString = readProcessEnv("DATABASE_URL");
  const key =
    connectionString ?? (serverlessHost || isServerlessHost() ? "serverless-missing" : "pglite");
  if (sqlPromise && sqlPromiseKey !== key) {
    sqlPromise = null;
    if (connectionString) globalRef.__pgSqlPromise__ = undefined;
  }
  sqlPromiseKey = key;
  sqlPromise ??= createSql(connectionString).catch((err) => {
    sqlPromise = null;
    sqlPromiseKey = null;
    throw err;
  });
  return sqlPromise;
}

export async function getPglite(): Promise<import("@electric-sql/pglite").PGlite> {
  if (serverlessHost || isServerlessHost() || readProcessEnv("DATABASE_URL")) {
    throw new Error("getPglite() is only available locally without DATABASE_URL");
  }
  await getSql();
  const pg = await globalRef.__pgliteInstance__;
  if (!pg) throw new Error("PGLite instance failed to initialize");
  return pg;
}

export function ensureDbReady(): Promise<void> {
  if (readProcessEnv("DATABASE_URL") || serverlessHost || isServerlessHost())
    return Promise.resolve();
  return getSql().then(() => undefined);
}

const globalBoot = globalThis as typeof globalThis & {
  __pgBootstrapPromise__?: Promise<void>;
};
if (typeof window === "undefined" && !databaseUrlAtImport && !serverlessHost) {
  globalBoot.__pgBootstrapPromise__ ??= ensureDbReady().catch((err) => {
    globalBoot.__pgBootstrapPromise__ = undefined;
    console.error("[db] PGLite bootstrap failed:", err);
  });
}
