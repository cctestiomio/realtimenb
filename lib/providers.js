export async function fetchJSON(url, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(id);

  if (!res.ok) throw new Error("Network error");

  return await res.json();
}
