import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button, Input, Modal, Select } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import type { Notice, OpSummary, Patient } from "../types";
import { PRINT_BRAND_HEADER_DATA_URI } from "../lib/printBrand";
import { printViaIframe } from "../lib/printViaIframe";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  onOpenPatient?: (patientId: string) => void;
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
};

const mapAppointmentStatus = (status?: string): QueuePatient["status"] => {
  if (status === "completed") return "Completed";
  if (status === "in_consultation") return "In Consultation";
  if (status === "checked_in" || status === "scheduled") return "In Queue";
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

export default function OpQueuePage({ setNotice, onOpenPatient }: Props) {
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
          status: (item.status || "In Queue") as QueuePatient["status"],
          mobile: String(item.mobile || ""),
          department: String(item.department || ""),
          doctor: String(item.doctor || ""),
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
            status: mapAppointmentStatus(appointment.status),
            mobile: String(appointment.mobile || appointment.phone || ""),
            appointmentId: Number(appointment.id),
            department: String(appointment.department || ""),
            doctor: String(appointment.doctor_name || ""),
          };
        });
      const nextQueue = [...readmitEntries, ...mapped];
      const departmentNames = new Set<string>();
      (departmentData.departments || []).forEach((department) => {
        const name = String(department.department_name || "").trim();
        if (name) departmentNames.add(name);
      });
      (scheduleData.schedules || []).forEach((schedule) => {
        const name = String(schedule.department || "").trim();
        if (name) departmentNames.add(name);
      });
      nextQueue.forEach((patient) => {
        const name = String(patient.department || "").trim();
        if (name) departmentNames.add(name);
      });
      const doctorNames = new Set<string>();
      (scheduleData.schedules || []).forEach((schedule) => {
        const name = String(schedule.doctor_name || "").trim();
        if (name) doctorNames.add(name);
      });
      nextQueue.forEach((patient) => {
        const name = String(patient.doctor || "").trim();
        if (name) doctorNames.add(name);
      });
      setDepartmentOptions(Array.from(departmentNames).sort((a, b) => a.localeCompare(b)));
      setDoctorOptions(Array.from(doctorNames).sort((a, b) => a.localeCompare(b)));
      setQueue(nextQueue);
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
    const nextPatient = queue.find((patient) => patient.status === "In Queue") || queue.find((patient) => patient.status === "Yet to Come");
    if (!nextPatient) {
      setNotice({ type: "warning", message: "No waiting patient is currently in the OP queue." });
      return;
    }
    setSelectedToken(nextPatient.token);
    setNotice({ type: "success", message: `Calling next patient: ${nextPatient.name}.` });
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
        const next = current.map((patient) => patient.token === selectedToken ? { ...patient, status } : patient);
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
        const next = current.map((item) => item.token === patient.token ? { ...item, status } : item);
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
      <div className="op-queue-header">
        <div className="op-queue-title-wrap">
          <div className="op-queue-icon">♙</div>
          <div>
            <h2>OP Queue Dashboard</h2>
            <p>One-page overview for live patient queue, doctor assignments, and actions.</p>
          </div>
        </div>
        <div className="op-header-actions">
          <Button type="button" className="purple-action" onClick={callNext}>🔔 Call Next</Button>
          <Button type="button" onClick={() => void loadQueueFromPatients()}>⟳ Refresh</Button>
          <Button type="button" className="green-action" onClick={() => setNotice({ type: "success", message: `Queue Summary: ${counts.total} total, ${counts.inQueue} waiting, ${counts.inConsultation} in consultation, ${counts.completed} completed.` })}>▥ Snapshot</Button>
        </div>
      </div>

      <div className="op-card queue-filters-card">
        <div className="op-filter-grid">
          <label><span className="op-filter-label">Department</span><Select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}><option value="">All departments</option>{departments.map((name) => <option key={name} value={name}>{name}</option>)}</Select></label>
          <label><span className="op-filter-label">Doctor</span><Select value={doctorFilter} onChange={(event) => setDoctorFilter(event.target.value)}><option value="">All doctors</option>{doctors.map((name) => <option key={name} value={name}>{name}</option>)}</Select></label>
          <label><span className="op-filter-label">Visit Date</span><Input type="date" value={visitDateFilter} onChange={(event) => setVisitDateFilter(event.target.value)} /></label>
          <label><span className="op-filter-label">Visit Type</span><Select value={visitTypeFilter} onChange={(event) => setVisitTypeFilter(event.target.value)}><option value="">All</option><option value="OP">OPD</option><option value="IP">IP</option><option value="Emergency">Emergency</option><option value="Readmission">Readmission</option></Select></label>
          <label><span className="op-filter-label">Queue Type</span><Select value={queueTypeFilter} onChange={(event) => setQueueTypeFilter(event.target.value)}><option value="">All</option><option value="walkin">Walk-in / Appointment</option><option value="readmit">Readmission Queue</option></Select></label>
          <label><span className="op-filter-label">Status</span><Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All</option><option value="In Queue">In Queue</option><option value="In Consultation">In Consultation</option><option value="Completed">Completed</option><option value="Yet to Come">Yet to Come</option></Select></label>
          <label className="op-search-label"><span className="op-filter-label">Search</span><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="UHID, name, mobile..." /></label>
        </div>
        <aside className="queue-summary-box">
          <h3>Today's Queue Summary</h3>
          <p><span>◴ Total Tokens</span><strong>{counts.total}</strong></p>
          <p className="green"><span>✓ Completed</span><strong>{counts.completed}</strong></p>
          <p className="orange"><span>⚠ In Queue</span><strong>{counts.inQueue}</strong></p>
          <p className="blue"><span>♙ In Consultation</span><strong>{counts.inConsultation}</strong></p>
          <p className="blue"><span>◷ Yet to Come</span><strong>{counts.yet}</strong></p>
          {opSummary && (
            <>
              <p><span>👨‍⚕️ Available Doctors</span><strong>{opSummary.available_doctors}</strong></p>
              <p><span>🔁 Follow-ups</span><strong>{opSummary.follow_ups}</strong></p>
              <p><span>⏳ Active Queue</span><strong>{opSummary.active_queue}</strong></p>
            </>
          )}
        </aside>
      </div>

      <div className="op-main-grid">
        <div>
          <div className="op-card queue-board-card">
            <div className="queue-board-header-grid">
              <div>
                <h3>OP Queue Board</h3>
                <p>Monitor live queue status across all stages.</p>
              </div>
              <Button type="button" onClick={() => setDetailsModalOpen(true)}>Open Patient Details</Button>
            </div>
            <div className="queue-board">
              <div className="queue-board-column">
                <div className="queue-board-header"><span>In Queue</span><strong>{queueByStatus.inQueue.length}</strong></div>
                {queueByStatus.inQueue.map((patient) => (
                  <button key={patient.token} type="button" className={`queue-board-item ${patient.token === selectedToken ? "selected" : ""}`} onClick={() => setSelectedToken(patient.token)}>
                    <div className="queue-board-item-top"><strong>{patient.token}</strong><span>{patient.visitType}</span></div>
                    <div className="queue-board-item-name">{patient.name}</div>
                    <div className="queue-board-item-meta"><span>{patient.department || "-"}</span><span>{patient.doctor || "-"}</span></div>
                  </button>
                ))}
              </div>
              <div className="queue-board-column">
                <div className="queue-board-header"><span>In Consultation</span><strong>{queueByStatus.inConsultation.length}</strong></div>
                {queueByStatus.inConsultation.map((patient) => (
                  <button key={patient.token} type="button" className={`queue-board-item ${patient.token === selectedToken ? "selected" : ""}`} onClick={() => setSelectedToken(patient.token)}>
                    <div className="queue-board-item-top"><strong>{patient.token}</strong><span>{patient.visitType}</span></div>
                    <div className="queue-board-item-name">{patient.name}</div>
                    <div className="queue-board-item-meta"><span>{patient.department || "-"}</span><span>{patient.doctor || "-"}</span></div>
                  </button>
                ))}
              </div>
              <div className="queue-board-column">
                <div className="queue-board-header"><span>Yet to Come</span><strong>{queueByStatus.yetToCome.length}</strong></div>
                {queueByStatus.yetToCome.map((patient) => (
                  <button key={patient.token} type="button" className={`queue-board-item ${patient.token === selectedToken ? "selected" : ""}`} onClick={() => setSelectedToken(patient.token)}>
                    <div className="queue-board-item-top"><strong>{patient.token}</strong><span>{patient.visitType}</span></div>
                    <div className="queue-board-item-name">{patient.name}</div>
                    <div className="queue-board-item-meta"><span>{patient.department || "-"}</span><span>{patient.doctor || "-"}</span></div>
                  </button>
                ))}
              </div>
              <div className="queue-board-column">
                <div className="queue-board-header"><span>Completed</span><strong>{queueByStatus.completed.length}</strong></div>
                {queueByStatus.completed.map((patient) => (
                  <button key={patient.token} type="button" className={`queue-board-item ${patient.token === selectedToken ? "selected" : ""}`} onClick={() => setSelectedToken(patient.token)}>
                    <div className="queue-board-item-top"><strong>{patient.token}</strong><span>{patient.visitType}</span></div>
                    <div className="queue-board-item-name">{patient.name}</div>
                    <div className="queue-board-item-meta"><span>{patient.department || "-"}</span><span>{patient.doctor || "-"}</span></div>
                  </button>
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
                <p>{selectedPatient ? `${selectedPatient.name} — ${selectedPatient.token}` : "Select a patient card to see details."}</p>
              </div>
              <div className="patient-detail-actions">
                <Button type="button" onClick={() => selectedPatient?.uhid && loadPatientDetails(selectedPatient.uhid)}>Load Profile</Button>
                <Button type="button" className="yellow-action" onClick={printSelectedSlip}>Print Slip</Button>
              </div>
            </div>
            <div className="patient-summary-panel">
              <div className="patient-avatar">👤</div>
              <div className="patient-detail-grid">
                <span>Token No.</span><b>{selectedPatient?.token || "-"}</b>
                <span>Visit Type</span><b>{selectedPatient?.visitType || "-"}</b>
                <span>Patient Name</span><b>{selectedPatient?.name || "-"}</b>
                <span>Department</span><b>{selectedPatient?.department || "-"}</b>
                <span>UHID</span><b>{selectedPatient?.uhid || "-"}</b>
                <span>Doctor</span><b>{selectedPatient?.doctor || "-"}</b>
                <span>Age / Gender</span><b>{selectedPatient?.ageGender || "-"}</b>
                <span>Arrived At</span><b>{selectedPatient?.arrivedAt || "-"}</b>
                <span>Mobile</span><b>{selectedPatient?.mobile || "-"}</b>
                <span>Status</span><b className={getStatusBadgeClass(selectedPatient?.status)}>{selectedPatient?.status || "-"}</b>
              </div>
            </div>
            <div className="clinical-panel">
              <h4>Quick Actions</h4>
              <div className="queue-action-grid">
                <button className="queue-action green" type="button" onClick={() => void updateSelectedStatus("In Consultation")}><b>♙ Start Consultation</b><small>Move patient to consultation</small><span>›</span></button>
                <button className="queue-action teal" type="button" onClick={() => void updateSelectedStatus("Completed")}><b>✓ Finish Consultation</b><small>Complete this visit</small><span>›</span></button>
                <button className="queue-action orange" type="button" onClick={() => void updateSelectedStatus("Yet to Come")}><b>◷ Hold Token</b><small>Place token on hold</small><span>›</span></button>
                <button className="queue-action purple" type="button" onClick={transferSelectedToken}><b>⇄ Transfer</b><small>Transfer to another doctor</small><span>›</span></button>
                <button className="queue-action red" type="button" onClick={removeToken}><b>⊗ Remove</b><small>Remove from queue</small><span>›</span></button>
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

      <div className="queue-note">ⓘ <b>Note:</b> Queue is based on token arrival time. Please call patients in order to maintain OP flow.</div>
    </section>
  );
}
