export const API_BASE_URL =
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === "development"
    ? "http://localhost:5001"
    : "https://cart-it.com");

/** Timeout for fetch (ms). Uses AbortSignal.timeout when available. */
function timeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => {
    const e = new Error("Timeout");
    e.name = "AbortError";
    c.abort(e);
  }, ms);
  return c.signal;
}

export async function apiRequest(path, options = {}) {
  const { timeoutMs, signal: outerSignal, ...fetchRest } = options;
  const token = localStorage.getItem("token");
  const headers = {
    "Content-Type": "application/json",
    ...(fetchRest.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let signal = outerSignal;
  if (timeoutMs != null && timeoutMs > 0 && !outerSignal) {
    signal = timeoutSignal(timeoutMs);
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...fetchRest,
      headers,
      signal,
    });
  } catch (err) {
    const name = err && err.name;
    const msg = err && err.message;
    if (
      timeoutMs &&
      timeoutMs > 0 &&
      (name === "AbortError" || msg === "Timeout" || /abort/i.test(String(msg)))
    ) {
      throw new Error(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s. The API may be waking up (free hosting) — wait and try again, or open ${API_BASE_URL}/ in a new tab once to warm the server.`
      );
    }
    throw err;
  }

  let data = null;
  try {
    data = await response.json();
  } catch (_error) {
    data = null;
  }

  if (!response.ok) {
    const message =
      (data && data.message) ||
      (typeof data === "string" ? data : null) ||
      `Request failed (HTTP ${response.status})`;
    throw new Error(message);
  }

  return data;
}

/** Unauthenticated GET for public share pages (JWT in URL path). */
export async function publicApiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`);
  let data = null;
  try {
    data = await response.json();
  } catch (_e) {
    data = null;
  }
  if (!response.ok) {
    const message =
      (data && data.message) ||
      (typeof data === "string" ? data : null) ||
      `Request failed (HTTP ${response.status})`;
    throw new Error(message);
  }
  return data;
}
