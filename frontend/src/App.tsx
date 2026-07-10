import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { FiSettings } from "react-icons/fi";
import AuthView from "./components/AuthView";
import SettingsModal from "./components/SettingsModal";
import ShareModal from "./components/ShareModal";
import Toast from "./components/ui/Toast";
import ConfirmDialog from "./components/ui/ConfirmDialog";
import BrandLogo from "./components/BrandLogo";
import { Button, Container } from "./components/ui";
import AddPatientPage from "./pages/AddPatientPage";
import AdminPage from "./pages/AdminPage";
import OpPage from "./pages/OpPage";
import OpQueuePage from "./pages/OpQueuePage";
import DashboardPage from "./pages/DashboardPage";
import EmployeesPage from "./pages/EmployeesPage";
import BillingAgingPage from "./pages/BillingAgingPage";
import BillingReconciliationPage from "./pages/BillingReconciliationPage";
import BillingCreateInvoicePage from "./pages/BillingCreateInvoicePage";
import BillingRecordPaymentPage from "./pages/BillingRecordPaymentPage";
import BillingClaimsPage from "./pages/BillingClaimsPage";
import BillingInvoicesPage from "./pages/BillingInvoicesPage";
import BillingPaymentModesPage from "./pages/BillingPaymentModesPage";
import BillingCollectionsPage from "./pages/BillingCollectionsPage";
import LabPage from "./pages/LabPage";
import HrmsPage from "./pages/HrmsPage";
import OtPage from "./pages/OtPage";
import AccountsOverviewPage from "./pages/AccountsOverviewPage";
import AccountsLedgerPage from "./pages/AccountsLedgerPage";
import AccountsVendorPaymentsPage from "./pages/AccountsVendorPaymentsPage";
import AccountsDoctorPayoutsPage from "./pages/AccountsDoctorPayoutsPage";
import PatientsPage from "./pages/PatientsPage";
import ReadmitPage from "./pages/ReadmitPage";
import ReportsPage from "./pages/ReportsPage";
import SettingsPage from "./pages/SettingsPage";
import PlatformAdminPage from "./pages/PlatformAdminPage";
import RegistrationDeskPage from "./pages/RegistrationDeskPage";
import PatientWorkflowPage from "./pages/PatientWorkflowPage";
import PatientJourneyPage from "./pages/PatientJourneyPage";
import { API_BASE, EMPTY_PATIENT_FORM, EMPTY_STATS, NAV_ITEMS } from "./lib/constants";
import { apiFetch, clearAuthToken, getAuthHeaders, getHospitalCode, reportError, setAuthToken, setHospitalCode } from "./lib/api";
import { resolvePermissions } from "./lib/format";
import type { DashboardAnalytics, HospitalSummary, Notice, Patient, Stats, User } from "./types";

type SidebarIconName = "dashboard" | "add" | "patients" | "readmit" | "billing" | "lab" | "hrms" | "ot" | "employees" | "settings" | "logout" | "profile" | "appointment";

const NAV_ICON_MAP: Record<string, SidebarIconName> = {
  dashboard: "dashboard",
  add: "add",
  "op-desk": "patients",
  "consent-desk": "add",
  "insurance-desk": "billing",
  "op-queue-management": "patients",
  patients: "patients",
  "patient-journey": "patients",
  readmit: "readmit",
  billing: "billing",
  "billing-aging": "billing",
  "billing-reconciliation": "billing",
  "billing-create-invoice": "billing",
  "billing-record-payment": "billing",
  "billing-insurance-claims": "billing",
  "billing-invoices": "billing",
  "billing-mode-breakdown": "billing",
  "billing-module-collections": "billing",
  lab: "lab",
  hrms: "hrms",
  ot: "ot",
  accounts: "billing",
  "accounts-overview": "billing",
  "accounts-ledger": "billing",
  "accounts-vendor-payments": "billing",
  "accounts-doctor-payouts": "billing",
  reports: "dashboard",
  employees: "employees",
  settings: "settings",
};

