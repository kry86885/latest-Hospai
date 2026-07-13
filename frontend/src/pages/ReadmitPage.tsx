import { Fragment, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import DocumentUploadDropzone from "../components/DocumentUploadDropzone";
import MarkdownReport from "../components/MarkdownReport";
import { Button, Checkbox, Input, Label, Select, Table, TableCell, TableHead, TableRow, Textarea } from "../components/ui";
import { API_BASE, DOC_TYPES, SUPPORTED_DOCUMENT_ACCEPT, SUPPORTED_DOCUMENT_EXTENSIONS, isSupportedDocumentFile } from "../lib/constants";
import { apiFetch, reportError } from "../lib/api";
import { formatDateTimeIST, getISTDateTimeKey, getTimestamp, stripUploadTimestampPrefix } from "../lib/format";
import type { DocumentItem, Notice, Patient } from "../types";

type ProfileUpdates = {
  age: number | string;
  weight: number | string;
  height: number | string;
  phone: string;
  symptoms: string;
  gender: string;
  pregnant: boolean;
};

type Props = {
  onSelect: (patient: Patient) => void;
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  onReadmitComplete?: (patientId?: string) => Promise<void>;
  ocrLanguage: string;
};

type OcrResultMap = Record<string, { text?: string; file?: File }>;

const IMAGE_NAME_PATTERN = /\.(png|jpe?g|webp|bmp|gif|tiff?|heic|heif)$/i;
const ACTIVE_READMIT_STATUSES = new Set(["In Queue", "In Consultation", "Yet to Come"]);

function getStoredReadmitQueue() {
  try {
    const storedQueue = JSON.parse(localStorage.getItem("hospai_op_queue") || "[]");
    return Array.isArray(storedQueue) ? storedQueue : [];
  } catch {
    return [];
  }
}

function getActiveReadmitEntry(patientId?: string) {
  if (!patientId) return null;
  return getStoredReadmitQueue().find((item) => item?.uhid === patientId && ACTIVE_READMIT_STATUSES.has(String(item?.status || ""))) || null;
}

function OriginalDocumentPreview({ file }: { file?: File }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!file || !url) {
    return <p className="muted">No source document available.</p>;
  }

  const mime = (file.type || "").toLowerCase();
  const isPdf = mime === "application/pdf" || /\.pdf$/i.test(file.name);
  const isImage = mime.startsWith("image/") || IMAGE_NAME_PATTERN.test(file.name);

  if (isImage) {
    return <img className="ocr-source-image" src={url} alt={file.name} />;
  }

  if (isPdf) {
    return <iframe className="ocr-source-pdf" src={url} title={`Preview ${file.name}`} />;
  }

  return (
    <a className="link" href={url} target="_blank" rel="noreferrer">
      Open original document
    </a>
  );
}

