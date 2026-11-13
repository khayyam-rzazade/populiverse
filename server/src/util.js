// Small helpers shared by the routes.

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

// Reads a JSON body of at most `max` characters, or returns null.
export async function readBody(request, max = 400000) {
  const text = await request.text();
  if (text.length > max) return null;
  try {
    const data = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

export function now() {
  return new Date().toISOString();
}
