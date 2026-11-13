import { createFileRoute } from "@tanstack/react-router";
import { isServerlessHost } from "@/lib/db";
import { auth } from "@/lib/auth/server";

const AUTH_UNAVAILABLE =
  "DATABASE_URL is not set. Sign-in is unavailable until Postgres is configured on this host.";

function readDatabaseUrl(): string | undefined {
  try {
    const value = process.env.DATABASE_URL?.trim();
    return value ? value : undefined;
  } catch {
    return undefined;
  }
}

function unavailable(message: string): Response {
  return Response.json({ error: message }, { status: 503 });
}

async function handle(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!readDatabaseUrl() && isServerlessHost()) {
    // Session polls run on every page. Answer "signed out" so the shell
    // renders; sign-in itself still needs Postgres.
    if (request.method === "GET" && path.endsWith("/get-session")) {
      return Response.json(null);
    }
    return unavailable(AUTH_UNAVAILABLE);
  }

  try {
    return await auth.handler(request);
  } catch (error) {
    console.error("[auth] request failed", error);
    const message = error instanceof Error ? error.message : "Auth is unavailable";
    return unavailable(message);
  }
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