export default function ReadmitPage({ onSelect, setNotice, onReadmitComplete, ocrLanguage }: Props) {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [activePatient, setActivePatient] = useState<Patient | null>(null);
  const [notes, setNotes] = useState("");
  const [profileUpdates, setProfileUpdates] = useState<ProfileUpdates>({
    age: "",
    weight: "",
    height: "",
    phone: "",
    symptoms: "",
    gender: "",
    pregnant: false,
  });
  const [doctorName, setDoctorName] = useState("");
  const [doctorDepartment, setDoctorDepartment] = useState("");
  const [reviewFee, setReviewFee] = useState("");
  const [doctorOptions, setDoctorOptions] = useState<{ doctor_name?: string; department?: string }[]>([]);
  const [docFiles, setDocFiles] = useState<Record<string, File>>({});
  const [ocrResults, setOcrResults] = useState<OcrResultMap>({});
  const [ocrStatus, setOcrStatus] = useState<Record<string, string>>({});
  const [previousDocuments, setPreviousDocuments] = useState<DocumentItem[]>([]);
  const [previousDocumentsLoading, setPreviousDocumentsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const normalizeProfile = (patient: Patient): ProfileUpdates => ({
    age: patient?.age ?? "",
    weight: patient?.weight ?? "",
    height: patient?.height ?? "",
    phone: patient?.phone || "",
    symptoms: patient?.symptoms || "",
    gender: patient?.gender || "Female",
    pregnant: patient?.pregnant === 1 || patient?.pregnant === true,
  });

  useEffect(() => {
    const loadPatients = async () => {
      try {
        const data = await apiFetch<{ patients?: Patient[] }>("/api/patients");
        setPatients(data.patients || []);
      } catch (error) {
        reportError(setNotice, error as { message?: string; status?: number }, "Unable to load patients.");
      }
    };
    const loadDoctorSchedules = async () => {
      try {
        const data = await apiFetch<{ schedules?: { doctor_name?: string | null; department?: string | null }[] }>('/api/op/doctor-schedules');
        setDoctorOptions(data.schedules || []);
      } catch {
        setDoctorOptions([]);
      }
    };
    void loadPatients();
    void loadDoctorSchedules();
  }, [setNotice]);

  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, " ");
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const queryDigits = normalizedQuery.replace(/\D/g, "");
  const results = normalizedQuery
    ? patients.filter((patient) => {
        const fullName = [patient.name, patient.middle_name, patient.last_name].filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, " ").trim();
        const nameWithoutMiddle = [patient.name, patient.last_name].filter(Boolean).join(" ").toLowerCase().replace(/\s+/g, " ").trim();
        const fields = [
          fullName,
          nameWithoutMiddle,
          patient.name,
          patient.middle_name,
          patient.last_name,
          patient.patient_id,
          patient.phone,
          patient.family_mobile,
          patient.emergency_contact,
        ]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase().replace(/\s+/g, " ").trim());
        const textHaystack = fields.join(" | ");
        const digitHaystack = fields.map((value) => value.replace(/\D/g, "")).join(" | ");
        return (
          textHaystack.includes(normalizedQuery) ||
          (queryTokens.length > 0 && queryTokens.every((token) => textHaystack.includes(token))) ||
          (queryDigits.length > 0 && digitHaystack.includes(queryDigits))
        );
      })
    : patients;

  const previousDocumentGroups = useMemo(() => {
    const sorted = [...previousDocuments].sort((a, b) => getTimestamp(b.created_at) - getTimestamp(a.created_at));
    const groups = new Map<string, { label: string; items: DocumentItem[] }>();
    sorted.forEach((doc) => {
      const key = getISTDateTimeKey(doc.created_at) || "unknown";
      const label = formatDateTimeIST(doc.created_at);
      if (!groups.has(key)) {
        groups.set(key, { label, items: [] });
      }
      groups.get(key)?.items.push(doc);
    });
    return Array.from(groups.entries()).map(([key, value]) => ({ key, ...value }));
  }, [previousDocuments]);

  const loadPreviousDocuments = async (patientId: string) => {
    setPreviousDocumentsLoading(true);
    try {
      const data = await apiFetch<{ documents?: DocumentItem[] }>(`/api/patients/${patientId}/documents`);
      setPreviousDocuments(data.documents || []);
    } catch {
      setPreviousDocuments([]);
      setNotice({ type: "warning", message: "Unable to load previous documents." });
    } finally {
      setPreviousDocumentsLoading(false);
    }
  };

  const handleSelect = async (patient: Patient) => {
    setActivePatient(patient);
    setProfileUpdates(normalizeProfile(patient));
    setDoctorName("");
    setDoctorDepartment("");
    setReviewFee("");
    setDocFiles({});
    setOcrResults({});
    setOcrStatus({});
    setPreviousDocuments([]);
    onSelect(patient);
    void loadPreviousDocuments(patient.patient_id);
    try {
      const detail = await apiFetch<{ patient?: Patient }>(`/api/patients/${patient.patient_id}`);
      if (detail?.patient) {
        setActivePatient(detail.patient);
        setProfileUpdates(normalizeProfile(detail.patient));
      }
    } catch {
      setNotice({ type: "warning", message: "Loaded limited patient details for readmission edit." });
    }
  };

  const handleFileSelect = (docType: string) => (file: File | null) => {
    if (!file) {
      setDocFiles((prev) => {
        const next = { ...prev };
        delete next[docType];
        return next;
      });
      setOcrResults((prev) => {
        if (!prev[docType]) return prev;
        const next = { ...prev };
        delete next[docType];
        return next;
      });
      setOcrStatus((prev) => ({ ...prev, [docType]: "" }));
      return;
    }

    if (!isSupportedDocumentFile(file)) {
      setOcrStatus((prev) => ({ ...prev, [docType]: "Unsupported file type. Use PDF, JPG, PNG, WEBP, TIFF, BMP, GIF, HEIC, or HEIF." }));
      setDocFiles((prev) => {
        const next = { ...prev };
        delete next[docType];
        return next;
      });
      return;
    }
    setOcrStatus((prev) => ({ ...prev, [docType]: "" }));
    setDocFiles((prev) => ({ ...prev, [docType]: file }));
  };

  const handleOCR = async (docType: string) => {
    const file = docFiles[docType];
    if (!file) return;
    setOcrStatus((prev) => ({ ...prev, [docType]: "Processing OCR..." }));
    const body = new FormData();
    body.append("file", file);
    body.append("language", ocrLanguage);
    body.append("doc_type", docType);

    try {
      const response = await fetch(`${API_BASE}/api/ocr`, { method: "POST", body, credentials: "include" });
      const data = await response.json();
      setOcrResults((prev) => ({
        ...prev,
        [docType]: { text: data.text || "", file },
      }));
      setOcrStatus((prev) => ({ ...prev, [docType]: "OCR complete. Text will be saved with readmission." }));
    } catch {
      setOcrStatus((prev) => ({ ...prev, [docType]: "OCR failed." }));
    }
  };

  const handleOcrTextChange = (docType: string) => (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setOcrResults((prev) => ({
      ...prev,
      [docType]: { ...prev[docType], text: value },
    }));
  };

  const clearOcrEntry = (docType: string) => {
    setOcrResults((prev) => {
      const next = { ...prev };
      delete next[docType];
      return next;
    });
  };

  const handleProfileChange = (field: keyof ProfileUpdates) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = field === "pregnant" ? (event.target as HTMLInputElement).checked : event.target.value;
    setProfileUpdates((prev) => ({ ...prev, [field]: value }));
  };

  const printConfirmation = () => {
    if (!activePatient) return;
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Re-visit Confirmation</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
            .card { border: 1px solid #d1d5db; padding: 16px; border-radius: 8px; }
            .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
            h2 { margin-top: 0; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Follow-up / Re-visit Confirmation</h2>
            <div class="row"><strong>Patient</strong><span>${(activePatient.name || "").trim()} ${activePatient.last_name || ""}</span></div>
            <div class="row"><strong>UHID</strong><span>${activePatient.patient_id || "-"}</span></div>
            <div class="row"><strong>Doctor</strong><span>${doctorName || "-"}</span></div>
            <div class="row"><strong>Department</strong><span>${doctorDepartment || "-"}</span></div>
            <div class="row"><strong>Review Fee</strong><span>${reviewFee || "-"}</span></div>
            <div class="row"><strong>Symptoms</strong><span>${profileUpdates.symptoms || "-"}</span></div>
            <div class="row"><strong>Notes</strong><span>${notes || "-"}</span></div>
          </div>
        </body>
      </html>
    `;
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);
    frame.contentDocument?.open();
    frame.contentDocument?.write(html);
    frame.contentDocument?.close();
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 500);
  };

  const handleReadmit = async () => {
    if (!activePatient) return;
    const activeQueueEntry = getActiveReadmitEntry(activePatient.patient_id);
    if (activeQueueEntry) {
      setNotice({
        type: "warning",
        message: `${activePatient.patient_id} is already in OP Queue Management (${activeQueueEntry.status}). Complete the previous OP before re-visitting again.`,
      });
      return;
    }
    setSubmitting(true);
    try {
      const numberOrNull = (value: number | string) => {
        if (value === "" || value === null || value === undefined) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      await apiFetch(`/api/patients/${activePatient.patient_id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...activePatient,
          age: numberOrNull(profileUpdates.age),
          weight: numberOrNull(profileUpdates.weight),
          height: numberOrNull(profileUpdates.height),
          phone: profileUpdates.phone,
          symptoms: profileUpdates.symptoms,
          gender: profileUpdates.gender,
          pregnant: profileUpdates.pregnant,
        }),
      });
      const data = await apiFetch<{ admission_id: string }>(`/api/patients/${activePatient.patient_id}/admissions`, {
        method: "POST",
        body: JSON.stringify({ notes }),
      });

      const queueEntry = {
        token: `RA-${String(Date.now()).slice(-6)}`,
        uhid: activePatient.patient_id || "",
        name: [activePatient.name, activePatient.middle_name, activePatient.last_name].filter(Boolean).join(" ").trim() || activePatient.patient_id || "Patient",
        ageGender: `${profileUpdates.age || activePatient.age || "-"} / ${profileUpdates.gender || activePatient.gender || "-"}`,
        visitType: "Re-visit",
        arrivedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        status: "In Queue",
        mobile: profileUpdates.phone || activePatient.phone || activePatient.family_mobile || "",
        source: "readmit",
        admissionId: data.admission_id,
        createdAt: new Date().toISOString(),
      };
      const storedQueue = getStoredReadmitQueue();
      const withoutDuplicate = storedQueue.filter((item) => item?.uhid !== queueEntry.uhid || item?.status === "Completed");
      localStorage.setItem("hospai_op_queue", JSON.stringify([queueEntry, ...withoutDuplicate]));

      setNotice({
        type: "success",
        message: `Re-visit created. Admission ${data.admission_id}. Patient added to OP Queue Management.`,
      });
      setNotes("");
      setDocFiles({});
      setOcrResults({});
      setOcrStatus({});
      setPreviousDocuments([]);
      onSelect({ ...activePatient, ...profileUpdates, admission_id: data.admission_id });
      await onReadmitComplete?.(activePatient.patient_id);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to re-visit patient.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="panel">
      <h3>Re-visit Patient</h3>
      <div className="search-bar">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by Name, UHID, or Mobile Number" />
      </div>
      <div className="list-meta">
        <p className="muted">
          {query.trim()
            ? `Showing ${results.length} search result${results.length === 1 ? "" : "s"}.`
            : `Showing ${results.length} patient${results.length === 1 ? "" : "s"}.`}
        </p>
      </div>
      <div className="search-results">
        <Table className="readmit-results-table">
          <TableHead>
            <TableCell>Patient</TableCell>
            <TableCell>UHID</TableCell>
            <TableCell>Age</TableCell>
            <TableCell>Gender</TableCell>
            <TableCell>Phone</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Actions</TableCell>
          </TableHead>
          {results.map((patient) => {
            const expanded = activePatient?.patient_id === patient.patient_id;
            return (
              <Fragment key={patient.patient_id}>
                <TableRow className={expanded ? "active" : ""}>
                  <TableCell>
                    {[patient.name, patient.middle_name, patient.last_name].filter(Boolean).join(" ").trim() || patient.patient_id}
                  </TableCell>
                  <TableCell>{patient.patient_id}</TableCell>
                  <TableCell>{patient.age || "-"}</TableCell>
                  <TableCell>{patient.gender || "-"}</TableCell>
                  <TableCell>{patient.phone || "-"}</TableCell>
                  <TableCell>{formatDateTimeIST(patient.created_at)}</TableCell>
                  <TableCell className="row-actions">
                    <Button
                      variant={expanded ? "ghost" : "primary"}
                      size="sm"
                      onClick={() => {
                        if (expanded) {
                          setActivePatient(null);
                          return;
                        }
                        void handleSelect(patient);
                      }}
                    >
                      {expanded ? "Hide" : "Readmit"}
                    </Button>
                  </TableCell>
                </TableRow>
                {expanded && activePatient && (
                  <div className="table-row-expand">
                    <div className="readmit-form">
                      <h4>
                        Re-visiting: {activePatient.name} {activePatient.last_name} ({activePatient.patient_id})
                      </h4>
                      <Label>
                        Admission Notes
                        <Textarea className="readmit-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
                      </Label>
                      <h5>Update Patient Details</h5>
                      <div className="readmit-profile-grid">
                        <Label>
                          Age
                          <Input type="number" value={profileUpdates.age} onChange={handleProfileChange("age")} />
                        </Label>
                        <Label>
                          Weight (kg)
                          <Input type="number" value={profileUpdates.weight} onChange={handleProfileChange("weight")} />
                        </Label>
                        <Label>
                          Height (cm)
                          <Input type="number" value={profileUpdates.height} onChange={handleProfileChange("height")} />
                        </Label>
                        <Label>
                          Phone
                          <Input value={profileUpdates.phone} onChange={handleProfileChange("phone")} />
                        </Label>
                        <Label>
                          Doctor Name
                          <Input
                            value={doctorName}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDoctorName(value);
                              const match = doctorOptions.find((option) => (option.doctor_name || "").toLowerCase() === value.toLowerCase());
                              if (match) {
                                setDoctorDepartment(match.department || "");
                              } else if (!value.trim()) {
                                setDoctorDepartment("");
                              }
                            }}
                            list="doctor-suggestions"
                            placeholder="Dr. Name"
                            aria-label="Doctor name"
                          />
                        </Label>
                        <Label>
                          Doctor Department
                          <Input
                            value={doctorDepartment}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDoctorDepartment(value);
                              const match = doctorOptions.find((option) => (option.department || "").toLowerCase() === value.toLowerCase());
                              if (match) {
                                setDoctorName(match.doctor_name || "");
                              } else if (!value.trim()) {
                                setDoctorName("");
                              }
                            }}
                            list="department-suggestions"
                            placeholder="Department"
                            aria-label="Doctor department"
                          />
                        </Label>
                        <Label>
                          Review Fee
                          <Input
                            type="number"
                            min={0}
                            value={reviewFee}
                            onChange={(event) => setReviewFee(event.target.value)}
                            placeholder="0"
                            aria-label="Review fee"
                          />
                        </Label>
                        <Label>
                          Gender
                          <Select value={profileUpdates.gender} onChange={handleProfileChange("gender")}>
                            <option>Male</option>
                            <option>Female</option>
                            <option>Other</option>
                          </Select>
                        </Label>
                        <Label className="checkbox">
                          <Checkbox checked={profileUpdates.pregnant} onChange={handleProfileChange("pregnant")} />
                          Pregnant
                        </Label>
                        <Label className="span-2">
                          Current Symptoms
                          <Textarea value={profileUpdates.symptoms} onChange={handleProfileChange("symptoms")} rows={3} />
                        </Label>
                      </div>

                      <div className="queue-note">
                        {getActiveReadmitEntry(activePatient.patient_id) ? (
                          <>
                            This patient is already in <b>OP Queue Management</b>. Complete the active OP token before re-visitting again.
                          </>
                        ) : (
                          <>
                            After confirmation, this patient will be added directly to <b>OP Queue Management</b> with visit type <b>Re-visit</b>.
                          </>
                        )}
                      </div>

                      <div className="readmit-actions">
                        <Button variant="secondary" onClick={printConfirmation} disabled={!activePatient}>
                          Print Confirmation
                        </Button>
                        <Button variant="primary" onClick={() => void handleReadmit()} disabled={submitting || Boolean(getActiveReadmitEntry(activePatient.patient_id))}>
                          {submitting ? "Submitting..." : "Confirm Re-admission"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
        </Table>
      </div>
    </section>
  );
}
