import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button, Input, Label, Select, Textarea } from "../components/ui";
import type { Notice } from "../types";
import { fullPatientName, lookupPatientByUhid, normalizeUhidLookup } from "../lib/patientLookup";
import { API_BASE } from "../lib/constants";
import { getAuthHeaders, getHospitalCode } from "../lib/api";

type Props = { setNotice: Dispatch<SetStateAction<Notice | null>>; view: "prescription" | "ip-admission" | "nurse-station" | "discharge-summary" };

type Row = Record<string, string> & { id: string };

const today = new Date().toISOString().slice(0, 10);

const titles = {
  prescription: ["Doctor Prescription", "Create branded prescriptions with medicines, lab tests, advice, and follow-up."],
  "ip-admission": ["IP Admission", "Manage admission, ward/room/bed allocation, admission notes, and deposits."],
  "nurse-station": ["Nurse Station", "Track vitals, medication administration, shift notes, and nursing tasks."],
  "discharge-summary": ["Discharge Summary", "Prepare final diagnosis, hospital course, medicines, follow-up, and printable discharge summary."],
};

const DEFAULTS = {
  prescription: {
    patient_id: "", patient_name: "", doctor_name: "", department: "", diagnosis: "", medicines: "", lab_tests: "", advice: "", follow_up_date: "", status: "",
  },
  "ip-admission": {
    patient_id: "", patient_name: "", admission_type: "", ward: "", room_no: "", bed_no: "", consultant: "", diagnosis: "", deposit_amount: "", insurance_status: "", status: "",
  },
  "nurse-station": {
    patient_id: "", patient_name: "", bp: "", temperature: "", pulse: "", spo2: "", medicine_given: "", shift: "", nurse_name: "", notes: "",
  },
  "discharge-summary": {
    patient_id: "", patient_name: "", admission_date: "", discharge_date: "", final_diagnosis: "", treatment_summary: "", discharge_medicines: "", follow_up_plan: "", billing_clearance: "", status: "",
  },
};

function saveLocal(key: string, row: Row) {
  const rows = JSON.parse(localStorage.getItem(key) || "[]") as Row[];
  localStorage.setItem(key, JSON.stringify([row, ...rows].slice(0, 25)));
}
function loadLocal(key: string) { return JSON.parse(localStorage.getItem(key) || "[]") as Row[]; }