function SidebarIcon({ name }: { name: SidebarIconName }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  const paths: Record<SidebarIconName, ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.2" {...stroke} />
        <rect x="14" y="3" width="7" height="11" rx="1.2" {...stroke} />
        <rect x="3" y="14" width="7" height="7" rx="1.2" {...stroke} />
        <rect x="14" y="18" width="7" height="3" rx="1.2" {...stroke} />
      </>
    ),
    add: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="3" {...stroke} />
        <path d="M12 8v8" {...stroke} />
        <path d="M8 12h8" {...stroke} />
      </>
    ),
    appointment: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2.6" {...stroke} />
        <path d="M8 3v4M16 3v4M4 10h16M9 14h6M9 17h4" {...stroke} />
      </>
    ),
    patients: (
      <>
        <circle cx="9" cy="9" r="3" {...stroke} />
        <path d="M3.5 19c.8-2.7 2.9-4 5.5-4s4.7 1.3 5.5 4" {...stroke} />
        <circle cx="17.5" cy="10" r="2.5" {...stroke} />
        <path d="M14.8 18.8c.5-1.7 1.8-2.8 3.7-3.2" {...stroke} />
      </>
    ),
    readmit: (
      <>
        <path d="M20 12a8 8 0 1 1-2.3-5.7" {...stroke} />
        <path d="M20 4v6h-6" {...stroke} />
      </>
    ),
    billing: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" {...stroke} />
        <path d="M7 9h10M7 13h6M7 17h4" {...stroke} />
      </>
    ),
    lab: (
      <>
        <path d="M10 3v5l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3.5L14 8V3" {...stroke} />
        <path d="M8.5 13h7" {...stroke} />
      </>
    ),
    hrms: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" {...stroke} />
        <path d="M8 8h8M8 12h8M8 16h5" {...stroke} />
      </>
    ),
    ot: (
      <>
        <rect x="4" y="5" width="16" height="14" rx="2.5" {...stroke} />
        <path d="M9 5V3M15 5V3M8 12h8M12 8v8" {...stroke} />
      </>
    ),
    employees: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" {...stroke} />
        <path d="M3 9.5h18" {...stroke} />
        <path d="M8 7v-2M16 7v-2" {...stroke} />
        <path d="M8.5 14.5h7M8.5 17.5h5" {...stroke} />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3.2" {...stroke} />
        <path d="M12 3v2.1M12 18.9V21M3 12h2.1M18.9 12H21M5.7 5.7l1.5 1.5M16.8 16.8l1.5 1.5M18.3 5.7l-1.5 1.5M7.2 16.8l-1.5 1.5" {...stroke} />
      </>
    ),
    logout: (
      <>
        <path d="M10 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H10" {...stroke} />
        <path d="M14 8l4 4-4 4" {...stroke} />
        <path d="M18 12H9" {...stroke} />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8.2" r="3.1" {...stroke} />
        <path d="M5.5 19c.9-3 3.2-4.7 6.5-4.7s5.6 1.7 6.5 4.7" {...stroke} />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

type SidebarTabProps = {
  label: string;
  icon: SidebarIconName;
  active: boolean;
  disabled?: boolean;
  hint?: string;
  onClick: () => void;
};

function SidebarTab({ label, icon, active, disabled = false, hint, onClick }: SidebarTabProps) {
  return (
    <button
      type="button"
      className={active ? "sidebar-tab active" : "sidebar-tab"}
      disabled={disabled}
      title={hint || ""}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <span className="sidebar-tab-icon">
        <SidebarIcon name={icon} />
      </span>
      <span>{label}</span>
    </button>
  );
}

function App() {
  const isAdminRoutePath = typeof window !== "undefined" && window.location.pathname === "/admin";
  const isPlatformAdminRoute = typeof window !== "undefined" && window.location.pathname === "/platform-admin";
  const [user, setUser] = useState<User | null>(null);
  const getPageFromUrl = () => {
    if (typeof window === "undefined") return "dashboard";
    const params = new URLSearchParams(window.location.search);
    return params.get("page") || "dashboard";
  };
  const [page, setPage] = useState(isAdminRoutePath ? "admin" : getPageFromUrl());
  const [patientsPageKey, setPatientsPageKey] = useState(0);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [dashboardAnalytics, setDashboardAnalytics] = useState<DashboardAnalytics | null>(null);
  const [hospitalSummary, setHospitalSummary] = useState<HospitalSummary | null>(null);
  const [dashboardAnalyticsLoading, setDashboardAnalyticsLoading] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientDetailRefreshToken, setPatientDetailRefreshToken] = useState(0);
  const [languages, setLanguages] = useState<Record<string, string>>({ en: "English" });
  const [ocrLanguage, setOcrLanguage] = useState("en");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  // Share Modal States
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareOptions, setShareOptions] = useState<{
    blob: Blob;
    filename: string;
    title: string;
    text?: string;
    shareUrl: string;
  } | null>(null);

  useEffect(() => {
    window.__hospai_share__ = (options) => {
      setShareOptions(options);
      setShareModalOpen(true);
    };
    return () => {
      window.__hospai_share__ = undefined;
    };
  }, []);
  const [authChecked, setAuthChecked] = useState(false);
  const [hospitalCode, setHospitalCodeState] = useState(getHospitalCode());
  const [collapsedSidebarGroups, setCollapsedSidebarGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const permissions = useMemo(() => resolvePermissions(user), [user]);
  const hasPermission = (permission?: string) => !permission || (!!user && permissions.includes(permission));
  const isAdmin = hasPermission("admin.use");
  const canAccessNavItem = (itemId: string, permission?: string) => {
    if (itemId === "employees") return isAdmin;
    return hasPermission(permission);
  };
  const sidebarNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => item.id !== "settings" && canAccessNavItem(item.id, item.permission)),
    [permissions]
  );
  const sidebarGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; items: typeof sidebarNavItems }> = [
      { key: "overview", label: "Overview Module", items: [] },
      { key: "op-management", label: "OP Management Module", items: [] },
      { key: "billing", label: "Billing Module", items: [] },
      { key: "admin", label: "Administration", items: [] },
    ];
    sidebarNavItems.forEach((item) => {
      const target = groups.find((group) => group.key === (item.group || "overview"));
      target?.items.push(item);
    });
    return groups.filter((group) => group.items.length > 0);
  }, [sidebarNavItems]);
  useEffect(() => {
    setCollapsedSidebarGroups((current) => {
      const next = { ...current };
      sidebarGroups.forEach((group) => {
        if (!(group.key in next)) next[group.key] = false;
      });
      return next;
    });
  }, [sidebarGroups]);

  const getDefaultPage = (currentUser: User | null) => {
    const currentPermissions = resolvePermissions(currentUser);
    const candidatePages = [
      "dashboard",
      "patients",
      "add",
      "op-queue-management",
      "op-desk",
      "readmit",
      "billing-record-payment",
      "billing-module-collections",
      "accounts-doctor-payouts",
      "reports",
      "settings",
    ];
    for (const candidate of candidatePages) {
      const navItem = NAV_ITEMS.find((item) => item.id === candidate);
      if (!navItem) continue;
      if (!navItem.permission || currentPermissions.includes(navItem.permission)) {
        return candidate;
      }
    }
    return "settings";
  };

  const syncUrlForPage = (nextPage: string) => {
    if (typeof window === "undefined") return;
    if (nextPage === "admin") {
      if (window.location.pathname !== "/admin") window.history.pushState({}, "", "/admin");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (nextPage === "dashboard") params.delete("page");
    else params.set("page", nextPage);
    const target = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` !== target) window.history.pushState({}, "", target);
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/languages`)
      .then((res) => res.json())
      .then((data) => setLanguages(data.languages || { en: "English" }))
      .catch(() => setLanguages({ en: "English" }));
  }, []);

  useEffect(() => {
    const handlePopState = () => setPage(getPageFromUrl());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch<{ user?: User }>("/api/auth/session")
      .then((data) => {
        if (!active) return;
        if (data.user) {
          setUser(data.user);
          if (!isAdminRoutePath) {
            setPage(getPageFromUrl());
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setAuthChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      clearAuthToken();
      setUser(null);
      setPage("dashboard");
      setSelectedPatient(null);
      setNotice(null);
    };
    window.addEventListener("app:unauthorized", handleUnauthorized);
    return () => {
      window.removeEventListener("app:unauthorized", handleUnauthorized);
    };
  }, []);

  const loadStats = async () => {
    try {
      const data = await apiFetch<Stats>("/api/stats");
      setStats({ ...EMPTY_STATS, ...data });
      return true;
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load dashboard stats.");
      return false;
    }
  };

  const loadPatients = async () => {
    try {
      const data = await apiFetch<{ patients?: Patient[] }>("/api/patients");
      setPatients(data.patients || []);
      return true;
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load patient list.");
      return false;
    }
  };

  const loadDashboardAnalytics = async () => {
    setDashboardAnalyticsLoading(true);
    try {
      const data = await apiFetch<DashboardAnalytics>("/api/dashboard/analytics?days=14");
      setDashboardAnalytics(data);
      return true;
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load dashboard analytics.");
      setDashboardAnalytics(null);
      return false;
    } finally {
      setDashboardAnalyticsLoading(false);
    }
  };

  const loadHospitalSummary = async () => {
    try {
      const data = await apiFetch<HospitalSummary>("/api/dashboard/hospital-summary");
      setHospitalSummary(data);
      return true;
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load operational hospital summary.");
      setHospitalSummary(null);
      return false;
    }
  };

  useEffect(() => {
    if (!user) return;
    if (hasPermission("patients.read")) {
      void loadStats();
      void loadPatients();
      void loadDashboardAnalytics();
      void loadHospitalSummary();
    } else {
      setStats(EMPTY_STATS);
      setDashboardAnalytics(null);
      setHospitalSummary(null);
      setPatients([]);
      setSelectedPatient(null);
    }
  }, [user, permissions]);

  useEffect(() => {
    if (!user) return;
    const activeNav = NAV_ITEMS.find((item) => item.id === page);
    if (activeNav && !canAccessNavItem(activeNav.id, activeNav.permission)) {
      setPage(getDefaultPage(user));
      setNotice({ type: "warning", message: activeNav.deniedHint || "You do not have access to this module." });
      return;
    }
    if (!isAdminRoutePath && page === "admin" && !hasPermission("employees.write")) {
      setPage(getDefaultPage(user));
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", "/");
      }
      setNotice({ type: "warning", message: "Only admins can access the /admin page." });
      return;
    }
    if (page === "patients" && hasPermission("patients.read")) {
      setSelectedPatient(null);
      void loadPatients();
    }
    if (page === "dashboard" && hasPermission("patients.read")) {
      void loadStats();
      void loadPatients();
      void loadDashboardAnalytics();
      void loadHospitalSummary();
    }
  }, [page, user, permissions]);

  const recentPatients = useMemo(() => patients.slice(0, 5), [patients]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const inputHospitalCode = ((form.elements.namedItem("hospital_code") as HTMLInputElement).value || "hosp-default")
      .trim()
      .toLowerCase();
    const payload = {
      username: (form.elements.namedItem("username") as HTMLInputElement).value,
      password: (form.elements.namedItem("password") as HTMLInputElement).value,
    };
    try {
      setHospitalCode(inputHospitalCode);
      setHospitalCodeState(inputHospitalCode);
      const data = await apiFetch<{ user: User; session_token?: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "X-Hospital-Code": inputHospitalCode },
      });
      if (data.session_token) setAuthToken(data.session_token);
      setAuthChecked(true);
      setUser(data.user);
      setPage("dashboard");
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", window.location.pathname);
      }
      setNotice({ type: "success", message: "Login successful. Opening dashboard..." });
      if (resolvePermissions(data.user).includes("patients.read")) {
        void loadStats();
        void loadPatients();
        void loadDashboardAnalytics();
        void loadHospitalSummary();
      }
    } catch (error) {
      const err = error as { message?: string; status?: number };
      setNotice({ type: "error", message: err.message || "Login failed. Please check credentials." });
      console.error("HospAI login failed", err);
    }
  };

  const readPlatformAdminCreds = (form: HTMLFormElement) => ({
    username: ((form.elements.namedItem("platform_admin_username") as HTMLInputElement)?.value || "").trim(),
    password: (form.elements.namedItem("platform_admin_password") as HTMLInputElement)?.value || "",
  });

  const platformHeaders = (platformAdminUsername: string, platformAdminPassword: string, hospitalCodeValue: string) => ({
    "Content-Type": "application/json",
    "X-Hospital-Code": hospitalCodeValue.trim().toLowerCase(),
    "X-Platform-Admin-Username": platformAdminUsername,
    "X-Platform-Admin-Password": platformAdminPassword,
  });

  const handleCreateHospital = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const creds = readPlatformAdminCreds(form);
    const hospitalCodeValue = ((form.elements.namedItem("hospital_code") as HTMLInputElement)?.value || "").trim().toLowerCase();
    const hospitalNameValue = ((form.elements.namedItem("hospital_name") as HTMLInputElement)?.value || "").trim();

    try {
      const response = await fetch(`${API_BASE}/api/platform/hospitals`, {
        method: "POST",
        headers: platformHeaders(creds.username, creds.password, hospitalCodeValue),
        body: JSON.stringify({ hospital_code: hospitalCodeValue, name: hospitalNameValue || undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.message || "Unable to create hospital.");
      setNotice({ type: "success", message: `Hospital ${hospitalCodeValue} is ready.` });
      setHospitalCode(hospitalCodeValue);
      setHospitalCodeState(hospitalCodeValue);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to create hospital.");
    }
  };

  const handleSetupHospitalAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const creds = readPlatformAdminCreds(form);
    const hospitalCodeValue = ((form.elements.namedItem("hospital_code") as HTMLInputElement)?.value || "").trim().toLowerCase();
    const adminUsername = ((form.elements.namedItem("admin_username") as HTMLInputElement)?.value || "").trim();
    const adminPassword = (form.elements.namedItem("admin_password") as HTMLInputElement)?.value || "";
    const adminFullName = ((form.elements.namedItem("admin_full_name") as HTMLInputElement)?.value || "").trim();
    const adminEmail = ((form.elements.namedItem("admin_email") as HTMLInputElement)?.value || "").trim();
    const adminPhone = ((form.elements.namedItem("admin_phone") as HTMLInputElement)?.value || "").trim();

    try {
      const response = await fetch(`${API_BASE}/api/auth/setup-admin`, {
        method: "POST",
        headers: platformHeaders(creds.username, creds.password, hospitalCodeValue),
        body: JSON.stringify({
          username: adminUsername,
          password: adminPassword,
          full_name: adminFullName,
          email: adminEmail,
          phone: adminPhone,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.message || "Unable to onboard hospital admin.");
      setNotice({ type: "success", message: `Admin created for ${hospitalCodeValue}.` });
      setHospitalCode(hospitalCodeValue);
      setHospitalCodeState(hospitalCodeValue);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to onboard hospital admin.");
    }
  };

  const handleResetHospitalAdminPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const creds = readPlatformAdminCreds(form);
    const hospitalCodeValue = ((form.elements.namedItem("hospital_code") as HTMLInputElement)?.value || "").trim().toLowerCase();
    const adminUsername = ((form.elements.namedItem("admin_username") as HTMLInputElement)?.value || "").trim();
    const newPassword = (form.elements.namedItem("new_password") as HTMLInputElement)?.value || "";

    try {
      const response = await fetch(`${API_BASE}/api/platform/hospitals/${encodeURIComponent(hospitalCodeValue)}/admin/reset-password`, {
        method: "POST",
        headers: platformHeaders(creds.username, creds.password, hospitalCodeValue),
        body: JSON.stringify({ username: adminUsername, new_password: newPassword }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.message || "Unable to reset admin password.");
      setNotice({ type: "success", message: `Admin password reset for ${hospitalCodeValue}.` });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to reset admin password.");
    }
  };

  const handleToggleHospitalAccess = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const creds = readPlatformAdminCreds(form);
    const hospitalCodeValue = ((form.elements.namedItem("hospital_code") as HTMLInputElement)?.value || "").trim().toLowerCase();
    const action = ((form.elements.namedItem("action") as HTMLInputElement)?.value || "").trim().toLowerCase();
    const reason = ((form.elements.namedItem("reason") as HTMLInputElement)?.value || "").trim();
    const endpoint = action === "enable" ? "enable" : "disable";

    try {
      const response = await fetch(`${API_BASE}/api/platform/hospitals/${encodeURIComponent(hospitalCodeValue)}/${endpoint}`, {
        method: "POST",
        headers: platformHeaders(creds.username, creds.password, hospitalCodeValue),
        body: JSON.stringify(endpoint === "disable" ? { reason } : {}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.message || "Unable to update hospital status.");
      setNotice({ type: "success", message: `Hospital ${hospitalCodeValue} is now ${endpoint === "disable" ? "disabled" : "enabled"}.` });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to update hospital status.");
    }
  };

  const handleLogout = () => {
    void apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    if (typeof window !== "undefined" && window.location.protocol !== "file:" && window.location.pathname === "/admin") {
      window.history.replaceState({}, "", "/");
    }
    clearAuthToken();
    setUser(null);
    setPage("dashboard");
    setSelectedPatient(null);
  };

  const navigateToPage = (nextPage: string) => {
    if (nextPage === "patients") {
      setPatientsPageKey((prev) => prev + 1);
    }
    syncUrlForPage(nextPage);
    setPage(nextPage);
  };

  const refreshPatients = async () => {
    const data = await apiFetch<{ patients?: Patient[] }>("/api/patients");
    setPatients(data.patients || []);
  };

  const handleCreatePatient = async (
    payload: Record<string, unknown>,
    setForm: Dispatch<SetStateAction<any>>,
    setDuplicateInfo?: Dispatch<SetStateAction<any>>,
    refreshPatientId?: () => Promise<void>
  ): Promise<{ patient_id: string; admission_id?: string } | null> => {
    try {
      const data = await apiFetch<{ patient_id: string; admission_id?: string }>("/api/patients", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await refreshPatients();
      await loadStats();
      await loadHospitalSummary();
      setSelectedPatient({
        patient_id: data.patient_id,
        admission_id: data.admission_id,
        name: String(payload.name || ""),
        last_name: String(payload.last_name || ""),
        middle_name: String(payload.middle_name || ""),
      });
      setDuplicateInfo?.(null);
      setNotice({ type: "success", message: `Patient ${data.patient_id} registered.` });
      setForm({ ...EMPTY_PATIENT_FORM });
      await refreshPatientId?.();
      return data;
    } catch (error) {
      const typedError = error as { status?: number; payload?: any; message?: string };
      if (typedError.status === 409) {
        setDuplicateInfo?.(typedError.payload?.duplicate || null);
        setNotice({ type: "warning", message: typedError.message || "Possible duplicate" });
        return null;
      }
      reportError(setNotice, typedError);
      return null;
    }
  };

  const handleDeletePatient = async (patientId: string) => {
    try {
      await apiFetch(`/api/patients/${patientId}`, { method: "DELETE" });
      await refreshPatients();
      await loadStats();
      await loadHospitalSummary();
      if (selectedPatient?.patient_id === patientId) {
        setSelectedPatient(null);
      }
      setNotice({ type: "success", message: "Patient removed." });
    } catch (error) {
      const err = error as { message?: string; status?: number };
      setNotice({ type: "error", message: err.message || "Login failed. Please check credentials." });
      console.error("HospAI login failed", err);
    }
  };

  const handleExportPatientsCsv = async (query = "") => {
    try {
      const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      const response = await fetch(`${API_BASE}/api/export/patients/csv${params}`, {
        method: "GET",
        credentials: "include",
        headers: { "X-Hospital-Code": getHospitalCode(), ...getAuthHeaders() },
      });
      if (!response.ok) {
        throw new Error("Unable to export patients CSV.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `patients_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
      setNotice({ type: "success", message: "Patients CSV exported." });
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to export patients CSV.");
    }
  };

  const handleSelectPatient = (patient: Patient | null) => {
    if (!patient) {
      setSelectedPatient(null);
      return;
    }
    setSelectedPatient({
      patient_id: patient.patient_id,
      name: patient.name,
      middle_name: patient.middle_name,
      last_name: patient.last_name,
    });
  };

  const refreshPatientData = async (patientId?: string) => {
    await Promise.allSettled([loadStats(), loadPatients(), loadHospitalSummary()]);
    if (patientId) {
      setSelectedPatient((prev) => (prev?.patient_id === patientId ? { ...prev } : prev));
    }
    setPatientDetailRefreshToken((prev) => prev + 1);
  };

  if (isAdminRoutePath) {
    return (
      <div className="app-shell app-shell-single">
        <main className="admin-route-main">
          <Container size="full" className="admin-route-container">
            <header className="topbar admin-route-topbar">
              <div>
                <h2>Admin</h2>
                <p className="muted">Separate admin route authentication.</p>
              </div>
            </header>
            <AdminPage setNotice={setNotice} />
          </Container>
        </main>
        {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
      </div>
    );
  }

  if (!authChecked) {
    if (isPlatformAdminRoute) {
      return (
        <>
          <PlatformAdminPage
            initialHospitalCode={hospitalCode}
            onCreateHospital={handleCreateHospital}
            onSetupHospitalAdmin={handleSetupHospitalAdmin}
            onResetHospitalAdminPassword={handleResetHospitalAdminPassword}
            onToggleHospitalAccess={handleToggleHospitalAccess}
          />
          {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
        </>
      );
    }
    return <div className="auth-page">Checking session...</div>;
  }

  if (isPlatformAdminRoute) {
    return (
      <>
        <PlatformAdminPage
          initialHospitalCode={hospitalCode}
          onCreateHospital={handleCreateHospital}
          onSetupHospitalAdmin={handleSetupHospitalAdmin}
          onResetHospitalAdminPassword={handleResetHospitalAdminPassword}
          onToggleHospitalAccess={handleToggleHospitalAccess}
        />
        {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
      </>
    );
  }

  if (!user) {
    return (
      <>
        <AuthView onLogin={handleLogin} initialHospitalCode={hospitalCode} />
        {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
      </>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand">
            <BrandLogo />
            <div>
              <p className="brand-title">
                Hosp<span className="brand-title-ai">AI</span>
              </p>
            </div>
          </div>
        </div>
        <div className="sidebar-scroll-region">
          <nav>
            {sidebarGroups.map((group) => (
              <section key={group.key} className="sidebar-nav-group">
                <button
                  type="button"
                  className="sidebar-nav-toggle"
                  onClick={() => setCollapsedSidebarGroups((current) => ({ ...current, [group.key]: !current[group.key] }))}
                  aria-expanded={!collapsedSidebarGroups[group.key]}
                >
                  <span className="sidebar-nav-heading">
                    <span className="sidebar-nav-title">{group.label}</span>
                    <span className="sidebar-nav-count">{group.items.length}</span>
                  </span>
                  <span className={collapsedSidebarGroups[group.key] ? "sidebar-nav-chevron collapsed" : "sidebar-nav-chevron"} aria-hidden="true">
                    <span className="sidebar-nav-chevron-chip">▾</span>
                  </span>
                </button>
                {!collapsedSidebarGroups[group.key] && (
                  <div className="sidebar-nav-items">
                    {group.items.map((item) => {
                      const blocked = !!item.permission && !hasPermission(item.permission);
                      const isActive = page === item.id;
                      return (
                        <SidebarTab
                          key={item.id}
                          label={item.label}
                          icon={NAV_ICON_MAP[item.id] || "dashboard"}
                          active={isActive}
                          disabled={blocked}
                          hint={blocked ? item.deniedHint : ""}
                          onClick={() => {
                            if (blocked) {
                              setNotice({ type: "warning", message: item.deniedHint || "Access denied." });
                              return;
                            }
                            navigateToPage(item.id);
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            ))}
          </nav>
        </div>
      </aside>
      <main>
        <Container size="full">
        {page !== "dashboard" && (
          <header className="topbar">
            <div>
              <h2>{page === "admin" ? "Admin" : NAV_ITEMS.find((item) => item.id === page)?.label || "Dashboard"}</h2>
              <p className="muted">Stay ahead with real-time care intelligence.</p>
            </div>
          </header>
        )}

        {page === "dashboard" && (
          <DashboardPage
            stats={stats}
            recentPatients={recentPatients}
            patients={patients}
            analytics={dashboardAnalytics}
            hospitalSummary={hospitalSummary}
            analyticsLoading={dashboardAnalyticsLoading}
            onNavigate={navigateToPage}
            user={user}
            onLogout={() => setLogoutConfirmOpen(true)}
            onRefreshDashboard={() => {
              void loadStats();
              void loadPatients();
              void loadDashboardAnalytics();
              void loadHospitalSummary();
            }}
          />
        )}



        {page === "add" && (
          <AddPatientPage
            ocrLanguage={ocrLanguage}
            onCreate={handleCreatePatient}
            selectedPatient={selectedPatient}
            setNotice={setNotice}
            onDocumentSaved={refreshPatientData}
          />
        )}

        {page === "consent-desk" && hasPermission("patients.write") && (
          <RegistrationDeskPage mode="consent" selectedPatient={selectedPatient} setNotice={setNotice} />
        )}

        {page === "insurance-desk" && hasPermission("patients.write") && (
          <RegistrationDeskPage mode="insurance" selectedPatient={selectedPatient} setNotice={setNotice} />
        )}

        {page === "op-queue-management" && hasPermission("patients.read") && (
          <OpQueuePage
            setNotice={setNotice}
            onOpenPatient={(patientId) => {
              const patient = patients.find((item) => item.patient_id === patientId) || null;
              handleSelectPatient(patient);
              navigateToPage("patients");
            }}
          />
        )}
        {page === "op-desk" && hasPermission("patients.read") && <OpPage setNotice={setNotice} canEdit={hasPermission("patients.write")} />}
        {page === "doctor-prescription" && hasPermission("patients.write") && <PatientWorkflowPage setNotice={setNotice} view="prescription" />}
        {page === "ip-admission" && hasPermission("patients.write") && <PatientWorkflowPage setNotice={setNotice} view="ip-admission" />}
        {page === "nurse-station" && hasPermission("patients.write") && <PatientWorkflowPage setNotice={setNotice} view="nurse-station" />}
        {page === "discharge-summary" && hasPermission("patients.write") && <PatientWorkflowPage setNotice={setNotice} view="discharge-summary" />}

        {page === "patient-journey" && hasPermission("patients.read") && <PatientJourneyPage setNotice={setNotice} />}

        {page === "patients" && (
          <PatientsPage
            key={patientsPageKey}
            patients={patients}
            onSelect={handleSelectPatient}
            onDelete={handleDeletePatient}
            onPatientUpdated={refreshPatientData}
            onExportCsv={handleExportPatientsCsv}
            selectedPatient={selectedPatient}
            setNotice={setNotice}
            canEdit={hasPermission("patients.write")}
            canDelete={hasPermission("patients.delete")}
            canReadBilling={hasPermission("billing.read")}
            canReadLab={hasPermission("lab.read")}
            ocrLanguage={ocrLanguage}
            languages={languages}
            refreshToken={patientDetailRefreshToken}
          />
        )}

        {page === "readmit" && (
          <ReadmitPage onSelect={handleSelectPatient} setNotice={setNotice} onReadmitComplete={refreshPatientData} ocrLanguage={ocrLanguage} />
        )}

        {page === "billing-aging" && hasPermission("billing.read") && <BillingAgingPage setNotice={setNotice} />}
        {page === "billing-reconciliation" && hasPermission("billing.read") && <BillingReconciliationPage setNotice={setNotice} />}
        {page === "billing-create-invoice" && hasPermission("billing.write") && <BillingCreateInvoicePage setNotice={setNotice} />}
        {page === "billing-record-payment" && hasPermission("billing.write") && <BillingRecordPaymentPage setNotice={setNotice} />}
        {page === "billing-insurance-claims" && hasPermission("billing.write") && <BillingClaimsPage setNotice={setNotice} />}
        {page === "billing-invoices" && hasPermission("billing.read") && <BillingInvoicesPage setNotice={setNotice} />}
        {page === "billing-mode-breakdown" && hasPermission("billing.read") && <BillingPaymentModesPage setNotice={setNotice} />}
        {page === "billing-module-collections" && hasPermission("billing.read") && <BillingCollectionsPage setNotice={setNotice} />}

        {page === "lab" && hasPermission("lab.read") && <LabPage setNotice={setNotice} />}

        {page === "hrms" && hasPermission("hr.read") && <HrmsPage setNotice={setNotice} />}

        {page === "ot" && hasPermission("ot.read") && <OtPage setNotice={setNotice} />}

        {page === "accounts" && hasPermission("accounts.read") && <AccountsOverviewPage setNotice={setNotice} />}
        {page === "accounts-overview" && hasPermission("accounts.read") && <AccountsOverviewPage setNotice={setNotice} />}
        {page === "accounts-ledger" && hasPermission("accounts.read") && <AccountsLedgerPage setNotice={setNotice} />}
        {page === "accounts-vendor-payments" && hasPermission("accounts.read") && <AccountsVendorPaymentsPage setNotice={setNotice} />}
        {page === "accounts-doctor-payouts" && hasPermission("accounts.read") && <AccountsDoctorPayoutsPage setNotice={setNotice} />}

        {page === "reports" && hasPermission("reports.read") && <ReportsPage setNotice={setNotice} />}

        {page === "employees" && hasPermission("employees.read") && <EmployeesPage setNotice={setNotice} canWriteEmployees={hasPermission("employees.write")} />}

        {page === "admin" && hasPermission("employees.write") && <AdminPage setNotice={setNotice} />}

        {page === "settings" && <SettingsPage stats={stats} user={user} canReadAudit={hasPermission("audit.read")} />}
        </Container>
      </main>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        languages={languages}
        ocrLanguage={ocrLanguage}
        onOcrLanguageChange={setOcrLanguage}
      />
      <ShareModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        options={shareOptions}
      />
      <ConfirmDialog
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={() => {
          setLogoutConfirmOpen(false);
          handleLogout();
        }}
        title="Log out?"
        description="You will be signed out of this account."
        confirmLabel="Log out"
      />
      {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
    </div>
  );
}

export default App;
