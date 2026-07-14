import { useMemo, useRef, useState } from "react";
import { Button, Card, Input } from "../components/ui";
import { apiFetch } from "../lib/api";
import type { Appointment, DocumentItem, Notice, Patient } from "../types";
import type { Dispatch, SetStateAction } from "react";
import { PRINT_BRAND_HEADER_DATA_URI } from "../lib/printBrand";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

type Invoice = {
  id: number;
  invoice_no?: string;
  patient_id?: string;
  module?: string;
  doctor_name?: string | null;
  clinic_name?: string | null;
  subtotal?: number;
  tax?: number;
  discount?: number;
  total_amount?: number;
  paid_amount?: number;
  advance_amount?: number;
  refunded_amount?: number;
  due_amount?: number;
  payment_status?: string;
  created_at?: string;
};

type Diagnostic = {
  id: number;
  invoice_no?: string | null;
  patient_id?: string | null;
  doctor_name?: string | null;
  test_name?: string;
  amount?: number;
  paid_amount?: number;
  due_amount?: number;
  status?: string;
  order_status?: string;
  created_at?: string;
};

type Admission = {
  id: number;
  admission_date?: string;
  discharge_date?: string | null;
  notes?: string | null;
};

type DischargeSummary = {
  id?: string;
  patient_id?: string;
  patient_name?: string;
  admission_date?: string;
  discharge_date?: string;
  final_diagnosis?: string;
  treatment_summary?: string;
  discharge_medicines?: string;
  follow_up_plan?: string;
  billing_clearance?: string;
  status?: string;
};

type JourneyEvent = {
  date?: string;
  title: string;
  detail: string;
  amount?: number;
};

type JourneyAppointment = Appointment & {
  patient_type?: string | null;
  payment_mode?: string | null;
  operator_name?: string | null;
  chief_complaint?: string | null;
  notes?: string | null;
  consultation_fee?: number | null;
};

const money = (value: unknown) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const compactDate = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const fullName = (patient: Patient | null) => {
  if (!patient) return "-";
  const nameStr = [patient.name, patient.middle_name, patient.last_name].filter(Boolean).join(" ").trim() || patient.patient_id;
  return `${nameStr} (${patient.patient_id})`;
};

const safeText = (value: unknown) => String(value ?? "-")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const printField = (label: string, value: unknown) => `
  <div class="journey-print-field">
    <span>${safeText(label)}</span>
    <strong>${safeText(value === "" || value === null || value === undefined ? "-" : value)}</strong>
  </div>
`;

const printEmptyRow = (columns: number, message: string) => `
  <tr><td colspan="${columns}" class="journey-print-empty">${safeText(message)}</td></tr>
`;

const loadLocalDischargeSummaries = (patientId?: string): DischargeSummary[] => {
  if (!patientId || typeof window === "undefined") return [];
  try {
    const rows = JSON.parse(localStorage.getItem("hospai_discharge-summary") || "[]");
    if (!Array.isArray(rows)) return [];
    return rows.filter((row) => String(row?.patient_id || "") === patientId);
  } catch {
    return [];
  }
};

