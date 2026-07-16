import { API_BASE } from "./constants";
import type { Dispatch, SetStateAction } from "react";
import type { Notice } from "../types";

const HOSPITAL_CODE_KEY = "hospai_hospital_code";
const AUTH_TOKEN_KEY = "hospai_auth_token";
const DEFAULT_HOSPITAL_CODE = "hosp-default";

export function getHospitalCode(): string {
  if (typeof window === "undefined") return DEFAULT_HOSPITAL_CODE;
  const storage = window.localStorage as { getItem?: (key: string) => string | null } | undefined;
  if (!storage || typeof storage.getItem !== "function") return DEFAULT_HOSPITAL_CODE;
  const stored = (storage.getItem(HOSPITAL_CODE_KEY) || "").trim().toLowerCase();
  return stored || DEFAULT_HOSPITAL_CODE;
}

export function setHospitalCode(hospitalCode: string): void {
  if (typeof window === "undefined") return;
  const normalized = (hospitalCode || "").trim().toLowerCase() || DEFAULT_HOSPITAL_CODE;
  const storage = window.localStorage as { setItem?: (key: string, value: string) => void } | undefined;
  if (!storage || typeof storage.setItem !== "function") return;
  storage.setItem(HOSPITAL_CODE_KEY, normalized);
}

export function getAuthToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage?.getItem(AUTH_TOKEN_KEY) || "";
}

export function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage?.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage?.removeItem(AUTH_TOKEN_KEY);
}

export async function apiFetch<T = any>(path: string, options: RequestInit & { cache?: RequestCache } = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const authHeaders = getAuthHeaders();
  const { headers: optionHeaders, cache: optionCache, ...restOptions } = options;
  const response = await fetch(`${API_BASE}${path}`, {
    ...restOptions,
    headers: { "Content-Type": "application/json", "X-Hospital-Code": getHospitalCode(), ...authHeaders, ...(optionHeaders || {}) },
    credentials: "include",
    cache: optionCache || (method === "GET" ? "no-store" : "default"),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/session") {
      window.dispatchEvent(new Event("app:unauthorized"));
    }
    const message = payload.error || payload.message || "Request failed";
    const error = new Error(message) as Error & { payload?: any; status?: number };
    error.payload = payload;
    error.status = response.status;
    throw error;
  }

  return response.json();
}

export function reportError(
  setNotice?: Dispatch<SetStateAction<Notice | null>>,
  error?: { status?: number; message?: string },
  fallbackMessage = "Request failed."
): void {
  if (error?.status === 401) return;
  setNotice?.({ type: "error", message: error?.message || fallbackMessage });
}
