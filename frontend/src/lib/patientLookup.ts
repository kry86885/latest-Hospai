import { apiFetch } from "./api";
import type { Patient } from "../types";

export const fullPatientName = (patient?: Patient | null) =>
  [patient?.name, patient?.middle_name, patient?.last_name].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

export const normalizeUhidLookup = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits && digits.length <= 4) return digits.padStart(4, "0");
  return trimmed;
};

export async function lookupPatientByUhid(value: string): Promise<Patient | null> {
  const lookup = normalizeUhidLookup(value);
  if (!lookup) return null;
  const data = await apiFetch<{ patient?: Patient }>(`/api/patients/${encodeURIComponent(lookup)}`);
  return data.patient || null;
}
