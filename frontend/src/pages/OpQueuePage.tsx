import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button, Input, Modal, Select } from "../components/ui";
import BrandLogo from "../components/BrandLogo";
import { apiFetch, reportError } from "../lib/api";
import type { Notice, OpSummary, Patient } from "../types";
import { PRINT_BRAND_HEADER_DATA_URI } from "../lib/printBrand";
import { printViaIframe } from "../lib/printViaIframe";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  onOpenPatient?: (patientId: string) => void;
  onNavigate?: (pageId: string) => void;
};

type DepartmentOption = { id?: number; department_name?: string };
type DoctorScheduleOption = { id?: number; doctor_name?: string; department?: string };

type QueuePatient = {
  token: string;
  uhid: string;
  name: string;
  ageGender: string;
  visitType: string;
  arrivedAt: string;
  arrivedAtRaw?: string;
  status: "In Queue" | "In Consultation" | "Completed" | "Yet to Come";
  mobile: string;
  appointmentId?: number;
  department?: string;
  doctor?: string;
  consultationStartedAt?: string | null;
  completedAt?: string | null;
  priority?: "High" | "Follow-up" | "Normal";
};

const normalizeDateOnly = (value?: string | null) => {
  if (!value) return "";
  const rawValue = String(value).trim();
  if (!rawValue) return "";
  const parsed = new Date(rawValue.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return rawValue.slice(0, 10);
  return parsed.toISOString().slice(0, 10);
};

const isActiveDepartment = (department: unknown) => {
  const status = String((department as { status?: string; is_active?: unknown } | null)?.status ?? (department as { is_active?: unknown } | null)?.is_active ?? "active").trim().toLowerCase();
  return !["inactive", "disabled", "false", "0", "deleted"].includes(status);
};

const isActiveDoctorSchedule = (schedule: unknown) => {
  const status = String((schedule as { status?: string } | null)?.status ?? "available").trim().toLowerCase();
  return !["inactive", "disabled", "leave", "full", "unavailable", "false", "0", "cancelled"].includes(status);
};

const mapAppointmentStatus = (status?: string, appointmentDate?: string): QueuePatient["status"] => {
  const normalizedStatus = String(status || "").toLowerCase();
  if (normalizedStatus === "completed") return "Completed";
  if (normalizedStatus === "in_consultation") return "In Consultation";
  if (normalizedStatus === "checked_in") return "In Queue";
  if (normalizedStatus === "scheduled") {
    const selectedDate = normalizeDateOnly(appointmentDate);
    const currentDate = new Date().toISOString().slice(0, 10);
    if (!selectedDate) return "Yet to Come";
    if (selectedDate < currentDate) return "Yet to Come";
    if (selectedDate === currentDate) return "Yet to Come";
    return "Yet to Come";
  }
  return "Yet to Come";
};

const safeText = (value: unknown) => String(value ?? "-")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const printField = (label: string, value: unknown) => `
  <div class="queue-print-field">
    <span>${safeText(label)}</span>
    <strong>${safeText(value === "" || value === null || value === undefined ? "-" : value)}</strong>
  </div>
`;

export default function OpQueuePage({ setNotice, onOpenPatient, onNavigate }: Props) {
  const [queue, setQueue] = useState<QueuePatient[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [doctorOptions, setDoctorOptions] = useState<string[]>([]);
  const [opSummary, setOpSummary] = useState<OpSummary | null>(null);
  const [selectedToken, setSelectedToken] = useState("");
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [visitTypeFilter, setVisitTypeFilter] = useState("");
  const [queueTypeFilter, setQueueTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortField, setSortField] = useState<"token" | "name" | "doctor" | "status">("token");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [visitDateFilter, setVisitDateFilter] = useState(() => new Date().toISOString().slice(0, 10));
  const [currentPage, setCurrentPage] = useState(1);
  const [patientDrawerOpen, setPatientDrawerOpen] = useState(false);
  const [patientDetails, setPatientDetails] = useState<Patient | null>(null);
  const [patientDetailsLoading, setPatientDetailsLoading] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [timerTick, setTimerTick] = useState(0);
  const selectedPatient = queue.find((patient) => patient.token === selectedToken) || queue.find((patient) => patient.status !== "Completed") || queue[0];
  const pageSize = 8;

  const loadQueueFromPatients = async () => {
    try {
      const appointmentDateQuery = visitDateFilter ? `?date=${encodeURIComponent(visitDateFilter)}&visit_type=OP` : "?visit_type=OP";
      const [data, departmentData, scheduleData, summaryData] = await Promise.all([
        apiFetch<{ appointments?: Array<any> }>(`/api/appointments${appointmentDateQuery}`),
        apiFetch<{ departments?: DepartmentOption[] }>("/api/registration/departments").catch(() => ({ departments: [] as DepartmentOption[] })),
        apiFetch<{ schedules?: DoctorScheduleOption[] }>("/api/op/doctor-schedules").catch(() => ({ schedules: [] as DoctorScheduleOption[] })),
        apiFetch<OpSummary>(`/api/op/summary?date=${encodeURIComponent(visitDateFilter)}`).catch(() => null),
      ]);


      const readmitQueue = JSON.parse(localStorage.getItem("hospai_op_queue") || "[]");
      const readmitEntries = (Array.isArray(readmitQueue) ? readmitQueue : [])
        .filter((item) => item && item.status !== "Completed")
        .map((item) => ({
          token: String(item.token || `RA-${String(Date.now()).slice(-6)}`),
          uhid: String(item.uhid || ""),
          name: String(item.name || item.uhid || "Patient"),
          ageGender: String(item.ageGender || "- / -"),
          visitType: String(item.visitType || "Readmission"),
          arrivedAt: String(item.arrivedAt || "--"),
          arrivedAtRaw: String(item.arrivedAtRaw || item.arrivedAt || new Date().toISOString()),
          status: (item.status || "In Queue") as QueuePatient["status"],
          mobile: String(item.mobile || ""),
          department: String(item.department || ""),
          doctor: String(item.doctor || ""),
          priority: String(item.priority || "Normal") as QueuePatient["priority"],
        }));
      const mapped = (data.appointments || [])
        .filter((appointment) => !["completed", "cancelled"].includes(String(appointment.status || "").toLowerCase()))
        .filter((appointment) => !readmitEntries.some((entry) => entry.uhid === appointment.patient_id))
        .map((appointment, index) => {
          const age = String(appointment.age ?? "").trim();
          const gender = String(appointment.gender ?? "").trim();
          const ageGender = age || gender ? `${age || "-"} / ${gender || "-"}` : "- / -";
          const registeredName = String(appointment.registered_patient_name || "").trim();
          return {
            token: appointment.token_no ? `GM-${String(appointment.token_no).padStart(3, "0")}` : `GM-${String(index + 1).padStart(3, "0")}`,
            uhid: appointment.patient_id || "",
            name: appointment.patient_name || registeredName || appointment.patient_id || "Patient",
            ageGender,
            visitType: appointment.appointment_kind || appointment.visit_type || "OP",
            arrivedAt: appointment.appointment_date ? new Date(appointment.appointment_date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--",
            arrivedAtRaw: appointment.appointment_date || new Date().toISOString(),
            status: mapAppointmentStatus(appointment.status, appointment.appointment_date),
            mobile: String(appointment.mobile || appointment.phone || ""),
            appointmentId: Number(appointment.id),
            department: String(appointment.department || ""),
            doctor: String(appointment.doctor_name || ""),
            priority: (appointment.appointment_kind === "emergency" ? "High" : appointment.follow_up_for ? "Follow-up" : "Normal") as QueuePatient["priority"],
          };
        });
      const nextQueue = [...readmitEntries, ...mapped];
      const departmentNames = new Set<string>();
      (departmentData.departments || [])
        .filter((department) => isActiveDepartment(department))
        .forEach((department) => {
          const name = String(department.department_name || "").trim();
          if (name) departmentNames.add(name);
        });
      (scheduleData.schedules || [])
        .filter((schedule) => isActiveDoctorSchedule(schedule))
        .forEach((schedule) => {
          const name = String(schedule.department || "").trim();
          if (name) departmentNames.add(name);
        });
      nextQueue.forEach((patient) => {
        const name = String(patient.department || "").trim();
        if (name) departmentNames.add(name);
      });
      const doctorNames = new Set<string>();
      (scheduleData.schedules || [])
        .filter((schedule) => isActiveDoctorSchedule(schedule))
        .forEach((schedule) => {
          const name = String(schedule.doctor_name || "").trim();
          if (name) doctorNames.add(name);
        });
      nextQueue.forEach((patient) => {
        const name = String(patient.doctor || "").trim();
        if (name) doctorNames.add(name);
      });
      setDepartmentOptions(Array.from(departmentNames).sort((a, b) => a.localeCompare(b)));
      setDoctorOptions(Array.from(doctorNames).sort((a, b) => a.localeCompare(b)));
      setQueue(nextQueue as QueuePatient[]);
      setOpSummary(summaryData || null);
      setSelectedToken((current) => nextQueue.some((patient) => patient.token === current && patient.status !== "Completed") ? current : (nextQueue.find((patient) => patient.status === "In Queue") || nextQueue.find((patient) => patient.status !== "Completed") || nextQueue[0])?.token || "");
    } catch (error) {
      setQueue([]);
      setDepartmentOptions([]);
      setDoctorOptions([]);
      setSelectedToken("");
      setNotice({ type: "warning", message: "Unable to load live OP queue." });
    }
  };

  useEffect(() => {
    void loadQueueFromPatients();
  }, [visitDateFilter]);
  const departments = useMemo(() => departmentOptions, [departmentOptions]);
  const doctors = useMemo(() => doctorOptions, [doctorOptions]);

  useEffect(() => {
    const id = setInterval(() => setTimerTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const waitingDuration = (patient: QueuePatient) => formatDuration(patient.arrivedAtRaw || patient.arrivedAt);

  const pickNextPatient = (candidates: QueuePatient[]) => {
    if (!candidates || !candidates.length) return null;
    const priorityOrder: Record<string, number> = { High: 0, "Follow-up": 1, Normal: 2 };
    const sorted = [...candidates].sort((a, b) => {
      const pa = priorityOrder[String(a.priority || "Normal")];
      const pb = priorityOrder[String(b.priority || "Normal")];
      if (pa !== pb) return pa - pb;
      const ta = new Date(a.arrivedAtRaw || a.arrivedAt || 0).getTime();
      const tb = new Date(b.arrivedAtRaw || b.arrivedAt || 0).getTime();
      return ta - tb;
    });
    return sorted[0];
  };
  const formatInterval = (start?: string | null, end?: string | null) => {
    if (!start) return "-";
    const s = new Date(start).getTime();
    const e = end ? new Date(end).getTime() : Date.now();
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) return "-";
    const diff = Math.max(0, e - s);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    if (hours > 0) return `${hours}h ${remaining}m`;
    return `${remaining}m`;
  };

  const filteredQueue = useMemo(() => {
    const term = search.trim().toLowerCase();
    return queue.filter((patient) => {
      const matchesSearch = !term || [patient.token, patient.uhid, patient.name, patient.mobile, patient.department || "", patient.doctor || ""].some((value) => value.toLowerCase().includes(term));
      const matchesDepartment = !departmentFilter || patient.department === departmentFilter;
      const matchesDoctor = !doctorFilter || patient.doctor === doctorFilter;
      const matchesVisitType = !visitTypeFilter || patient.visitType.toLowerCase().includes(visitTypeFilter.toLowerCase());
      const matchesQueueType = !queueTypeFilter || (queueTypeFilter === "walkin" ? patient.token.startsWith("GM-") : patient.token.startsWith("RA-"));
      const matchesStatus = !statusFilter || patient.status === statusFilter;
      return matchesSearch && matchesDepartment && matchesDoctor && matchesVisitType && matchesQueueType && matchesStatus;
    });
  }, [queue, search, departmentFilter, doctorFilter, visitTypeFilter, queueTypeFilter, statusFilter]);

  const sortedQueue = useMemo(() => {
    const next = [...filteredQueue];
    next.sort((a, b) => {
      const fieldA = String(a[sortField] ?? "").toLowerCase();
      const fieldB = String(b[sortField] ?? "").toLowerCase();
      if (fieldA === fieldB) return 0;
      return sortDirection === "asc" ? (fieldA < fieldB ? -1 : 1) : (fieldA < fieldB ? 1 : -1);
    });
    return next;
  }, [filteredQueue, sortField, sortDirection]);

  const queueByStatus = useMemo(() => ({
    inQueue: filteredQueue.filter((patient) => patient.status === "In Queue"),
    inConsultation: filteredQueue.filter((patient) => patient.status === "In Consultation"),
    completed: filteredQueue.filter((patient) => patient.status === "Completed"),
    yetToCome: filteredQueue.filter((patient) => patient.status === "Yet to Come"),
  }), [filteredQueue]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, departmentFilter, doctorFilter, visitTypeFilter, queueTypeFilter, statusFilter, visitDateFilter]);

  const totalPages = Math.max(1, Math.ceil(sortedQueue.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedQueue = sortedQueue.slice((safePage - 1) * pageSize, safePage * pageSize);

  const counts = useMemo(() => ({
    total: queue.length,
    completed: queue.filter((patient) => patient.status === "Completed").length,
    inConsultation: queue.filter((patient) => patient.status === "In Consultation").length,
    inQueue: queue.filter((patient) => patient.status === "In Queue").length,
    yet: queue.filter((patient) => patient.status === "Yet to Come").length,
  }), [queue]);


  const getStatusBadgeClass = (status?: QueuePatient["status"]) => {
    if (status === "Completed") return "queue-badge completed";
    if (status === "In Consultation") return "queue-badge consultation";
    if (status === "Yet to Come") return "queue-badge hold";
    return "queue-badge";
  };

  const callNext = () => {
    const waiting = queue.filter((p) => p.status === "In Queue");
    const candidate = pickNextPatient(waiting) || queue.find((patient) => patient.status === "Yet to Come");
    if (!candidate) {
      setNotice({ type: "warning", message: "No waiting patient is currently in the OP queue." });
      return;
    }
    // mark as in consultation and set start time
    setQueue((current) => {
      const next = current.map((p) => p.token === candidate.token ? { ...p, status: "In Consultation" as QueuePatient["status"], consultationStartedAt: p.consultationStartedAt || new Date().toISOString() } : p);
      saveReadmitQueueState(next);
      return next;
    });
    setSelectedToken(candidate.token);
    setNotice({ type: "success", message: `Calling next patient: ${candidate.name}.` });
  };
  const saveReadmitQueueState = (nextQueue: QueuePatient[]) => {
    const readmitOnly = nextQueue.filter((patient) => patient.token.startsWith("RA-"));
    localStorage.setItem("hospai_op_queue", JSON.stringify(readmitOnly));
  };

  const updateSelectedStatus = async (status: QueuePatient["status"]) => {
    if (!selectedToken || !selectedPatient) {
      setNotice({ type: "warning", message: "Select a queue token first." });
      return;
    }
    const backendStatus = status === "In Consultation" ? "in_consultation" : status === "Completed" ? "completed" : status === "In Queue" ? "checked_in" : "scheduled";
    try {
      if (selectedPatient.appointmentId) {
        await apiFetch(`/api/appointments/${selectedPatient.appointmentId}`, {
          method: "PUT",
          body: JSON.stringify({ status: backendStatus }),
        });
      }
      setQueue((current) => {
        const next = current.map((patient) => {
          if (patient.token !== selectedToken) return patient;
          const now = new Date().toISOString();
          if (status === "In Consultation") return { ...patient, status, consultationStartedAt: patient.consultationStartedAt || now };
          if (status === "Completed") return { ...patient, status, completedAt: patient.completedAt || now };
          return { ...patient, status };
        });
        saveReadmitQueueState(next);
        if (status === "Completed") {
          const nextWaiting = next.find((patient) => patient.status === "In Queue") || next.find((patient) => patient.status === "Yet to Come");
          setSelectedToken(nextWaiting?.token || "");
        }
        return next;
      });
      setNotice({ type: "success", message: `${selectedToken} moved to ${status}.` });
    } catch {
      setNotice({ type: "error", message: `Unable to move ${selectedToken} to ${status}.` });
    }
  };
  const removeToken = () => {
    if (!selectedToken) {
      setNotice({ type: "warning", message: "Select a queue token first." });
      return;
    }
    const nextQueue = queue.filter((patient) => patient.token !== selectedToken);
    setQueue(nextQueue);
    saveReadmitQueueState(nextQueue);
    setSelectedToken(nextQueue[0]?.token || "");
    setNotice({ type: "success", message: `${selectedToken} removed from queue.` });
  };

  const sortByField = (field: "token" | "name" | "doctor" | "status") => {
    if (sortField === field) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection("asc");
  };

  const formatDuration = (dateString?: string | null) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "-";
    const diff = Math.max(0, Date.now() - date.getTime());
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    if (hours > 0) return `${hours}h ${remaining}m`;
    return `${remaining}m`;
  };

  const loadPatientDetails = async (uhid: string) => {
    setPatientDetailsLoading(true);
    setPatientDrawerOpen(true);
    try {
      const data = await apiFetch<{ patient?: Patient }>(`/api/patients/${encodeURIComponent(uhid)}`);
      setPatientDetails(data.patient || null);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load patient details.");
      setPatientDetails(null);
    } finally {
      setPatientDetailsLoading(false);
    }
  };

  const openPatientDetails = async (patient: QueuePatient) => {
    setSelectedToken(patient.token);
    if (patient.uhid) {
      await loadPatientDetails(patient.uhid);
    }
  };

  const setPatientStatus = async (patient: QueuePatient, status: QueuePatient["status"]) => {
    const backendStatus = status === "In Consultation" ? "in_consultation" : status === "Completed" ? "completed" : status === "In Queue" ? "checked_in" : "scheduled";
    try {
      if (patient.appointmentId) {
        await apiFetch(`/api/appointments/${patient.appointmentId}`, {
          method: "PUT",
          body: JSON.stringify({ status: backendStatus }),
        });
      }
      setQueue((current) => {
        const next = current.map((item) => {
          if (item.token !== patient.token) return item;
          const now = new Date().toISOString();
          if (status === "In Consultation") return { ...item, status, consultationStartedAt: item.consultationStartedAt || now };
          if (status === "Completed") return { ...item, status, completedAt: item.completedAt || now };
          return { ...item, status };
        });
        saveReadmitQueueState(next);
        return next;
      });
      setSelectedToken(patient.token);
      setNotice({ type: "success", message: `${patient.token} moved to ${status}.` });
    } catch {
      setNotice({ type: "error", message: `Unable to update ${patient.token} status.` });
    }
  };

  const handlePatientAction = async (patient: QueuePatient, action: "start" | "hold" | "transfer" | "remove") => {
    if (action === "start") {
      await setPatientStatus(patient, "In Consultation");
      return;
    }
    if (action === "hold") {
      await setPatientStatus(patient, "Yet to Come");
      return;
    }
    if (action === "transfer") {
      setSelectedToken(patient.token);
      setNotice({ type: "success", message: `${patient.token} is ready to transfer. Select target doctor from Doctor dropdown.` });
      return;
    }
    if (action === "remove") {
      setQueue((current) => {
        const next = current.filter((item) => item.token !== patient.token);
        saveReadmitQueueState(next);
        return next;
      });
      if (selectedToken === patient.token) {
        setSelectedToken(queue.find((item) => item.status !== "Completed")?.token || "");
      }
      setNotice({ type: "success", message: `${patient.token} removed from queue.` });
    }
  };

  const printPatientSlip = (patient: QueuePatient) => {
    setSelectedToken(patient.token);
    printSelectedSlip();
  };

  const transferSelectedToken = () => {
    if (!selectedToken) {
      setNotice({ type: "warning", message: "Select a queue token first." });
      return;
    }
    setNotice({ type: "success", message: `${selectedToken} is ready to transfer. Select target doctor from Doctor dropdown.` });
  };

  const skipSelected = () => {
    if (!selectedToken) {
      setNotice({ type: "warning", message: "Select a patient to skip." });
      return;
    }
    const patient = queue.find((p) => p.token === selectedToken);
    if (!patient) return setNotice({ type: "warning", message: "Selected patient not found." });
    if (patient.status !== "In Queue") return setNotice({ type: "warning", message: "Only waiting patients can be skipped." });
    setQueue((current) => {
      const next = current.map((p) => p.token === patient.token ? { ...p, arrivedAtRaw: new Date().toISOString() } : p);
      saveReadmitQueueState(next);
      return next;
    });
    setNotice({ type: "success", message: `${patient.token} skipped. Calling next patient.` });
    setTimeout(() => callNext(), 150);
  };

  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferTargetDoctor, setTransferTargetDoctor] = useState("");
  const openTransferModal = () => {
    if (!selectedToken) return setNotice({ type: "warning", message: "Select a patient to transfer." });
    setTransferModalOpen(true);
  };
  const confirmTransfer = async () => {
    if (!selectedToken || !selectedPatient || !transferTargetDoctor) {
      setNotice({ type: "warning", message: "Select target doctor." });
      return;
    }
    try {
      if (selectedPatient.appointmentId) {
        await apiFetch(`/api/appointments/${selectedPatient.appointmentId}`, {
          method: "PUT",
          body: JSON.stringify({ doctor_name: transferTargetDoctor }),
        });
      }
      setQueue((current) => {
        const next = current.map((p) => p.token === selectedToken ? { ...p, doctor: transferTargetDoctor } : p);
        saveReadmitQueueState(next);
        return next;
      });
      setTransferModalOpen(false);
      setNotice({ type: "success", message: `${selectedToken} transferred to ${transferTargetDoctor}.` });
    } catch {
      setNotice({ type: "error", message: `Unable to transfer ${selectedToken} to ${transferTargetDoctor}.` });
    }
  };

  const exportQueueToCsv = () => {
    if (filteredQueue.length === 0) {
      setNotice({ type: "warning", message: "No patients to export." });
      return;
    }
    const headers = ["Token No.", "UHID", "Patient Name", "Age/Gender", "Visit Type", "Arrived At", "Status", "Mobile", "Department", "Doctor", "Priority"];
    const rows = filteredQueue.map((p) => [
      p.token,
      p.uhid,
      p.name,
      p.ageGender,
      p.visitType,
      p.arrivedAt,
      p.status,
      p.mobile,
      p.department || "",
      p.doctor || "",
      p.priority || "Normal",
    ]);
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map((e) => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `OP_Queue_${visitDateFilter}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setNotice({ type: "success", message: "OP Queue exported successfully." });
  };

  const clearFilters = () => {
    setDepartmentFilter("");
    setDoctorFilter("");
    setVisitDateFilter(new Date().toISOString().slice(0, 10));
    setVisitTypeFilter("");
    setQueueTypeFilter("");
    setStatusFilter("");
    setSearch("");
    void loadQueueFromPatients();
  };

  const printSelectedSlip = () => {
    if (!selectedPatient) {
      setNotice({ type: "warning", message: "Select a queue token before printing." });
      return;
    }
    const printedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
        const html = `
      <!doctype html>
      <html>
        <head>
          <title>${safeText(selectedPatient.token)} OP Queue Slip</title>
          <style>
            @page { size: A5 portrait; margin: 10mm; }
            * { box-sizing: border-box; }
            body { margin: 0; background: #ffffff; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
            .queue-print-sheet { width: 100%; min-height: 100vh; }
            .queue-print-header { display: flex; flex-direction: column; align-items: stretch; gap: 8px; margin-bottom: 12px; }
            .queue-print-brand { display: flex; align-items: center; gap: 10px; width: 100%; max-width: none; }
            .queue-print-brand img { display: block; width: 100%; max-height: 86px; height: auto; object-fit: contain; object-position: left center; }
            .queue-print-brand strong { display: block; color: #062f56; font-size: 22px; line-height: 1; }
            .queue-print-brand span { display: block; margin-top: 4px; color: #475569; font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; }
            .queue-print-title { text-align: right; border-top: 1px solid #e5e7eb; padding-top: 5px; }
            .queue-print-title h1 { margin: 0 0 5px; font-size: 16px; text-decoration: underline; }
            .queue-print-title p { margin: 2px 0; color: #475569; }
            .queue-print-token { margin: 0 0 12px; padding: 12px; border: 2px solid #111827; text-align: center; }
            .queue-print-token span { display: block; color: #334155; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
            .queue-print-token strong { display: block; margin-top: 4px; color: #062f56; font-size: 32px; line-height: 1; }
            .queue-print-section { border: 1px solid #111827; border-bottom: 0; }
            .queue-print-section:last-child { border-bottom: 1px solid #111827; }
            .queue-print-section h2 { margin: 0; padding: 6px 8px; border-bottom: 1px solid #111827; background: #eef7fb; color: #062f56; font-size: 12px; letter-spacing: 0.02em; text-transform: uppercase; }
            .queue-print-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .queue-print-field { min-height: 32px; padding: 6px 8px; border-right: 1px solid #111827; border-bottom: 1px solid #111827; }
            .queue-print-field:nth-child(2n) { border-right: 0; }
            .queue-print-field span { display: block; margin-bottom: 3px; color: #334155; font-size: 9px; font-weight: 700; text-transform: uppercase; }
            .queue-print-field strong { display: block; color: #111827; font-size: 11px; }
            .queue-print-note { padding: 8px; border-bottom: 1px solid #111827; color: #334155; line-height: 1.45; }
            .queue-print-signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; margin-top: 24px; }
            .queue-print-signatures div { padding-top: 22px; border-top: 1px solid #111827; text-align: center; font-weight: 700; }
          </style>
        </head>
        <body>
          <main class="queue-print-sheet">
            <header class="queue-print-header">
              <div class="queue-print-brand">
                <img src="${PRINT_BRAND_HEADER_DATA_URI}" alt="VERARA Polyclinic, Pharmacy, Diagnostics" />
              </div>
              <div class="queue-print-title">
                <h1>OP Queue Slip</h1>
                <p><strong>Printed:</strong> ${safeText(printedAt)}</p>
              </div>
            </header>
            <div class="queue-print-token"><span>Token Number</span><strong>${safeText(selectedPatient.token)}</strong></div>
            <section class="queue-print-section">
              <h2>Patient Information</h2>
              <div class="queue-print-grid">
                ${printField("Patient Name", selectedPatient.name)}
                ${printField("UHID / Patient ID", selectedPatient.uhid)}
                ${printField("Age / Gender", selectedPatient.ageGender)}
                ${printField("Mobile", selectedPatient.mobile || "-")}
              </div>
            </section>
            <section class="queue-print-section">
              <h2>Visit Information</h2>
              <div class="queue-print-grid">
                ${printField("Visit Type", selectedPatient.visitType)}
                ${printField("Arrived At", selectedPatient.arrivedAt)}
                ${printField("Status", selectedPatient.status)}
                ${printField("Department / Doctor", `${selectedPatient.department || "-"} / ${selectedPatient.doctor || "-"}`)}
              </div>
            </section>
            <section class="queue-print-section">
              <h2>Queue Instructions</h2>
              <div class="queue-print-note">Please wait until your token number is called. Keep this slip with you and present it at the OP consultation desk.</div>
            </section>
            <div class="queue-print-signatures"><div>Patient / Guardian</div><div>OP Desk</div></div>
          </main>
        </body>
      </html>`;
    printViaIframe(html, "__hospai_opqueue_print_frame__");
  };

  return (
    <section className="module-page op-queue-page">
      <div className="op-queue-header-banner">
        <div className="op-queue-banner-left">
          <div className="op-queue-banner-icon-bg">
            <span className="op-queue-banner-icon">👥</span>
          </div>
          <div className="op-queue-banner-text">
            <h2>OP Queue Management</h2>
            <p>Manage OP patient queue and consult status</p>
          </div>
        </div>
        <div className="op-queue-banner-right">
          <Button type="button" className="purple-action" onClick={() => onNavigate && onNavigate("add")}>
            + Add Token
          </Button>
          <Button type="button" className="white-action" onClick={() => void loadQueueFromPatients()}>
            🔄 Refresh
          </Button>
          <Button type="button" className="green-action" onClick={exportQueueToCsv}>
            📥 Export
          </Button>
        </div>
      </div>

      <div className="op-card queue-filters-card-full">
        <div className="op-filter-grid-4col">
          <label>
            <span className="op-filter-label">Department</span>
            <Select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
              <option value="">{departments.length ? "All Departments" : "No Departments Available"}</option>
              {departments.map((name) => <option key={name} value={name}>{name}</option>)}
            </Select>
          </label>
          <label>
            <span className="op-filter-label">Doctor</span>
            <Select value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value)}>
              <option value="">{doctors.length ? "All Doctors" : "No Doctors Available"}</option>
              {doctors.map((name) => <option key={name} value={name}>{name}</option>)}
            </Select>
          </label>
          <label>
            <span className="op-filter-label">Visit Date</span>
            <Input type="date" value={visitDateFilter} onChange={(event) => setVisitDateFilter(event.target.value)} />
          </label>
          <label>
            <span className="op-filter-label">Visit Type</span>
            <Select value={visitTypeFilter} onChange={(event) => setVisitTypeFilter(event.target.value)}>
              <option value="">All</option>
              <option value="OP">OPD</option>
              <option value="IP">IP</option>
              <option value="Emergency">Emergency</option>
              <option value="Readmission">Readmission</option>
            </Select>
          </label>
          <label>
            <span className="op-filter-label">Queue Type</span>
            <Select value={queueTypeFilter} onChange={(event) => setQueueTypeFilter(event.target.value)}>
              <option value="">All</option>
              <option value="walkin">Walk-in / Appointment</option>
              <option value="readmit">Readmission Queue</option>
            </Select>
          </label>
          <label>
            <span className="op-filter-label">Status</span>
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All</option>
              <option value="In Queue">In Queue</option>
              <option value="In Consultation">In Consultation</option>
              <option value="Completed">Completed</option>
              <option value="Yet to Come">Yet to Come</option>
            </Select>
          </label>
          <label className="op-search-label">
            <span className="op-filter-label">Search</span>
            <div className="search-with-clear-btn">
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="UHID, name, mobile..." />
              <button type="button" className="filter-clear-btn" title="Reset Filters" onClick={clearFilters}>
                Clear
              </button>
            </div>
          </label>
        </div>
      </div>

      <div className="kpi-cards-row">
        <div className="kpi-card kpi-tokens clickable" onClick={() => setStatusFilter("")}>
          <div className="kpi-card-top">
            <span className="kpi-icon icon-tokens">👥</span>
            <span className="kpi-label">Total Tokens</span>
          </div>
          <div className="kpi-value">{counts.total}</div>
        </div>
        <div className="kpi-card kpi-waiting clickable" onClick={() => setStatusFilter("In Queue")}>
          <div className="kpi-card-top">
            <span className="kpi-icon icon-waiting">⏳</span>
            <span className="kpi-label">Waiting</span>
          </div>
          <div className="kpi-value">{counts.inQueue}</div>
        </div>
        <div className="kpi-card kpi-consult clickable" onClick={() => setStatusFilter("In Consultation")}>
          <div className="kpi-card-top">
            <span className="kpi-icon icon-consult">👤</span>
            <span className="kpi-label">In Consultation</span>
          </div>
          <div className="kpi-value">{counts.inConsultation}</div>
        </div>
        <div className="kpi-card kpi-completed clickable" onClick={() => setStatusFilter("Completed")}>
          <div className="kpi-card-top">
            <span className="kpi-icon icon-completed">✅</span>
            <span className="kpi-label">Completed</span>
          </div>
          <div className="kpi-value">{counts.completed}</div>
        </div>
        <div className="kpi-card kpi-upcoming clickable" onClick={() => setStatusFilter("Yet to Come")}>
          <div className="kpi-card-top">
            <span className="kpi-icon icon-upcoming">📅</span>
            <span className="kpi-label">Yet to Come</span>
          </div>
          <div className="kpi-value">{counts.yet}</div>
        </div>
        <div className="kpi-card kpi-doctors">
          <div className="kpi-card-top">
            <span className="kpi-icon icon-doctors">🩺</span>
            <span className="kpi-label">Doctors</span>
          </div>
          <div className="kpi-value">{opSummary?.available_doctors ?? 0}</div>
        </div>
        <div className="kpi-card kpi-followups">
          <div className="kpi-card-top">
            <span className="kpi-icon icon-followups">📋</span>
            <span className="kpi-label">Follow-ups</span>
          </div>
          <div className="kpi-value">{opSummary?.follow_ups ?? 0}</div>
        </div>
        <div className="kpi-card kpi-active">
          <div className="kpi-card-top">
            <span className="kpi-icon icon-active">⭐</span>
            <span className="kpi-label">Active Queue</span>
          </div>
          <div className="kpi-value">{opSummary?.active_queue ?? 0}</div>
        </div>
      </div>

      <div className="op-main-grid">
        <div>
          <div className="op-card queue-board-card">
            <div className="queue-board-header-grid">
              <div>
                <h3>OP Queue Board</h3>
                <p>Monitor live queue status across all stages.</p>
              </div>
              <Button type="button" className="teal-action" onClick={() => setDetailsModalOpen(true)}>Open Patient Details</Button>
            </div>
            <div className="queue-board">
              <div className="queue-board-column">
                <div className="queue-board-header"><span>In Queue</span><strong>{queueByStatus.inQueue.length}</strong></div>
                {queueByStatus.inQueue.map((patient) => (
                  <div key={patient.token} role="button" tabIndex={0} className={`queue-board-item ${patient.token === selectedToken ? "selected" : ""}`} onClick={() => setSelectedToken(patient.token)}>
                    <div className="queue-card-header">
                      <div className="queue-token">
                        <strong>{patient.token}</strong>
                        <span className="visit-type-badge">{patient.visitType}</span>
                      </div>
                      <div className="queue-wait">Wait: <strong>{waitingDuration(patient)}</strong></div>
                    </div>
                    <div className="queue-board-item-name">{patient.name}</div>
                    <div className="queue-board-item-details">
                      <div><small>UHID</small><b>{patient.uhid || "-"}</b></div>
                      <div><small>Age / Gender</small><b>{patient.ageGender || "- / -"}</b></div>
                      <div><small>Doctor</small><b>{patient.doctor || "-"}</b></div>
                      <div><small>Department</small><b>{patient.department || "-"}</b></div>
                      <div><small>Priority</small><b>{patient.priority || "Normal"}</b></div>
                    </div>
                    <div className="queue-card-actions">
                      <button type="button" className="action-start" onClick={(e) => { e.stopPropagation(); handlePatientAction(patient, "start"); }}>Start</button>
                      <button type="button" className="action-hold" onClick={(e) => { e.stopPropagation(); handlePatientAction(patient, "hold"); }}>Hold</button>
                      <button type="button" className="action-transfer" onClick={(e) => { e.stopPropagation(); setSelectedToken(patient.token); setTransferTargetDoctor(patient.doctor || ""); setTransferModalOpen(true); }}>Transfer</button>
                      <button type="button" className="action-cancel" onClick={(e) => { e.stopPropagation(); handlePatientAction(patient, "remove"); }}>Cancel</button>
                      <button type="button" className="action-print" onClick={(e) => { e.stopPropagation(); printPatientSlip(patient); }}>Print</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="queue-board-column">
                <div className="queue-board-header"><span>In Consultation</span><strong>{queueByStatus.inConsultation.length}</strong></div>
                {queueByStatus.inConsultation.map((patient) => (
                  <div key={patient.token} role="button" tabIndex={0} className={`queue-board-item ${patient.token === selectedToken ? "selected" : ""}`} onClick={() => setSelectedToken(patient.token)}>
                    <div className="queue-card-header">
                      <div className="queue-token">
                        <strong>{patient.token}</strong>
                        <span className="visit-type-badge">{patient.visitType}</span>
                      </div>
                      <div className="queue-wait">Consult: <strong>{formatDuration(patient.consultationStartedAt)}</strong></div>
                    </div>
                    <div className="queue-board-item-name">{patient.name}</div>
                    <div className="queue-board-item-details">
                      <div><small>UHID</small><b>{patient.uhid || "-"}</b></div>
                      <div><small>Age / Gender</small><b>{patient.ageGender || "- / -"}</b></div>
                      <div><small>Doctor</small><b>{patient.doctor || "-"}</b></div>
                      <div><small>Department</small><b>{patient.department || "-"}</b></div>
                      <div><small>Priority</small><b>{patient.priority || "Normal"}</b></div>
                    </div>
                    <div className="queue-card-actions">
                      <button type="button" className="action-open" onClick={(e) => { e.stopPropagation(); openPatientDetails(patient); }}>Open</button>
                      <button type="button" className="action-complete" onClick={(e) => { e.stopPropagation(); void setPatientStatus(patient, "Completed"); }}>Complete</button>
                      <button type="button" className="action-transfer" onClick={(e) => { e.stopPropagation(); setSelectedToken(patient.token); setTransferTargetDoctor(patient.doctor || ""); setTransferModalOpen(true); }}>Transfer</button>
                      <button type="button" className="action-print" onClick={(e) => { e.stopPropagation(); printPatientSlip(patient); }}>Print</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="queue-board-column">
                <div className="queue-board-header"><span>Yet to Come</span><strong>{queueByStatus.yetToCome.length}</strong></div>
                {queueByStatus.yetToCome.map((patient) => (
                  <div key={patient.token} role="button" tabIndex={0} className={`queue-board-item ${patient.token === selectedToken ? "selected" : ""}`} onClick={() => setSelectedToken(patient.token)}>
                    <div className="queue-card-header">
                      <div className="queue-token">
                        <strong>{patient.token}</strong>
                        <span className="visit-type-badge">{patient.visitType}</span>
                      </div>
                      <div className="queue-wait">Arrives: <strong>{patient.arrivedAt}</strong></div>
                    </div>
                    <div className="queue-board-item-name">{patient.name}</div>
                    <div className="queue-board-item-details">
                      <div><small>UHID</small><b>{patient.uhid || "-"}</b></div>
                      <div><small>Age / Gender</small><b>{patient.ageGender || "- / -"}</b></div>
                      <div><small>Doctor</small><b>{patient.doctor || "-"}</b></div>
                      <div><small>Department</small><b>{patient.department || "-"}</b></div>
                      <div><small>Priority</small><b>{patient.priority || "Normal"}</b></div>
                    </div>
                    <div className="queue-card-actions">
                      <button type="button" className="action-load" onClick={(e) => { e.stopPropagation(); openPatientDetails(patient); }}>Load</button>
                      <button type="button" className="action-cancel" onClick={(e) => { e.stopPropagation(); handlePatientAction(patient, "remove"); }}>Cancel</button>
                      <button type="button" className="action-print" onClick={(e) => { e.stopPropagation(); printPatientSlip(patient); }}>Print</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="queue-board-column">
                <div className="queue-board-header"><span>Completed</span><strong>{queueByStatus.completed.length}</strong></div>
                {queueByStatus.completed.map((patient) => (
                  <div key={patient.token} role="button" tabIndex={0} className={`queue-board-item ${patient.token === selectedToken ? "selected" : ""}`} onClick={() => setSelectedToken(patient.token)}>
                    <div className="queue-card-header">
                      <div className="queue-token">
                        <strong>{patient.token}</strong>
                        <span className="visit-type-badge">{patient.visitType}</span>
                      </div>
                      <div className="queue-wait">Done: <strong>{patient.completedAt ? new Date(patient.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}</strong></div>
                    </div>
                    <div className="queue-board-item-name">{patient.name}</div>
                    <div className="queue-board-item-details">
                      <div><small>UHID</small><b>{patient.uhid || "-"}</b></div>
                      <div><small>Age / Gender</small><b>{patient.ageGender || "- / -"}</b></div>
                      <div><small>Doctor</small><b>{patient.doctor || "-"}</b></div>
                      <div><small>Department</small><b>{patient.department || "-"}</b></div>
                      <div><small>Consulted</small><b>{formatInterval(patient.consultationStartedAt, patient.completedAt)}</b></div>
                    </div>
                    <div className="queue-card-actions">
                      <button type="button" className="action-view" onClick={(e) => { e.stopPropagation(); openPatientDetails(patient); }}>View</button>
                      <button type="button" className="action-print" onClick={(e) => { e.stopPropagation(); printPatientSlip(patient); }}>Print</button>
                      <button type="button" className="action-invoice" onClick={(e) => { e.stopPropagation(); onNavigate && onNavigate("billing-create-invoice"); }}>Invoice</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="op-card patient-details-card">
            <div className="patient-detail-header">
              <div>
                <h3>Selected Patient</h3>
                <p className="selected-patient-subtitle">{selectedPatient ? `${selectedPatient.name} — ${selectedPatient.token}` : "Select a patient card to see details."}</p>
              </div>
              <div className="patient-detail-actions">
                <Button type="button" className="white-action" onClick={() => {
                  if (selectedPatient?.uhid) {
                    onOpenPatient && onOpenPatient(selectedPatient.uhid);
                  } else {
                    setNotice({ type: "warning", message: "No patient selected." });
                  }
                }}>Load Profile</Button>
                <Button type="button" className="yellow-action" onClick={printSelectedSlip}>Print Slip</Button>
              </div>
            </div>
            <div className="patient-summary-panel-premium">
              <div className="patient-avatar-premium">👤</div>
              <div className="patient-detail-grid-premium">
                <span>Token No.</span><b>{selectedPatient?.token || "-"}</b>
                <span>Visit Type</span><b>{selectedPatient?.visitType || "-"}</b>
                <span>Patient Name</span><b>{selectedPatient?.name || "-"}</b>
                <span>Department</span><b>{selectedPatient?.department || "-"}</b>
                <span>UHID</span><b>{selectedPatient?.uhid || "-"}</b>
                <span>Doctor</span><b>{selectedPatient?.doctor || "-"}</b>
                <span>Age / Gender</span><b>{selectedPatient?.ageGender || "-"}</b>
                <span>Arrived At</span><b>{selectedPatient?.arrivedAt || "-"}</b>
                <span>Mobile</span><b>{selectedPatient?.mobile || "-"}</b>
                <span>Status</span>
                <div>
                  <span className={getStatusBadgeClass(selectedPatient?.status)}>
                    {selectedPatient?.status || "-"}
                  </span>
                </div>
              </div>
            </div>
            <div className="clinical-panel-premium">
              <h4>Quick Actions</h4>
              <div className="queue-action-grid-premium">
                <button className="queue-action-btn green-btn" type="button" onClick={() => void updateSelectedStatus("In Consultation")}>
                  <div className="btn-icon-label-wrap">
                    <span className="btn-large-icon">♟</span>
                    <div className="btn-texts">
                      <strong>Start Consultation</strong>
                      <small>Move patient to consultation</small>
                    </div>
                  </div>
                  <span className="btn-arrow">›</span>
                </button>
                <button className="queue-action-btn teal-btn" type="button" onClick={() => void updateSelectedStatus("Completed")}>
                  <div className="btn-icon-label-wrap">
                    <span className="btn-large-icon">✓</span>
                    <div className="btn-texts">
                      <strong>Finish Consultation</strong>
                      <small>Complete this visit</small>
                    </div>
                  </div>
                  <span className="btn-arrow">›</span>
                </button>
                <button className="queue-action-btn purple-btn" type="button" onClick={openTransferModal}>
                  <div className="btn-icon-label-wrap">
                    <span className="btn-large-icon">⇄</span>
                    <div className="btn-texts">
                      <strong>Transfer</strong>
                      <small>Transfer to another doctor</small>
                    </div>
                  </div>
                  <span className="btn-arrow">›</span>
                </button>
                <button className="queue-action-btn red-btn" type="button" onClick={removeToken}>
                  <div className="btn-icon-label-wrap">
                    <span className="btn-large-icon">⊗</span>
                    <div className="btn-texts">
                      <strong>Remove</strong>
                      <small>Remove from queue</small>
                    </div>
                  </div>
                  <span className="btn-arrow">›</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal open={detailsModalOpen} onClose={() => setDetailsModalOpen(false)} title="Patient Details" description="Full patient record from the backend.">
        {patientDetailsLoading ? (
          <p>Loading patient information…</p>
        ) : patientDetails ? (
          <div className="patient-details-modal">
            <div className="patient-summary-panel">
              <div className="patient-avatar">👤</div>
              <div className="patient-detail-grid">
                <span>Name</span><b>{patientDetails.name}</b>
                <span>UHID</span><b>{patientDetails.patient_id}</b>
                <span>Age</span><b>{patientDetails.age || "-"}</b>
                <span>Gender</span><b>{patientDetails.gender || "-"}</b>
                <span>Phone</span><b>{patientDetails.phone || "-"}</b>
                <span>Address</span><b>{patientDetails.address || "-"}</b>
                <span>Emergency Contact</span><b>{patientDetails.emergency_contact || "-"}</b>
                <span>Allergies</span><b>{patientDetails.allergies || "-"}</b>
              </div>
            </div>
          </div>
        ) : (
          <p>No patient details loaded yet. Select a token and click Load Profile.</p>
        )}
      </Modal>

      <Modal open={transferModalOpen} onClose={() => setTransferModalOpen(false)} title="Transfer Patient" description="Select a doctor to transfer this patient to.">
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid" }}><span style={{ fontWeight: 800 }}>Doctor</span>
            <Select value={transferTargetDoctor} onChange={(e) => setTransferTargetDoctor(e.target.value)}>
              <option value="">Select doctor</option>
              {doctors.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" onClick={() => setTransferModalOpen(false)}>Cancel</Button>
            <Button type="button" className="purple-action" onClick={confirmTransfer}>Confirm Transfer</Button>
          </div>
        </div>
      </Modal>

      <div className="queue-note">ⓘ <b>Note:</b> Queue is based on token arrival time. Please call patients in order to maintain OP flow.</div>
    </section>
  );
}