export default function PatientWorkflowPage({ setNotice, view }: Props) {
  const [form, setForm] = useState<Record<string, string>>({ ...DEFAULTS[view] });
  const [savedRows, setSavedRows] = useState<Row[]>(() => loadLocal(`hospai_${view}`));
  const [title, subtitle] = titles[view];
  const amount = useMemo(() => Number(form.deposit_amount || 0), [form.deposit_amount]);
  const [lookingUpPatient, setLookingUpPatient] = useState(false);

  const update = (name: string, value: string) => setForm((prev) => ({ ...prev, [name]: value }));
  const fillPatientFromUhid = async (value: string) => {
    const lookup = normalizeUhidLookup(value);
    if (!lookup) return;
    setLookingUpPatient(true);
    try {
      const patient = await lookupPatientByUhid(lookup);
      if (!patient) {
        setNotice({ type: "warning", message: "No patient found for that UHID / last 4 digits." });
        return;
      }
      setForm((prev) => ({ ...prev, patient_id: patient.patient_id, patient_name: fullPatientName(patient) || patient.patient_id }));
      setNotice({ type: "success", message: `Patient auto-filled: ${fullPatientName(patient) || patient.patient_id}.` });
    } catch {
      setNotice({ type: "error", message: "Unable to auto-fill patient details." });
    } finally {
      setLookingUpPatient(false);
    }
  };
  const save = () => {
    if (!form.patient_name.trim()) { setNotice({ type: "warning", message: "Patient name is required." }); return; }
    const row = { id: `${Date.now()}`, ...form };
    saveLocal(`hospai_${view}`, row);
    setSavedRows(loadLocal(`hospai_${view}`));
    setNotice({ type: "success", message: `${title} saved successfully.` });
  };
  const buildPdfMarkdown = () => {
    if (view === "prescription") {
      return [
        "## Patient Details",
        `Patient ID: ${form.patient_id || "-"}`,
        `Patient Name: ${form.patient_name || "-"}`,
        `Doctor: ${form.doctor_name || "-"}`,
        `Department: ${form.department || "-"}`,
        "## Clinical Notes",
        form.diagnosis || "-",
        "## Medicines",
        form.medicines || "-",
        "## Investigations / Lab Tests",
        form.lab_tests || "-",
        "## Advice",
        form.advice || "-",
        "## Follow-up",
        `Follow-up Date: ${form.follow_up_date || "-"}`,
      ].join("\n");
    }
    if (view === "discharge-summary") {
      return [
        "## Patient Information",
        `Patient ID: ${form.patient_id || "-"}`,
        `Patient Name: ${form.patient_name || "-"}`,
        `Admission Date: ${form.admission_date || "-"}`,
        `Discharge Date: ${form.discharge_date || "-"}`,
        `Discharge Status: ${form.status || "-"}`,
        `Billing Clearance: ${form.billing_clearance || "-"}`,
        "## Final Diagnosis",
        form.final_diagnosis || "-",
        "## Treatment Summary",
        form.treatment_summary || "-",
        "## Discharge Medications",
        form.discharge_medicines || "-",
        "## Follow-up Instructions",
        form.follow_up_plan || "-",
      ].join("\n");
    }
    return Object.entries(form).map(([key, value]) => `${key.replace(/_/g, " ")}: ${value || "-"}`).join("\n");
  };
  const downloadPdf = async () => {
    if (!form.patient_name.trim()) {
      setNotice({ type: "warning", message: "Patient name is required before PDF download." });
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/export/pdf`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Hospital-Code": getHospitalCode(), ...getAuthHeaders() },
        body: JSON.stringify({
          patient_name: form.patient_name || form.patient_id || "Patient",
          doc_type: view,
          ocr_text: buildPdfMarkdown(),
        }),
      });
      if (!response.ok) throw new Error("Unable to generate PDF.");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${form.patient_id || view}-${view}.pdf`;
      link.click();
      window.URL.revokeObjectURL(url);
      setNotice({ type: "success", message: `${title} PDF downloaded.` });
    } catch {
      setNotice({ type: "error", message: "Unable to generate PDF download." });
    }
  };

  return (
    <section className="module-page">
      <div className="module-panel-head"><h3>{title}</h3><p className="muted">{subtitle}</p></div>
      <div className="panel registration-desk-panel">
        <div className="grid-form patient-grid-form">
          <Label>UHID / Last 4 Digits<Input value={form.patient_id || ""} onChange={(e) => update("patient_id", e.target.value)} onBlur={(e) => void fillPatientFromUhid(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void fillPatientFromUhid((e.currentTarget as HTMLInputElement).value); } }} placeholder="Enter 1001 or PAT-YYYYMMDD-1001" /></Label>
          <Label>Patient Name<Input value={form.patient_name || ""} onChange={(e) => update("patient_name", e.target.value)} placeholder="Patient name" /></Label>
          {view === "prescription" && (<>
            <Label>Doctor<Input value={form.doctor_name} onChange={(e) => update("doctor_name", e.target.value)} placeholder="Doctor name" /></Label>
            <Label>Department<Select value={form.department} onChange={(e) => update("department", e.target.value)}><option>General Medicine</option><option>Cardiology</option><option>Pediatrics</option><option>Gynecology</option><option>Orthopedics</option><option>Emergency</option></Select></Label>
            <Label className="span-2">Diagnosis<Textarea value={form.diagnosis} onChange={(e) => update("diagnosis", e.target.value)} placeholder="Diagnosis / clinical impression" /></Label>
            <Label className="span-2">Medicines<Textarea value={form.medicines} onChange={(e) => update("medicines", e.target.value)} /></Label>
            <Label>Lab Tests<Input value={form.lab_tests} onChange={(e) => update("lab_tests", e.target.value)} /></Label>
            <Label>Follow-up Date<Input type="date" value={form.follow_up_date} onChange={(e) => update("follow_up_date", e.target.value)} /></Label>
            <Label className="span-2">Advice<Textarea value={form.advice} onChange={(e) => update("advice", e.target.value)} /></Label>
          </>)}
          {view === "ip-admission" && (<>
            <Label>Admission Type<Select value={form.admission_type} onChange={(e) => update("admission_type", e.target.value)}><option value="planned">Planned</option><option value="emergency">Emergency</option><option value="transfer">Transfer</option></Select></Label>
            <Label>Consultant<Input value={form.consultant} onChange={(e) => update("consultant", e.target.value)} placeholder="Consultant name" /></Label>
            <Label>Ward<Select value={form.ward} onChange={(e) => update("ward", e.target.value)}><option value="">Select ward</option><option value="General Ward">General Ward</option><option value="Semi Private">Semi Private</option><option value="Private Room">Private Room</option><option value="ICU">ICU</option><option value="NICU">NICU</option></Select></Label>
            <Label>Room No<Input value={form.room_no} onChange={(e) => update("room_no", e.target.value)} placeholder="Room number" /></Label>
            <Label>Bed No<Input value={form.bed_no} onChange={(e) => update("bed_no", e.target.value)} placeholder="Bed number" /></Label>
            <Label>Deposit Amount<Input type="number" value={form.deposit_amount} onChange={(e) => update("deposit_amount", e.target.value)} placeholder="0" /></Label>
            <Label>Insurance Status<Select value={form.insurance_status} onChange={(e) => update("insurance_status", e.target.value)}><option value="not_required">Not Required</option><option value="pending">Pending</option><option value="approved">Approved</option></Select></Label>
            <Label className="span-2">Diagnosis / Admission Notes<Textarea value={form.diagnosis} onChange={(e) => update("diagnosis", e.target.value)} placeholder="Diagnosis / admission notes" /></Label>
          </>)}
          {view === "nurse-station" && (<>
            <Label>BP<Input value={form.bp} onChange={(e) => update("bp", e.target.value)} placeholder="e.g., 120/80" /></Label><Label>Temperature<Input value={form.temperature} onChange={(e) => update("temperature", e.target.value)} placeholder="e.g., 98.6" /></Label><Label>Pulse<Input value={form.pulse} onChange={(e) => update("pulse", e.target.value)} placeholder="e.g., 72" /></Label><Label>SPO2<Input value={form.spo2} onChange={(e) => update("spo2", e.target.value)} placeholder="e.g., 98" /></Label>
            <Label>Medicine Given<Input value={form.medicine_given} onChange={(e) => update("medicine_given", e.target.value)} placeholder="Medicine given" /></Label><Label>Shift<Select value={form.shift} onChange={(e) => update("shift", e.target.value)}><option value="morning">Morning</option><option value="evening">Evening</option><option value="night">Night</option></Select></Label>
            <Label>Nurse Name<Input value={form.nurse_name} onChange={(e) => update("nurse_name", e.target.value)} placeholder="Nurse name" /></Label><Label className="span-2">Shift Notes<Textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Shift notes" /></Label>
          </>)}
          {view === "discharge-summary" && (<>
            <Label>Admission Date<Input type="date" value={form.admission_date} onChange={(e) => update("admission_date", e.target.value)} /></Label><Label>Discharge Date<Input type="date" value={form.discharge_date} onChange={(e) => update("discharge_date", e.target.value)} /></Label>
            <Label>Billing Clearance<Select value={form.billing_clearance} onChange={(e) => update("billing_clearance", e.target.value)}><option value="pending">Pending</option><option value="cleared">Cleared</option></Select></Label><Label>Status<Select value={form.status} onChange={(e) => update("status", e.target.value)}><option value="draft">Draft</option><option value="final">Final</option></Select></Label>
            <Label className="span-2">Final Diagnosis<Textarea value={form.final_diagnosis} onChange={(e) => update("final_diagnosis", e.target.value)} /></Label><Label className="span-2">Treatment Summary<Textarea value={form.treatment_summary} onChange={(e) => update("treatment_summary", e.target.value)} /></Label>
            <Label className="span-2">Discharge Medicines<Textarea value={form.discharge_medicines} onChange={(e) => update("discharge_medicines", e.target.value)} placeholder="Discharge medicines" /></Label><Label className="span-2">Follow-up Plan<Textarea value={form.follow_up_plan} onChange={(e) => update("follow_up_plan", e.target.value)} placeholder="Follow-up plan" /></Label>
          </>)}
        </div>
        {lookingUpPatient && <p className="muted">Auto-filling patient details...</p>}
        {view === "ip-admission" && <p className="muted">Deposit preview: ₹{amount.toLocaleString("en-IN")}</p>}
        <div className="form-actions"><Button type="button" variant="secondary" onClick={save}>Save</Button><Button type="button" variant="ghost" onClick={() => (view === "prescription" || view === "discharge-summary" ? void downloadPdf() : window.print())}>{view === "prescription" || view === "discharge-summary" ? "Download PDF" : "Print"}</Button></div>
      </div>
      <div className="panel registration-desk-panel"><h4>Recent Records</h4>{savedRows.length === 0 ? <p className="muted">No records saved yet.</p> : savedRows.map((row) => <p key={row.id} className="muted"><strong>{row.patient_name}</strong> · {row.patient_id || "No UHID"} · {row.status || row.shift || row.billing_clearance || "saved"}</p>)}</div>
    </section>
  );
}
