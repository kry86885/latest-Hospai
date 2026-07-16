import type { ModuleOption, ModuleId, NavItem, PatientForm, SignupForm, UserTypeOption } from "../types";

export const API_BASE = import.meta.env.VITE_API_BASE || ((typeof window !== "undefined" && window.location.protocol === "file:") ? "http://127.0.0.1:5001" : "");

export const USER_TYPE_OPTIONS: UserTypeOption[] = [
  {
    value: "normal",
    label: "Normal User",
    description: "Access only to assigned modules.",
  },
  {
    value: "admin",
    label: "Admin User",
    description: "Employee management and full module control.",
  },
];

export const USER_TYPE_LABELS = USER_TYPE_OPTIONS.reduce<Record<string, string>>((acc, role) => {
  acc[role.value] = role.label;
  return acc;
}, {});

export const MODULE_OPTIONS: ModuleOption[] = [
  { value: "dashboard", label: "Dashboard", description: "Hospital dashboard and analytics widgets." },
  { value: "patients", label: "Patient Management", description: "Patient registration and treatment workflows." },
  { value: "billing", label: "Billing", description: "Invoices, collections, and payment workflows." },
  { value: "lab", label: "Lab & Diagnostics", description: "Diagnostic vendors and test records." },
  { value: "hrms", label: "HRMS", description: "Attendance, payroll, and leave operations." },
  { value: "ot", label: "OT", description: "Operation theatre scheduling and utilisation." },
  { value: "accounts", label: "Accounts", description: "Ledger, vendor payments, and doctor payouts." },
  { value: "reports", label: "Reports", description: "Cross-module operational and financial reporting." },
];

export const DEFAULT_MODULE_ACCESS: ModuleId[] = ["dashboard", "patients"];
export const ALL_ASSIGNABLE_MODULES: ModuleId[] = MODULE_OPTIONS.map((module) => module.value);

export const ADMIN_PERMISSIONS: string[] = [
    "patients.read",
    "patients.write",
    "patients.delete",
    "employees.read",
    "employees.write",
    "billing.read",
    "billing.write",
    "lab.read",
    "lab.write",
    "hr.read",
    "hr.write",
    "ot.read",
    "ot.write",
    "accounts.read",
    "accounts.write",
    "reports.read",
    "audit.read",
    "admin.use",
];

export const MODULE_PERMISSIONS: Record<ModuleId, string[]> = {
  dashboard: ["patients.read"],
  patients: ["patients.read", "patients.write"],
  billing: ["billing.read", "billing.write"],
  lab: ["lab.read", "lab.write"],
  hrms: ["hr.read", "hr.write"],
  ot: ["ot.read", "ot.write"],
  accounts: ["accounts.read", "accounts.write"],
  reports: ["reports.read"],
};

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Overview Dashboard", group: "overview", permission: "patients.read", deniedHint: "Requires patient access." },
  { id: "patients", label: "Patients", group: "op-management", permission: "patients.read", deniedHint: "Requires patient access." },
  { id: "add", label: "Patient Registration", group: "op-management", permission: "patients.write", deniedHint: "Requires patient write access." },
  { id: "op-queue-management", label: "Queue Management", group: "op-management", permission: "patients.read", deniedHint: "Requires patient access." },
  { id: "patient-journey", label: "Patient Journey", group: "op-management", permission: "patients.read", deniedHint: "Requires patient access." },
  { id: "op-desk", label: "Doctor Scheduling", group: "op-management", permission: "patients.read", deniedHint: "Requires patient access." },
  { id: "readmit", label: "Follow-up / Re-visit", group: "op-management", permission: "patients.write", deniedHint: "Requires patient write access." },
  { id: "doctors-history", label: "Doctors History", group: "op-management", permission: "patients.read", deniedHint: "Requires patient access." },
  { id: "lab", label: "Lab & Diagnostic Billing", group: "billing", permission: "lab.read", deniedHint: "Requires lab access." },
  { id: "billing-module-collections", label: "Revenue Reports", group: "billing", permission: "billing.read", deniedHint: "Requires billing access." },
  { id: "accounts-doctor-payouts", label: "Doctor Payout", group: "billing", permission: "accounts.read", deniedHint: "Requires accounts access." },
  { id: "reports", label: "Daily / Monthly Reports", group: "billing", permission: "reports.read", deniedHint: "Requires reports access." },
  { id: "settings", label: "Settings" },
];

export const DOC_TYPES = [
  { value: "test_docs", label: "Test Documents" },
  { value: "xray_mri", label: "X-Ray / MRI" },
  { value: "prescriptions", label: "Prescription" },
];

export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "tif",
  "tiff",
  "bmp",
  "gif",
  "heic",
  "heif",
];

const SUPPORTED_DOCUMENT_EXTENSION_SET = new Set(SUPPORTED_DOCUMENT_EXTENSIONS);

export const SUPPORTED_DOCUMENT_ACCEPT = SUPPORTED_DOCUMENT_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export const isSupportedDocumentFile = (file: File) => {
  const parts = file.name.toLowerCase().split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";
  return SUPPORTED_DOCUMENT_EXTENSION_SET.has(ext);
};

export const EMPTY_PATIENT_FORM: PatientForm = {
  name: "",
  middle_name: "",
  last_name: "",
  dob: "",
  age: "",
  weight: "",
  height: "",
  gender: "",
  pregnant: false,
  marital_status: "",
  nationality: "",
  allergy1: "",
  allergy2: "",
  allergy3: "",
  symptoms: "",
  phone: "",
  address: "",
  emergency_contact: "",
  emergency_relation: "",
  family_mobile: "",
  email: "",
  emergency_mobile: "",
};

export const EMPTY_SIGNUP_FORM: SignupForm = {
  username: "",
  password: "",
  full_name: "",
  email: "",
  phone: "",
  user_type: "normal",
  module_access: [...DEFAULT_MODULE_ACCESS],
  job_role: "",
  department: "",
  address: "",
  emergency_contact: "",
};

export const EMPTY_STATS = { total: 0, today: 0, active_admissions: 0, documents: 0, readmitted_patients: 0 };