export default function PatientJourneyPage({ setNotice }: Props) {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [appointments, setAppointments] = useState<JourneyAppointment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [beds, setBeds] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const journeyPrintRef = useRef<HTMLDivElement | null>(null);

  const totals = useMemo(() => {
    const invoiceBilled = invoices.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const invoicePaid = invoices.reduce((sum, row) => sum + Number(row.paid_amount || 0) + Number(row.advance_amount || 0) - Number(row.refunded_amount || 0), 0);
    const invoiceDue = invoices.reduce((sum, row) => sum + Number(row.due_amount || 0), 0);
    const testBilled = diagnostics.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const testPaid = diagnostics.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
    return {
      billed: invoiceBilled + testBilled,
      paid: invoicePaid + testPaid,
      due: invoiceDue + testDue,
      tests: diagnostics.length,
      visits: appointments.length,
    };
  }, [appointments.length, diagnostics, invoices]);

  const selectedAppointment = useMemo(() => {
    return appointments
      .slice()
      .sort((a, b) => (new Date(b.appointment_date || "").getTime() || 0) - (new Date(a.appointment_date || "").getTime() || 0))[0] || null;
  }, [appointments]);

  const timeline = useMemo<JourneyEvent[]>(() => {
    const events: JourneyEvent[] = [];
    if (selectedPatient?.created_at) {
      events.push({ date: selectedPatient.created_at, title: "Patient Registered", detail: `UHID ${selectedPatient.patient_id}` });
    }
    admissions.forEach((admission) => events.push({ date: admission.admission_date, title: "Admission / Registration Visit", detail: admission.notes || "Initial registration / admission" }));
    appointments.forEach((appointment) => events.push({ date: appointment.appointment_date, title: `${appointment.visit_type || "OP"} Appointment`, detail: `${appointment.department || "Department"} • ${appointment.doctor_name || "Doctor not assigned"} • ${appointment.status}` }));
    diagnostics.forEach((test) => events.push({ date: test.created_at, title: `Lab/Test: ${test.test_name || "Diagnostic test"}`, detail: `Paid ${money(test.paid_amount)} • Due ${money(test.due_amount)} • ${test.status || "status pending"}`, amount: Number(test.amount || 0) }));
    invoices.forEach((invoice) => events.push({ date: invoice.created_at, title: `Invoice ${invoice.invoice_no || invoice.id}`, detail: `${invoice.module || "Billing"} • Paid ${money(invoice.paid_amount)} • Due ${money(invoice.due_amount)} • ${invoice.payment_status || "status pending"}`, amount: Number(invoice.total_amount || 0) }));
    documents.forEach((document) => events.push({ date: document.created_at, title: `Document Uploaded`, detail: `${document.doc_type || "Document"}${document.file_name ? ` • ${document.file_name}` : ""}` }));
    beds.forEach((bed) => {
      if (bed.allocated_at) {
        events.push({
          date: bed.allocated_at,
          title: `Bed Allocated (${bed.ward})`,
          detail: `Room: ${bed.room_no}, Bed: ${bed.bed_no} | Rent: ₹${bed.amount_per_day}/day`,
          amount: Number(bed.total_amount || 0)
        });
      }
      if (bed.released_at) {
        events.push({
          date: bed.released_at,
          title: `Bed Released (${bed.ward})`,
          detail: `Room: ${bed.room_no}, Bed: ${bed.bed_no} | Total Rent: ₹${bed.total_amount} (${bed.total_days} days)`,
        });
      }
    });
    return events.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  }, [admissions, appointments, diagnostics, documents, invoices, beds, selectedPatient]);

  const dischargeSummaries = useMemo(() => loadLocalDischargeSummaries(selectedPatient?.patient_id), [selectedPatient]);
  const latestDischargeSummary = dischargeSummaries[0] || null;

  const searchPatients = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setNotice({ type: "warning", message: "Enter UHID, mobile number, Aadhaar, or patient name." });
      return;
    }
    setSearching(true);
    try {
      const data = await apiFetch<{ patients?: Patient[] }>(`/api/patients?q=${encodeURIComponent(trimmed)}`);
      const matches = data.patients || [];
      setPatients(matches);
      if (matches.length === 1) {
        await loadJourney(matches[0]);
      }
      if (!matches.length) {
        setSelectedPatient(null);
        setNotice({ type: "warning", message: "No patient found for this search." });
      }
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Unable to search patients." });
    } finally {
      setSearching(false);
    }
  };

  const loadJourney = async (patient: Patient) => {
    setSelectedPatient(patient);
    setLoading(true);
    try {
      const patientId = patient.patient_id;
      const [appointmentData, invoiceData, diagnosticData, documentData, admissionData, bedsData] = await Promise.all([
        apiFetch<{ appointments?: JourneyAppointment[] }>("/api/appointments"),
        apiFetch<{ invoices?: Invoice[] }>(`/api/billing/invoices?patient_id=${encodeURIComponent(patientId)}`),
        apiFetch<{ diagnostics?: Diagnostic[] }>(`/api/lab/diagnostics?patient_id=${encodeURIComponent(patientId)}`),
        apiFetch<{ documents?: DocumentItem[] }>(`/api/patients/${encodeURIComponent(patientId)}/documents`),
        apiFetch<{ admissions?: Admission[] }>(`/api/patients/${encodeURIComponent(patientId)}/admissions`),
        apiFetch<{ history?: any[] }>(`/api/bed/history?patient_id=${encodeURIComponent(patientId)}`),
      ]);
      setAppointments((appointmentData.appointments || []).filter((row) => row.patient_id === patientId));
      setInvoices(invoiceData.invoices || []);
      setDiagnostics(diagnosticData.diagnostics || []);
      setDocuments(documentData.documents || []);
      setAdmissions(admissionData.admissions || []);
      setBeds(bedsData.history || []);
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Unable to load patient journey." });
    } finally {
      setLoading(false);
    }
  };

  const printSelectedJourney = () => {
    if (!selectedPatient || !journeyPrintRef.current) {
      setNotice({ type: "warning", message: "Search and select a patient before printing journey." });
      return;
    }

    const patientName = [selectedPatient.name, selectedPatient.middle_name, selectedPatient.last_name].filter(Boolean).join(" ").trim() || selectedPatient.patient_id;
    const printedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    const sortedAppointments = appointments
      .slice()
      .sort((a, b) => (new Date(b.appointment_date || "").getTime() || 0) - (new Date(a.appointment_date || "").getTime() || 0));
    const appointmentRows = sortedAppointments.length
      ? sortedAppointments.map((appointment) => `
          <tr>
            <td>${safeText(compactDate(appointment.appointment_date))}</td>
            <td>${safeText(appointment.visit_type || "-")}</td>
            <td>${safeText(appointment.appointment_kind || "-")}</td>
            <td>${safeText(appointment.department || "-")}</td>
            <td>${safeText(appointment.doctor_name || "-")}</td>
            <td>${safeText(appointment.consultation_fee ? money(appointment.consultation_fee) : "-")}</td>
            <td>${safeText(appointment.payment_mode || "-")}</td>
            <td>${safeText(appointment.operator_name || "-")}</td>
            <td>${safeText(appointment.chief_complaint || appointment.notes || "-")}</td>
          </tr>
        `).join("")
      : printEmptyRow(9, "No appointment records found for this patient.");

    const latestAppointment = sortedAppointments[0] || null;
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>${selectedPatient.patient_id} Patient Journey</title>
          <style>
            @page { size: A4; margin: 12mm; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              background: #ffffff;
              color: #111827;
              font-family: Arial, Helvetica, sans-serif;
              font-size: 11px;
            }
            .journey-print-sheet {
              width: 100%;
              min-height: 100vh;
              padding: 0;
            }
            .journey-print-header {
              display: grid;
              grid-template-columns: 58px 1fr 220px;
              align-items: start;
              gap: 14px;
              padding: 12px 14px 10px;
              background: #eef7ff;
              border-bottom: 2px solid #111827;
              margin-bottom: 14px;
            }
            .journey-print-logo { width: 56px; height: 56px; object-fit: contain; display: block; }
            .journey-print-brand-title { margin: 0 0 3px; font-size: 17px; font-weight: 800; color: #062f56; line-height: 1.1; }
            .journey-print-brand-line { margin: 1px 0; font-size: 10px; font-weight: 700; color: #062f56; line-height: 1.25; }
            .journey-print-title { text-align: right; color: #111827; }
            .journey-print-title h1 { margin: 0 0 5px; font-size: 16px; text-decoration: underline; color: #062f56; line-height: 1.2; }
            .journey-print-title p { margin: 2px 0; color: #475569; font-size: 10px; }
            .journey-print-section {
              border: 1px solid #111827;
              border-bottom: 0;
            }
            .journey-print-section:last-child {
              border-bottom: 1px solid #111827;
            }
            .journey-print-section h2 {
              margin: 0;
              padding: 6px 8px;
              border-bottom: 1px solid #111827;
              background: #eef7fb;
              color: #062f56;
              font-size: 12px;
              letter-spacing: 0.02em;
              text-transform: uppercase;
            }
            .journey-print-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            .journey-print-grid.three {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }
            .journey-print-field {
              min-height: 32px;
              padding: 6px 8px;
              border-right: 1px solid #111827;
              border-bottom: 1px solid #111827;
            }
            .journey-print-field:nth-child(2n) {
              border-right: 0;
            }
            .journey-print-grid.three .journey-print-field:nth-child(2n) {
              border-right: 1px solid #111827;
            }
            .journey-print-grid.three .journey-print-field:nth-child(3n) {
              border-right: 0;
            }
            .journey-print-field span {
              display: block;
              margin-bottom: 3px;
              color: #334155;
              font-size: 9px;
              font-weight: 700;
              text-transform: uppercase;
            }
            .journey-print-field strong {
              display: block;
              min-height: 12px;
              color: #111827;
              font-size: 11px;
            }
            .journey-print-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
            }
            .journey-print-table th,
            .journey-print-table td {
              padding: 6px 7px;
              border-right: 1px solid #111827;
              border-bottom: 1px solid #111827;
              text-align: left;
              vertical-align: top;
            }
            .journey-print-table th:last-child,
            .journey-print-table td:last-child {
              border-right: 0;
            }
            .journey-print-table th {
              background: #f2f8fb;
              color: #062f56;
              font-size: 9px;
              letter-spacing: 0.05em;
              text-transform: uppercase;
            }
            .journey-print-notes {
              padding: 8px;
              border-bottom: 1px solid #111827;
            }
            .journey-print-notes strong {
              display: block;
              margin: 0 0 3px;
              color: #062f56;
              font-size: 9px;
              letter-spacing: 0.05em;
              text-transform: uppercase;
            }
            .journey-print-notes p {
              margin: 0 0 8px;
              white-space: pre-wrap;
            }
          </style>
        </head>
        <body>
          <main class="journey-print-sheet">
            <header class="journey-print-header">
              <img class="journey-print-logo" src="${PRINT_BRAND_HEADER_DATA_URI}" alt="VERARA Polyclinic, Pharmacy, Diagnostics" />
              <div>
                <p class="journey-print-brand-title">VERARA</p>
                <p class="journey-print-brand-line">POLYCLINIC, PHARMACY,</p>
                <p class="journey-print-brand-line">DIAGNOSTICS</p>
              </div>
              <div class="journey-print-title">
                <h1>Patient Registration Summary</h1>
                <p><strong>UHID:</strong> ${safeText(selectedPatient.patient_id)}</p>
                <p><strong>Printed:</strong> ${safeText(printedAt)}</p>
              </div>
            </header>

            <section class="journey-print-section">
              <h2>Patient Information</h2>
              <div class="journey-print-grid three">
                ${printField("Patient Name", patientName)}
                ${printField("UHID / Patient ID", selectedPatient.patient_id)}
                ${printField("Date of Birth", selectedPatient.dob || "-")}
                ${printField("Age", selectedPatient.age || "-")}
                ${printField("Gender", selectedPatient.gender || "-")}
                ${printField("Marital Status", selectedPatient.marital_status || "-")}
                ${printField("Mobile", selectedPatient.phone || "-")}
                ${printField("Family Mobile", selectedPatient.family_mobile || "-")}
                ${printField("Address", selectedPatient.address || "-")}
              </div>
            </section>

            <section class="journey-print-section">
              <h2>Appointment Scheduling</h2>
              <div class="journey-print-grid three">
                ${printField("Appointment Date / Time", latestAppointment ? compactDate(latestAppointment.appointment_date) : "-")}
                ${printField("Visit Type", latestAppointment?.visit_type || "-")}
                ${printField("Appointment Kind", latestAppointment?.appointment_kind || "-")}
                ${printField("Department", latestAppointment?.department || "-")}
                ${printField("Doctor", latestAppointment?.doctor_name || "-")}
                ${printField("Patient Type", latestAppointment?.patient_type || "-")}
                ${printField("Consultation Fee", latestAppointment?.consultation_fee ? money(latestAppointment.consultation_fee) : "-")}
                ${printField("Payment Mode", latestAppointment?.payment_mode || "-")}
                ${printField("Operator", latestAppointment?.operator_name || "-")}
              </div>
              <div class="journey-print-notes">
                <strong>Chief Complaint</strong>
                <p>${safeText(latestAppointment?.chief_complaint || selectedPatient.symptoms || "-")}</p>
                <strong>Notes</strong>
                <p>${safeText(latestAppointment?.notes || "-")}</p>
              </div>
              <table class="journey-print-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Visit</th>
                    <th>Kind</th>
                    <th>Department</th>
                    <th>Doctor</th>
                    <th>Fee</th>
                    <th>Payment</th>
                    <th>Operator</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>${appointmentRows}</tbody>
              </table>
            </section>
          </main>
        </body>
      </html>
    `;
    // --- Blob URL iframe print (no popup blocker issues, logo renders correctly) ---
    const existing = document.getElementById("__hospai_journey_print_frame__");
    if (existing) existing.remove();
    const iframe = document.createElement("iframe");
    iframe.id = "__hospai_journey_print_frame__";
    iframe.setAttribute("style", "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;");
    document.body.appendChild(iframe);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } finally {
          setTimeout(() => {
            try { iframe.remove(); URL.revokeObjectURL(blobUrl); } catch { /* ok */ }
          }, 3000);
        }
      }, 300);
    };
    iframe.src = blobUrl;
  };

  return (
    <section className="module-page patient-journey-page">
      <div className="module-panel-head">
        <div>
          <h3>Patient Journey</h3>
          <p className="muted">Search one patient and view registration plus appointment scheduling details only.</p>
        </div>
        <Button type="button" variant="secondary" onClick={printSelectedJourney} disabled={!selectedPatient}>
          Print Summary
        </Button>
      </div>

      <Card className="journey-search-card">
        <h4>Patient Lookup</h4>
        <p className="muted">Search by UHID / Patient ID, mobile number, Aadhaar number, or patient name.</p>
        <div className="journey-search-row">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g., PAT-20260608-1001 / mobile / name" onKeyDown={(event) => { if (event.key === "Enter") void searchPatients(); }} />
          <Button type="button" variant="primary" onClick={() => void searchPatients()} disabled={searching}>{searching ? "Searching..." : "Search Patient"}</Button>
        </div>
        {patients.length > 1 && (
          <div className="journey-patient-results">
            {patients.slice(0, 8).map((patient) => (
              <button key={patient.patient_id} type="button" onClick={() => void loadJourney(patient)} className="journey-patient-result">
                <strong>{fullName(patient)}</strong>
                <span>{patient.patient_id} • {patient.phone || "No mobile"} • {patient.gender || "-"}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {selectedPatient && (
        <div ref={journeyPrintRef} className="patient-journey-print-area">
          <Card>
            <div className="module-panel-head">
              <div>
                <h4>{fullName(selectedPatient)}</h4>
                <p className="muted">Patient registration details for UHID {selectedPatient.patient_id}.</p>
              </div>
            </div>
            <div className="journey-detail-grid">
              <div><strong>Patient ID</strong><span>{selectedPatient.patient_id}</span></div>
              <div><strong>Name</strong><span>{fullName(selectedPatient)}</span></div>
              <div><strong>Date of Birth</strong><span>{selectedPatient.dob || "-"}</span></div>
              <div><strong>Age</strong><span>{selectedPatient.age || "-"}</span></div>
              <div><strong>Gender</strong><span>{selectedPatient.gender || "-"}</span></div>
              <div><strong>Marital Status</strong><span>{selectedPatient.marital_status || "-"}</span></div>
              <div><strong>Mobile</strong><span>{selectedPatient.phone || "-"}</span></div>
              <div><strong>Family Mobile</strong><span>{selectedPatient.family_mobile || "-"}</span></div>
              <div><strong>Address</strong><span>{selectedPatient.address || "-"}</span></div>
              <div><strong>Vitals</strong><span>{`${selectedPatient.height ? `${selectedPatient.height} cm` : "-"}${selectedPatient.height && selectedPatient.weight ? " / " : ""}${selectedPatient.weight ? `${selectedPatient.weight} kg` : ""}`}</span></div>
            </div>
          </Card>

          <Card>
            <div className="module-panel-head">
              <div>
                <h4>Appointment Scheduling</h4>
                <p className="muted">Latest appointment information and appointment history.</p>
              </div>
            </div>
            {selectedAppointment ? (
              <>
                <div className="journey-detail-grid">
                  <div><strong>Appointment Date / Time</strong><span>{compactDate(selectedAppointment.appointment_date)}</span></div>
                  <div><strong>Visit Type</strong><span>{selectedAppointment.visit_type || "-"}</span></div>
                  <div><strong>Appointment Kind</strong><span>{selectedAppointment.appointment_kind || "-"}</span></div>
                  <div><strong>Department</strong><span>{selectedAppointment.department || "-"}</span></div>
                  <div><strong>Doctor</strong><span>{selectedAppointment.doctor_name || "-"}</span></div>
                  <div><strong>Patient Type</strong><span>{selectedAppointment.patient_type || "-"}</span></div>
                  <div><strong>Consultation Fee</strong><span>{selectedAppointment.consultation_fee ? money(selectedAppointment.consultation_fee) : "-"}</span></div>
                  <div><strong>Payment Mode</strong><span>{selectedAppointment.payment_mode || "-"}</span></div>
                  <div><strong>Operator</strong><span>{selectedAppointment.operator_name || "-"}</span></div>
                  <div><strong>Notes</strong><span>{selectedAppointment.notes || "-"}</span></div>
                  <div><strong>Chief Complaint</strong><span>{selectedAppointment.chief_complaint || selectedPatient.symptoms || "-"}</span></div>
                </div>
                {appointments.length > 1 && (
                  <div className="module-table">
                    <table className="appointment-summary-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Visit</th>
                          <th>Kind</th>
                          <th>Department</th>
                          <th>Doctor</th>
                          <th>Fee</th>
                          <th>Payment</th>
                          <th>Operator</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {appointments.map((appointment) => (
                          <tr key={`${appointment.id}-${appointment.appointment_date}`}>
                            <td>{compactDate(appointment.appointment_date)}</td>
                            <td>{appointment.visit_type || "-"}</td>
                            <td>{appointment.appointment_kind || "-"}</td>
                            <td>{appointment.department || "-"}</td>
                            <td>{appointment.doctor_name || "-"}</td>
                            <td>{appointment.consultation_fee ? money(appointment.consultation_fee) : "-"}</td>
                            <td>{appointment.payment_mode || "-"}</td>
                            <td>{appointment.operator_name || "-"}</td>
                            <td>{appointment.chief_complaint || appointment.notes || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <p className="muted">No appointment scheduling information available for this patient.</p>
            )}
          </Card>
        </div>
      )}
    </section>
  );
}
