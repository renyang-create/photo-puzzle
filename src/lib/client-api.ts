"use client";

export class ApiClientError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "unknown") {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  url: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(url, {
    ...rest,
    method: rest.method ?? (json ? "POST" : "GET"),
    credentials: "same-origin",
    headers: {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    body: json ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | (T & { ok?: boolean; error?: string; code?: string })
    | null;

  if (!response.ok) {
    throw new ApiClientError(
      payload?.error ?? `请求失败（${response.status}）`,
      response.status,
      payload?.code ?? "unknown",
    );
  }

  return payload as T;
}

export function apiGet<T>(url: string) {
  return request<T>(url);
}

export function apiPost<T>(url: string, json?: unknown) {
  return request<T>(url, { json: json ?? {} });
}

export function apiPatch<T>(url: string, json?: unknown) {
  return request<T>(url, { method: "PATCH", json: json ?? {} });
}

export function apiDelete<T>(url: string) {
  return request<T>(url, { method: "DELETE" });
}
