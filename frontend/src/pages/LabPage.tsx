import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button, Input, Select } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import type { Notice } from "../types";
import { fullPatientName, lookupPatientByUhid, normalizeUhidLookup } from "../lib/patientLookup";
import { PRINT_BRAND_HEADER_DATA_URI } from "../lib/printBrand";
import { printViaIframe } from "../lib/printViaIframe";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

type ServiceItem = {
  code: string;
  name: string;
  category: string;
  rate: number | "";
  quantity: number | "";
};

type DiagnosticRecord = {
  id: number;
  invoice_no?: string;
  patient_id?: string;
  patient_name?: string;
  age?: number;
  gender?: string;
  visit_id?: string;
  doctor_name?: string;
  department?: string;
  visit_type?: string;
  test_name: string;
  amount: number;
  paid_amount?: number;
  due_amount?: number;
  status?: string;
  sample_barcode?: string;
  order_status?: string;
  bill_date?: string;
  due_date?: string;
  payment_mode?: string;
  transaction_id?: string;
  discount_percentage?: number;
  discount_amount?: number;
  tax_percentage?: number;
  tax_amount?: number;
  report_delivery_mode?: string;
  report_delivery_date?: string;
  remarks?: string;
  created_at?: string;
};

const LAB_CATEGORIES = ["Hematology", "Biochemistry", "Microbiology", "Pathology", "Serology"];
const DIAGNOSTIC_CATEGORIES = ["X-Ray", "Ultrasound", "CT Scan", "MRI", "ECG"];
const PAYMENT_MODES = ["Cash", "Card", "Online", "Cheque", "UPI"];
const DELIVERY_MODES = ["Email", "Physical", "Both"];

function formatAmount(amount: number) {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
}

function getCurrentDate() {
  return new Date().toISOString().split("T")[0];
}

function compactDate() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function buildInvoiceNo(type: "lab" | "diagnostic", index: number) {
  const prefix = type === "lab" ? "LAB" : "DIA";
  return `${prefix}-${compactDate()}-${String(Date.now()).slice(-5)}-${index + 1}`;
}

const safeText = (value: unknown) => String(value ?? "-")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const printField = (label: string, value: unknown) => `
  <div class="lab-print-field">
    <span>${safeText(label)}</span>
    <strong>${safeText(value === "" || value === null || value === undefined ? "-" : value)}</strong>
  </div>
`;

export default function LabPage({ setNotice }: Props) {
  const [activeTab, setActiveTab] = useState<"lab" | "diagnostic" | null>("lab");
  const [labItems, setLabItems] = useState<ServiceItem[]>([]);
  const [diagnosticItems, setDiagnosticItems] = useState<ServiceItem[]>([]);
  const [records, setRecords] = useState<DiagnosticRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [savingBill, setSavingBill] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<DiagnosticRecord | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<number[]>([]);

  const filteredRecords = useMemo(() => {
    const query = historySearchQuery.trim().toLowerCase();
    if (!query) return records;
    return records.filter((record) => {
      const nameMatch = (record.patient_name || "").toLowerCase().includes(query);
      const uhid = (record.patient_id || "").toLowerCase();
      const normalizedQuery = normalizeUhidLookup(query);
      const uhidMatch = uhid.includes(query) || (normalizedQuery && uhid.endsWith(normalizedQuery));
      return nameMatch || uhidMatch;
    });
  }, [records, historySearchQuery]);
  
  
  // Patient & Visit Information
  const [patientUhid, setPatientUhid] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientAge, setPatientAge] = useState("");
  const [patientGender, setPatientGender] = useState("");
  const [visitId, setVisitId] = useState("");
  const [department, setDepartment] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [visitType, setVisitType] = useState("");
  const [visitDateTime, setVisitDateTime] = useState("");
  const [reportDeliveryMode, setReportDeliveryMode] = useState("");
  const [reportDeliveryDate, setReportDeliveryDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [departments, setDepartments] = useState<string[]>([]);
  const [doctorSchedules, setDoctorSchedules] = useState<Array<{ doctor_name?: string | null; department?: string | null }>>([]);

  useEffect(() => {
    const loadDeps = async () => {
      try {
        const data = await apiFetch<{ departments?: { id: number; department_name?: string }[] }>("/api/registration/departments");
        setDepartments((data.departments || []).map((d) => (d.department_name || "").trim()).filter(Boolean));
      } catch {
        setDepartments([]);
      }
    };
    const loadDoctors = async () => {
      try {
        const data = await apiFetch<{ schedules?: { doctor_name?: string | null; department?: string | null }[] }>("/api/op/doctor-schedules");
        setDoctorSchedules(data.schedules || []);
      } catch {
        setDoctorSchedules([]);
      }
    };
    void loadDeps();
    void loadDoctors();
  }, []);
  
  // Payment & Billing Information
  const [billDate, setBillDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [taxPercentage, setTaxPercentage] = useState("");
  const [discountPercentage, setDiscountPercentage] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [payingDueAmount, setPayingDueAmount] = useState("");
  const [billNotes, setBillNotes] = useState("");

  const labTotal = useMemo(() => labItems.reduce((sum, item) => sum + Number(item.rate) * Number(item.quantity), 0), [labItems]);
  const diagnosticTotal = useMemo(() => diagnosticItems.reduce((sum, item) => sum + Number(item.rate) * Number(item.quantity), 0), [diagnosticItems]);
  const subtotal = labTotal + diagnosticTotal;
  const discountAmount = (subtotal * Number(discountPercentage || 0)) / 100;
  const afterDiscount = subtotal - discountAmount;
  const taxAmount = (afterDiscount * Number(taxPercentage || 0)) / 100;
  // For new bills, grandTotal is computed from form; for existing records, use stored net_amount
  const formGrandTotal = afterDiscount + taxAmount;
  const existingRecordNetAmount = selectedRecord
    ? Math.max(
        Number(selectedRecord.amount || 0)
        - Number(selectedRecord.discount_amount || 0)
        + Number(selectedRecord.tax_amount || 0),
        0
      )
    : 0;
  const grandTotal = selectedRecord ? existingRecordNetAmount : formGrandTotal;
  const totalPaidAfterUpdate = selectedRecord
    ? Number(paidAmount || 0) + Number(payingDueAmount || 0)
    : Number(paidAmount || 0);
  const balanceAmount = grandTotal - totalPaidAfterUpdate;


  const loadDiagnostics = async () => {
    setLoadingRecords(true);
    try {
      const data = await apiFetch<{ diagnostics?: DiagnosticRecord[] }>("/api/lab/diagnostics");
      setRecords(data.diagnostics || []);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to load lab diagnostics.");
    } finally {
      setLoadingRecords(false);
    }
  };

  useEffect(() => {
    void loadDiagnostics();
  }, []);

  const fillBillingPatient = async (value: string) => {
    const lookup = normalizeUhidLookup(value);
    if (!lookup) {
      setPatientName("");
      return;
    }
    try {
      const patient = await lookupPatientByUhid(lookup);
      if (!patient) {
        setPatientName("");
        setNotice({ type: "warning", message: "No patient found for that UHID / last 4 digits." });
        return;
      }
      const name = fullPatientName(patient) || patient.patient_id;
      setPatientUhid(patient.patient_id);
      setPatientName(name);
      setPatientAge(patient.age?.toString() || "");
      setPatientGender(patient.gender || "Male");
      setNotice({ type: "success", message: `Patient auto-filled: ${name}.` });
    } catch {
      setPatientName("");
      setNotice({ type: "error", message: "Unable to auto-fill patient details." });
    }
  };

  const doctorsForDepartment = (dept: string) => {
    const normalized = String(dept).trim().toLowerCase();
    return doctorSchedules
      .filter((s) => String(s.department || "").trim().toLowerCase() === normalized)
      .map((s) => String(s.doctor_name || "").trim())
      .filter(Boolean);
  };

  const getScheduleForDoctor = (name: string) => {
    const normalized = String(name).trim().toLowerCase();
    return doctorSchedules.find((s) => String(s.doctor_name || "").trim().toLowerCase() === normalized);
  };

  const addBlankItem = () => {
    const target = activeTab === "lab" ? labItems : diagnosticItems;
    const nextItem: ServiceItem = {
      code: activeTab === "lab" ? `LAB${String(target.length + 1).padStart(3, "0")}` : `IMG${String(target.length + 1).padStart(3, "0")}`,
      name: search.trim() || "",
      category: category || subCategory || "",
      rate: "",
      quantity: "",
    };
    if (activeTab === "lab") setLabItems((current) => [...current, nextItem]);
    else setDiagnosticItems((current) => [...current, nextItem]);
    setSearch("");
    setNotice({ type: "success", message: "Blank service row added. Enter service details to continue." });
  };

  const updateItem = (type: "lab" | "diagnostic", index: number, key: keyof ServiceItem, value: string) => {
    const setter = type === "lab" ? setLabItems : setDiagnosticItems;
    setter((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [key]: key === "rate" || key === "quantity"
                ? value === ""
                  ? ""
                  : Number(value)
                : value,
            }
          : item
      )
    );
  };

  const removeItem = (type: "lab" | "diagnostic", index: number) => {
    const setter = type === "lab" ? setLabItems : setDiagnosticItems;
    setter((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const servicePayloads = () => {
    const build = (type: "lab" | "diagnostic", items: ServiceItem[]) =>
      items
        .filter((item) => item.name.trim() && Number(item.rate || 0) > 0 && Number(item.quantity || 0) > 0)
        .map((item, index) => {
          const grossAmount = Number(item.rate || 0) * Number(item.quantity || 0);
          const proportion = subtotal > 0 ? grossAmount / subtotal : 0;
          const lineDiscount = Number((discountAmount * proportion).toFixed(2));
          const lineTax = Number((taxAmount * proportion).toFixed(2));
          const linePayable = Number(Math.max(grossAmount - lineDiscount + lineTax, 0).toFixed(2));
          return {
            invoice_no: buildInvoiceNo(type, index),
            patient_id: patientUhid.trim(),
            patient_name: patientName.trim() || undefined,
            age: patientAge ? Number(patientAge) : undefined,
            gender: patientGender,
            visit_id: visitId.trim() || undefined,
            doctor_name: doctorName.trim() || undefined,
            department: department.trim() || undefined,
            visit_type: visitType,
            test_name: `${type === "lab" ? "Lab" : "Diagnostic"} - ${item.name.trim()}`,
            amount: grossAmount,
            payable_amount: linePayable,
            paid_amount: 0,
            sample_barcode: item.code.trim() || undefined,
            order_status: "ordered",
            bill_date: billDate,
            due_date: dueDate,
            payment_mode: paymentMode,
            transaction_id: transactionId.trim() || undefined,
            discount_percentage: Number(discountPercentage || 0),
            discount_amount: lineDiscount,
            tax_percentage: Number(taxPercentage || 0),
            tax_amount: lineTax,
            report_delivery_mode: reportDeliveryMode,
            report_delivery_date: reportDeliveryDate,
            remarks: remarks.trim() || undefined,
          };
        });
    return [...build("lab", labItems), ...build("diagnostic", diagnosticItems)];
  };

  const loadBillIntoSummary = (record: DiagnosticRecord) => {
    setSelectedRecord(record);
    setPayingDueAmount("");

    // 1. Patient & Visit Info
    setPatientUhid(record.patient_id || "");
    setPatientName(record.patient_name || "");
    setPatientAge(record.age?.toString() || "");
    setPatientGender(record.gender || "Male");
    setVisitId(record.visit_id || "");
    setDepartment(record.department || "");
    setDoctorName(record.doctor_name || "");
    setVisitType(record.visit_type || "");
    setVisitDateTime(record.created_at || "");
    setReportDeliveryMode(record.report_delivery_mode || "");
    setReportDeliveryDate(record.report_delivery_date || "");
    setRemarks(record.remarks || "");

    // 2. Payment & Billing Info
    setBillDate(record.bill_date || "");
    setDueDate(record.due_date || "");
    setPaymentMode(record.payment_mode || "Cash");
    setTransactionId(record.transaction_id || "");
    setTaxPercentage(record.tax_percentage?.toString() || "");
    setDiscountPercentage(record.discount_percentage?.toString() || "");
    setPaidAmount(record.paid_amount?.toString() || "");
    setBillNotes(record.remarks || "");

    // 3. Service Items
    const testName = record.test_name || "";
    let isLab = true;
    let displayName = testName;
    if (testName.startsWith("Lab - ")) {
      isLab = true;
      displayName = testName.substring(6);
    } else if (testName.startsWith("Diagnostic - ")) {
      isLab = false;
      displayName = testName.substring(13);
    }

    const serviceItem: ServiceItem = {
      code: record.sample_barcode || "",
      name: displayName,
      category: record.department || "",
      rate: record.amount,
      quantity: 1,
    };

    if (isLab) {
      setLabItems([serviceItem]);
      setDiagnosticItems([]);
      setActiveTab("lab");
    } else {
      setLabItems([]);
      setDiagnosticItems([serviceItem]);
      setActiveTab("diagnostic");
    }

    setNotice({ type: "success", message: `Loaded bill ${record.invoice_no || `DIAG-${record.id}`} into summary.` });
    
    // Focus or scroll to 3. Payment & Billing Information section
    const element = document.getElementById("payment-billing-section");
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  const printRecordBill = (record: DiagnosticRecord) => {
    const printedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    const row = (label: string, value: unknown) => `
      <div class="journey-print-field">
        <span>${safeText(label)}</span>
        <strong>${safeText(value === "" || value === null || value === undefined ? "-" : value)}</strong>
      </div>`;

    const testName = record.test_name || "";
    let isLab = true;
    let displayName = testName;
    if (testName.startsWith("Lab - ")) {
      isLab = true;
      displayName = testName.substring(6);
    } else if (testName.startsWith("Diagnostic - ")) {
      isLab = false;
      displayName = testName.substring(13);
    }

    const testType = isLab ? "Lab" : "Diagnostic";
    const testCode = record.sample_barcode || "-";

    const serviceRows = `
      <tr>
        <td>1</td>
        <td>${safeText(testType)}</td>
        <td>${safeText(testCode)}</td>
        <td>${safeText(displayName)}</td>
        <td>${safeText(record.department || "-")}</td>
        <td>1</td>
        <td>₹${safeText(formatAmount(record.amount))}</td>
        <td>₹${safeText(formatAmount(record.amount))}</td>
      </tr>`;

    const recordPatientName = record.patient_name || "-";
    const recordPatientUhid = record.patient_id || "-";
    const recordPatientAge = record.age?.toString() || "";
    const recordPatientGender = record.gender || "";
    const recordDoctorName = record.doctor_name || "-";
    const recordDepartment = record.department || "-";
    
    const recordGrossAmount = record.amount;
    const recordDiscountAmount = record.discount_amount || 0;
    const recordTaxAmount = record.tax_amount || 0;
    const recordGrandTotal = recordGrossAmount - recordDiscountAmount + recordTaxAmount;
    const recordPaidAmount = record.paid_amount || 0;
    const recordBalanceAmount = record.due_amount || 0;

    const html = `
      <!doctype html>
      <html>
        <head>
          <title>${safeText(recordPatientUhid)} Lab &amp; Diagnostics Bill</title>
          <style>
            @page { size: A4; margin: 12mm; }
            * { box-sizing: border-box; }
            body { margin: 0; background: #ffffff; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
            .journey-print-sheet { width: 100%; min-height: 100vh; padding: 0; }
            /* --- 3-column branding header --- */
            .print-header {
              display: grid;
              grid-template-columns: 58px 1fr 220px;
              align-items: start;
              gap: 14px;
              padding-bottom: 12px;
              margin-bottom: 14px;
              border-bottom: 2px solid #111827;
            }
            .print-logo {
              width: 56px;
              height: 56px;
              object-fit: contain;
              display: block;
            }
            .print-brand-block {}
            .print-brand-title {
              margin: 0 0 3px;
              font-size: 17px;
              font-weight: 800;
              color: #062f56;
              line-height: 1.1;
            }
            .print-brand-line {
              margin: 1px 0;
              font-size: 10px;
              font-weight: 700;
              color: #062f56;
              line-height: 1.25;
            }
            .print-brand-unit {
              margin: 2px 0 0;
              font-size: 9px;
              color: #475569;
              line-height: 1.3;
            }
            .print-title-block { text-align: right; }
            .print-title-block h1 {
              margin: 0 0 5px;
              font-size: 15px;
              font-weight: 800;
              color: #111827;
              text-decoration: underline;
              line-height: 1.2;
            }
            .print-title-block p { margin: 2px 0; color: #475569; font-size: 10px; }
            /* --- Patient/bill content --- */
            .journey-print-section { border: 1px solid #111827; border-bottom: 0; margin-top: 0; }
            .journey-print-section:last-child { border-bottom: 1px solid #111827; }
            .journey-print-section h2 { margin: 0; padding: 6px 8px; border-bottom: 1px solid #111827; background: #eef7fb; color: #062f56; font-size: 12px; letter-spacing: 0.02em; text-transform: uppercase; }
            .journey-print-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .journey-print-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
            .journey-print-grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
            .journey-print-field { min-height: 32px; padding: 6px 8px; border-right: 1px solid #111827; border-bottom: 1px solid #111827; }
            .journey-print-field:nth-child(2n) { border-right: 0; }
            .journey-print-grid.three .journey-print-field:nth-child(2n), .journey-print-grid.four .journey-print-field:nth-child(2n) { border-right: 1px solid #111827; }
            .journey-print-grid.three .journey-print-field:nth-child(3n), .journey-print-grid.four .journey-print-field:nth-child(4n) { border-right: 0; }
            .journey-print-field span { display: block; margin-bottom: 3px; color: #334155; font-size: 9px; font-weight: 700; text-transform: uppercase; }
            .journey-print-field strong { display: block; min-height: 12px; color: #111827; font-size: 11px; }
            .journey-print-table { width: 100%; border-collapse: collapse; }
            .journey-print-table th, .journey-print-table td { padding: 6px 7px; border-right: 1px solid #111827; border-bottom: 1px solid #111827; text-align: left; vertical-align: top; }
            .journey-print-table th:last-child, .journey-print-table td:last-child { border-right: 0; }
            .journey-print-table th { background: #f2f8fb; color: #062f56; font-size: 9px; letter-spacing: 0.05em; text-transform: uppercase; }
            .journey-print-notes { padding: 8px; border-bottom: 1px solid #111827; min-height: 40px; white-space: pre-wrap; }
            .journey-print-signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 22px; }
            .journey-print-signatures div { padding-top: 22px; border-top: 1px solid #111827; text-align: center; font-weight: 700; }
          </style>
        </head>
        <body>
          <main class="journey-print-sheet">
            <header class="print-header">
              <img class="print-logo" src="${PRINT_BRAND_HEADER_DATA_URI}" alt="VERARA Polyclinic, Pharmacy, Diagnostics" />
              <div class="print-brand-block">
                <p class="print-brand-title">VERARA</p>
                <p class="print-brand-line">POLYCLINIC, PHARMACY,</p>
                <p class="print-brand-line">DIAGNOSTICS</p>
              </div>
              <div class="print-title-block">
                <h1>Lab &amp; Diagnostics Bill</h1>
                <p><strong>Invoice:</strong> ${safeText(record.invoice_no || `DIAG-${record.id}`)}</p>
                <p><strong>UHID:</strong> ${safeText(recordPatientUhid)}</p>
                <p><strong>Printed:</strong> ${safeText(printedAt)}</p>
              </div>
            </header>
            <section class="journey-print-section"><h2>Patient Information</h2><div class="journey-print-grid">${row("Patient Name", recordPatientName)}${row("UHID / Patient ID", recordPatientUhid)}${row("Age / Gender", `${recordPatientAge || "-"} / ${recordPatientGender || "-"}`)}${row("Department", recordDepartment || "-")}${row("Doctor", recordDoctorName || "-")}</div></section>
            <section class="journey-print-section"><h2>Bill Summary</h2><div class="journey-print-grid four">${row("Total Billed", `₹${formatAmount(recordGrandTotal)}`)}${row("Total Paid", `₹${formatAmount(Number(recordPaidAmount || 0))}`)}${row("Total Due", `₹${formatAmount(Math.max(recordBalanceAmount, 0))}`)}${row("Tests / Services", 1)}</div></section>
            <section class="journey-print-section"><h2>Test-wise Payment Details</h2><table class="journey-print-table"><thead><tr><th>#</th><th>Type</th><th>Code</th><th>Test</th><th>Category</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${serviceRows}</tbody></table></section>
            <section class="journey-print-section"><h2>Payment & Billing Information</h2><div class="journey-print-grid four">${row("Bill Date", record.bill_date || "-")}${row("Due Date", record.due_date || "-")}${row("Payment Mode", record.payment_mode || "-")}${row("Transaction ID", record.transaction_id || "-")}${row("Discount", `₹${formatAmount(recordDiscountAmount)}`)}${row("Tax", `₹${formatAmount(recordTaxAmount)}`)}${row("Report Delivery", record.report_delivery_mode || "-")}${row("Delivery Date", record.report_delivery_date || "-")}</div></section>
            <section class="journey-print-section"><h2>Remarks</h2><div class="journey-print-notes">${safeText(record.remarks || "-")}</div></section>
            <div class="journey-print-signatures"><div>Patient / Guardian</div><div>Prepared By</div><div>Authorized Signatory</div></div>
          </main>
        </body>
      </html>`;
    printViaIframe(html);
  };

  const saveBill = async () => {
    if (!patientUhid.trim() || !patientName.trim()) {
      setNotice({ type: "warning", message: "Enter UHID / last 4 digits and auto-fill patient before saving." });
      return;
    }
    const payloads = servicePayloads();
    if (payloads.length === 0) {
      setNotice({ type: "warning", message: "Add at least one lab or diagnostic service with amount." });
      return;
    }

    const paid = selectedRecord
      ? Math.max(Number(paidAmount || 0) + Number(payingDueAmount || 0), 0)
      : Math.max(Number(paidAmount) || 0, 0);
    let remainingPaid = Math.min(paid, grandTotal);
    setSavingBill(true);
    try {
      if (selectedRecord) {
        // For existing records, preserve the original amount/discount/tax so the backend
        // recalculates the same net_amount and correctly sets due_amount = net_amount - paid.
        const existingNetAmount = Math.max(
          Number(selectedRecord.amount || 0)
          - Number(selectedRecord.discount_amount || 0)
          + Number(selectedRecord.tax_amount || 0),
          0
        );
        const clampedPaid = Math.min(paid, existingNetAmount);
        await apiFetch(`/api/lab/diagnostics/${selectedRecord.id}`, {
          method: "PUT",
          body: JSON.stringify({
            // Preserve original billing fields unchanged
            amount: selectedRecord.amount,
            discount_percentage: selectedRecord.discount_percentage ?? 0,
            discount_amount: selectedRecord.discount_amount ?? 0,
            tax_percentage: selectedRecord.tax_percentage ?? 0,
            tax_amount: selectedRecord.tax_amount ?? 0,
            // Update payment fields
            paid_amount: clampedPaid,
            payment_mode: paymentMode || selectedRecord.payment_mode,
            transaction_id: transactionId.trim() || selectedRecord.transaction_id,
            bill_date: billDate || selectedRecord.bill_date,
            due_date: dueDate || selectedRecord.due_date,
            // Preserve record identity fields
            patient_id: selectedRecord.patient_id,
            patient_name: selectedRecord.patient_name,
            age: selectedRecord.age,
            gender: selectedRecord.gender,
            test_name: selectedRecord.test_name,
            invoice_no: selectedRecord.invoice_no,
            doctor_name: selectedRecord.doctor_name,
            department: selectedRecord.department,
            visit_type: selectedRecord.visit_type,
            visit_id: selectedRecord.visit_id,
            sample_barcode: selectedRecord.sample_barcode,
            order_status: selectedRecord.order_status,
            report_delivery_mode: reportDeliveryMode || selectedRecord.report_delivery_mode,
            report_delivery_date: reportDeliveryDate || selectedRecord.report_delivery_date,
            remarks: remarks.trim() || selectedRecord.remarks,
          }),
        });
        setSelectedRecord(null);
        setLabItems([]);
        setDiagnosticItems([]);
        setPaidAmount("");
        setPayingDueAmount("");
        await loadDiagnostics();
        setNotice({ type: "success", message: "Lab and diagnostic bill updated successfully." });
      } else {
        for (const payload of payloads) {
          const linePayable = Math.max(Number(payload.payable_amount ?? payload.amount ?? 0), 0);
          const linePaid = Math.min(remainingPaid, linePayable);
          remainingPaid -= linePaid;
          await apiFetch("/api/lab/diagnostics", {
            method: "POST",
            body: JSON.stringify({ ...payload, paid_amount: linePaid }),
          });
        }
        setLabItems([]);
        setDiagnosticItems([]);
        setPaidAmount("");
        setPayingDueAmount("");
        await loadDiagnostics();
        setNotice({ type: "success", message: "Lab and diagnostic bill saved successfully." });
      }
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save lab bill.");
    } finally {
      setSavingBill(false);
    }
  };



  const printSelectedInvoices = () => {
    const selectedRecords = records.filter(record => selectedInvoiceIds.includes(record.id));
    if (selectedRecords.length === 0) {
      setNotice({ type: "warning", message: "No invoices selected for printing." });
      return;
    }
    
    const printedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    const row = (label: string, value: unknown) => `
      <div class="journey-print-field">
        <span>${safeText(label)}</span>
        <strong>${safeText(value === "" || value === null || value === undefined ? "-" : value)}</strong>
      </div>`;

    // Group records by patient_id
    const groups: { [key: string]: DiagnosticRecord[] } = {};
    selectedRecords.forEach(record => {
      const pid = record.patient_id || "unknown";
      if (!groups[pid]) {
        groups[pid] = [];
      }
      groups[pid].push(record);
    });

    const patientIds = Object.keys(groups);

    const pagesHtml = patientIds.map((pid, groupIndex) => {
      const groupRecords = groups[pid];
      const firstRec = groupRecords[0];

      const recordPatientName = firstRec.patient_name || "-";
      const recordPatientUhid = firstRec.patient_id || "-";
      const recordPatientAge = firstRec.age?.toString() || "";
      const recordPatientGender = firstRec.gender || "";

      // Aggregate invoices, doctor names, departments
      const invoiceNos = groupRecords.map(r => r.invoice_no || `DIAG-${r.id}`).join(", ");
      const recordDoctorName = Array.from(new Set(groupRecords.map(r => r.doctor_name).filter(Boolean))).join(", ") || "-";
      const recordDepartment = Array.from(new Set(groupRecords.map(r => r.department).filter(Boolean))).join(", ") || "-";

      let totalGrossAmount = 0;
      let totalDiscountAmount = 0;
      let totalTaxAmount = 0;
      let totalPaidAmount = 0;
      let totalBalanceAmount = 0;

      const serviceRows = groupRecords.map((record, index) => {
        const testName = record.test_name || "";
        let isLab = true;
        let displayName = testName;
        if (testName.startsWith("Lab - ")) {
          isLab = true;
          displayName = testName.substring(6);
        } else if (testName.startsWith("Diagnostic - ")) {
          isLab = false;
          displayName = testName.substring(13);
        }

        const testType = isLab ? "Lab" : "Diagnostic";
        const testCode = record.sample_barcode || "-";

        totalGrossAmount += record.amount || 0;
        totalDiscountAmount += record.discount_amount || 0;
        totalTaxAmount += record.tax_amount || 0;
        totalPaidAmount += record.paid_amount || 0;
        totalBalanceAmount += record.due_amount || 0;

        return `
          <tr>
            <td>${index + 1}</td>
            <td>${safeText(testType)}</td>
            <td>${safeText(testCode)}</td>
            <td>${safeText(displayName)}</td>
            <td>${safeText(record.department || "-")}</td>
            <td>1</td>
            <td>₹${safeText(formatAmount(record.amount))}</td>
            <td>₹${safeText(formatAmount(record.amount))}</td>
          </tr>`;
      }).join("");

      const recordGrandTotal = totalGrossAmount - totalDiscountAmount + totalTaxAmount;

      // Unique billing fields across records for display
      const billDates = Array.from(new Set(groupRecords.map(r => r.bill_date).filter(Boolean))).join(", ") || "-";
      const dueDates = Array.from(new Set(groupRecords.map(r => r.due_date).filter(Boolean))).join(", ") || "-";
      const paymentModes = Array.from(new Set(groupRecords.map(r => r.payment_mode).filter(Boolean))).join(", ") || "-";
      const transactionIds = Array.from(new Set(groupRecords.map(r => r.transaction_id).filter(Boolean))).join(", ") || "-";
      const reportDeliveries = Array.from(new Set(groupRecords.map(r => r.report_delivery_mode).filter(Boolean))).join(", ") || "-";
      const reportDeliveryDates = Array.from(new Set(groupRecords.map(r => r.report_delivery_date).filter(Boolean))).join(", ") || "-";
      const remarksList = groupRecords.map(r => r.remarks).filter(Boolean);
      const remarksStr = remarksList.length > 0 ? remarksList.join(" | ") : "-";

      const pageBreakStyle = groupIndex < patientIds.length - 1 ? 'page-break-after: always;' : '';

      return `
        <div class="journey-print-sheet" style="${pageBreakStyle} margin-bottom: 30px;">
          <header class="print-header">
            <img class="print-logo" src="${PRINT_BRAND_HEADER_DATA_URI}" alt="VERARA Polyclinic, Pharmacy, Diagnostics" />
            <div class="print-brand-block">
              <p class="print-brand-title">VERARA</p>
              <p class="print-brand-line">POLYCLINIC, PHARMACY,</p>
              <p class="print-brand-line">DIAGNOSTICS</p>
            </div>
            <div class="print-title-block">
              <h1>Consolidated Lab &amp; Diagnostics Bill</h1>
              <p><strong>Invoices:</strong> ${safeText(invoiceNos)}</p>
              <p><strong>UHID:</strong> ${safeText(recordPatientUhid)}</p>
              <p><strong>Printed:</strong> ${safeText(printedAt)}</p>
            </div>
          </header>
          <section class="journey-print-section"><h2>Patient Information</h2><div class="journey-print-grid">${row("Patient Name", recordPatientName)}${row("UHID / Patient ID", recordPatientUhid)}${row("Age / Gender", `${recordPatientAge || "-"} / ${recordPatientGender || "-"}`)}${row("Department", recordDepartment)}${row("Doctor", recordDoctorName)}</div></section>
          <section class="journey-print-section"><h2>Bill Summary</h2><div class="journey-print-grid four">${row("Total Billed", `₹${formatAmount(recordGrandTotal)}`)}${row("Total Paid", `₹${formatAmount(Number(totalPaidAmount || 0))}`)}${row("Total Due", `₹${formatAmount(Math.max(totalBalanceAmount, 0))}`)}${row("Tests / Services", groupRecords.length)}</div></section>
          <section class="journey-print-section"><h2>Test-wise Payment Details</h2><table class="journey-print-table"><thead><tr><th>#</th><th>Type</th><th>Code</th><th>Test</th><th>Category</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${serviceRows}</tbody></table></section>
          <section class="journey-print-section"><h2>Payment & Billing Information</h2><div class="journey-print-grid four">${row("Bill Date", billDates)}${row("Due Date", dueDates)}${row("Payment Mode", paymentModes)}${row("Transaction ID", transactionIds)}${row("Discount", `₹${formatAmount(totalDiscountAmount)}`)}${row("Tax", `₹${formatAmount(totalTaxAmount)}`)}${row("Report Delivery", reportDeliveries)}${row("Delivery Date", reportDeliveryDates)}</div></section>
          <section class="journey-print-section"><h2>Remarks</h2><div class="journey-print-notes">${safeText(remarksStr)}</div></section>
          <div class="journey-print-signatures"><div>Patient / Guardian</div><div>Prepared By</div><div>Authorized Signatory</div></div>
        </div>
      `;
    }).join("");

    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Selected Lab &amp; Diagnostics Bills</title>
          <style>
            @page { size: A4; margin: 12mm; }
            * { box-sizing: border-box; }
            body { margin: 0; background: #ffffff; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
            .journey-print-sheet { width: 100%; min-height: 100vh; padding: 0; }
            /* --- 3-column branding header --- */
            .print-header {
              display: grid;
              grid-template-columns: 58px 1fr 220px;
              align-items: start;
              gap: 14px;
              padding-bottom: 12px;
              margin-bottom: 14px;
              border-bottom: 2px solid #111827;
            }
            .print-logo {
              width: 56px;
              height: 56px;
              object-fit: contain;
              display: block;
            }
            .print-brand-block {}
            .print-brand-title {
              margin: 0 0 3px;
              font-size: 17px;
              font-weight: 800;
              color: #062f56;
              line-height: 1.1;
            }
            .print-brand-line {
              margin: 1px 0;
              font-size: 10px;
              font-weight: 700;
              color: #062f56;
              line-height: 1.25;
            }
            .print-brand-unit {
              margin: 2px 0 0;
              font-size: 9px;
              color: #475569;
              line-height: 1.3;
            }
            .print-title-block { text-align: right; }
            .print-title-block h1 {
              margin: 0 0 5px;
              font-size: 15px;
              font-weight: 800;
              color: #111827;
              text-decoration: underline;
              line-height: 1.2;
            }
            .print-title-block p { margin: 2px 0; color: #475569; font-size: 10px; }
            /* --- Patient/bill content --- */
            .journey-print-section { border: 1px solid #111827; border-bottom: 0; margin-top: 0; }
            .journey-print-section:last-child { border-bottom: 1px solid #111827; }
            .journey-print-section h2 { margin: 0; padding: 6px 8px; border-bottom: 1px solid #111827; background: #eef7fb; color: #062f56; font-size: 12px; letter-spacing: 0.02em; text-transform: uppercase; }
            .journey-print-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .journey-print-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
            .journey-print-grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
            .journey-print-field { min-height: 32px; padding: 6px 8px; border-right: 1px solid #111827; border-bottom: 1px solid #111827; }
            .journey-print-field:nth-child(2n) { border-right: 0; }
            .journey-print-grid.three .journey-print-field:nth-child(2n), .journey-print-grid.four .journey-print-field:nth-child(2n) { border-right: 1px solid #111827; }
            .journey-print-grid.three .journey-print-field:nth-child(3n), .journey-print-grid.four .journey-print-field:nth-child(4n) { border-right: 0; }
            .journey-print-field span { display: block; margin-bottom: 3px; color: #334155; font-size: 9px; font-weight: 700; text-transform: uppercase; }
            .journey-print-field strong { display: block; min-height: 12px; color: #111827; font-size: 11px; }
            .journey-print-table { width: 100%; border-collapse: collapse; }
            .journey-print-table th, .journey-print-table td { padding: 6px 7px; border-right: 1px solid #111827; border-bottom: 1px solid #111827; text-align: left; vertical-align: top; }
            .journey-print-table th:last-child, .journey-print-table td:last-child { border-right: 0; }
            .journey-print-table th { background: #f2f8fb; color: #062f56; font-size: 9px; letter-spacing: 0.05em; text-transform: uppercase; }
            .journey-print-notes { padding: 8px; border-bottom: 1px solid #111827; min-height: 40px; white-space: pre-wrap; }
            .journey-print-signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 22px; }
            .journey-print-signatures div { padding-top: 22px; border-top: 1px solid #111827; text-align: center; font-weight: 700; }
          </style>
        </head>
        <body>
          ${pagesHtml}
        </body>
      </html>`;
      
    printViaIframe(html, "__hospai_lab2_print_frame__");
  };

  const printLabBill = () => {
    if (!patientUhid.trim() || !patientName.trim()) {
      setNotice({ type: "warning", message: "Enter UHID / last 4 digits and auto-fill patient before printing." });
      return;
    }
    const items = [...labItems.map((item) => ({ ...item, type: "Lab" })), ...diagnosticItems.map((item) => ({ ...item, type: "Diagnostic" }))]
      .filter((item) => item.name.trim() && Number(item.rate) > 0 && Number(item.quantity) > 0);
    if (!items.length) {
      setNotice({ type: "warning", message: "Add at least one lab or diagnostic service with amount before printing." });
      return;
    }
    const printedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    const row = (label: string, value: unknown) => `
      <div class="journey-print-field">
        <span>${safeText(label)}</span>
        <strong>${safeText(value === "" || value === null || value === undefined ? "-" : value)}</strong>
      </div>`;
    const serviceRows = items.map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${safeText(item.type)}</td>
        <td>${safeText(item.code)}</td>
        <td>${safeText(item.name)}</td>
        <td>${safeText(item.category || "-")}</td>
        <td>${safeText(item.quantity)}</td>
        <td>₹${safeText(formatAmount(Number(item.rate)))}</td>
        <td>₹${safeText(formatAmount(Number(item.rate) * Number(item.quantity)))}</td>
      </tr>`).join("");
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>${safeText(patientUhid)} Lab &amp; Diagnostics Bill</title>
          <style>
            @page { size: A4; margin: 12mm; }
            * { box-sizing: border-box; }
            body { margin: 0; background: #ffffff; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
            .journey-print-sheet { width: 100%; min-height: 100vh; padding: 0; }
            /* --- 3-column branding header --- */
            .print-header {
              display: grid;
              grid-template-columns: 58px 1fr 220px;
              align-items: start;
              gap: 14px;
              padding-bottom: 12px;
              margin-bottom: 14px;
              border-bottom: 2px solid #111827;
            }
            .print-logo {
              width: 56px;
              height: 56px;
              object-fit: contain;
              display: block;
            }
            .print-brand-block {}
            .print-brand-title {
              margin: 0 0 3px;
              font-size: 17px;
              font-weight: 800;
              color: #062f56;
              line-height: 1.1;
            }
            .print-brand-line {
              margin: 1px 0;
              font-size: 10px;
              font-weight: 700;
              color: #062f56;
              line-height: 1.25;
            }
            .print-brand-unit {
              margin: 2px 0 0;
              font-size: 9px;
              color: #475569;
              line-height: 1.3;
            }
            .print-title-block { text-align: right; }
            .print-title-block h1 {
              margin: 0 0 5px;
              font-size: 15px;
              font-weight: 800;
              color: #111827;
              text-decoration: underline;
              line-height: 1.2;
            }
            .print-title-block p { margin: 2px 0; color: #475569; font-size: 10px; }
            /* --- Patient/bill content --- */
            .journey-print-section { border: 1px solid #111827; border-bottom: 0; margin-top: 0; }
            .journey-print-section:last-child { border-bottom: 1px solid #111827; }
            .journey-print-section h2 { margin: 0; padding: 6px 8px; border-bottom: 1px solid #111827; background: #eef7fb; color: #062f56; font-size: 12px; letter-spacing: 0.02em; text-transform: uppercase; }
            .journey-print-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .journey-print-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
            .journey-print-grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
            .journey-print-field { min-height: 32px; padding: 6px 8px; border-right: 1px solid #111827; border-bottom: 1px solid #111827; }
            .journey-print-field:nth-child(2n) { border-right: 0; }
            .journey-print-grid.three .journey-print-field:nth-child(2n), .journey-print-grid.four .journey-print-field:nth-child(2n) { border-right: 1px solid #111827; }
            .journey-print-grid.three .journey-print-field:nth-child(3n), .journey-print-grid.four .journey-print-field:nth-child(4n) { border-right: 0; }
            .journey-print-field span { display: block; margin-bottom: 3px; color: #334155; font-size: 9px; font-weight: 700; text-transform: uppercase; }
            .journey-print-field strong { display: block; min-height: 12px; color: #111827; font-size: 11px; }
            .journey-print-table { width: 100%; border-collapse: collapse; }
            .journey-print-table th, .journey-print-table td { padding: 6px 7px; border-right: 1px solid #111827; border-bottom: 1px solid #111827; text-align: left; vertical-align: top; }
            .journey-print-table th:last-child, .journey-print-table td:last-child { border-right: 0; }
            .journey-print-table th { background: #f2f8fb; color: #062f56; font-size: 9px; letter-spacing: 0.05em; text-transform: uppercase; }
            .journey-print-notes { padding: 8px; border-bottom: 1px solid #111827; min-height: 40px; white-space: pre-wrap; }
            .journey-print-signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 22px; }
            .journey-print-signatures div { padding-top: 22px; border-top: 1px solid #111827; text-align: center; font-weight: 700; }
          </style>
        </head>
        <body>
          <main class="journey-print-sheet">
            <header class="print-header">
              <img class="print-logo" src="${PRINT_BRAND_HEADER_DATA_URI}" alt="VERARA Polyclinic, Pharmacy, Diagnostics" />
              <div class="print-brand-block">
                <p class="print-brand-title">VERARA</p>
                <p class="print-brand-line">POLYCLINIC, PHARMACY,</p>
                <p class="print-brand-line">DIAGNOSTICS</p>
              </div>
              <div class="print-title-block">
                <h1>Lab &amp; Diagnostics Bill</h1>
                <p><strong>UHID:</strong> ${safeText(patientUhid)}</p>
                <p><strong>Printed:</strong> ${safeText(printedAt)}</p>
              </div>
            </header>
            <section class="journey-print-section"><h2>Patient Information</h2><div class="journey-print-grid">${row("Patient Name", patientName)}${row("UHID / Patient ID", patientUhid)}${row("Age / Gender", `${patientAge || "-"} / ${patientGender || "-"}`)}${row("Department", department || "-")}${row("Doctor", doctorName || "-")}</div></section>
            <section class="journey-print-section"><h2>Bill Summary</h2><div class="journey-print-grid four">${row("Total Billed", `₹${formatAmount(grandTotal)}`)}${row("Total Paid", `₹${formatAmount(Number(paidAmount || 0))}`)}${row("Total Due", `₹${formatAmount(Math.max(balanceAmount, 0))}`)}${row("Tests / Services", items.length)}</div></section>
            <section class="journey-print-section"><h2>Test-wise Payment Details</h2><table class="journey-print-table"><thead><tr><th>#</th><th>Type</th><th>Code</th><th>Test</th><th>Category</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${serviceRows}</tbody></table></section>
            <section class="journey-print-section"><h2>Payment & Billing Information</h2><div class="journey-print-grid four">${row("Bill Date", billDate || "-")}${row("Due Date", dueDate || "-")}${row("Payment Mode", paymentMode || "-")}${row("Transaction ID", transactionId || "-")}${row("Discount", `₹${formatAmount(discountAmount)}`)}${row("Tax", `₹${formatAmount(taxAmount)}`)}${row("Report Delivery", reportDeliveryMode || "-")}${row("Delivery Date", reportDeliveryDate || "-")}</div></section>
            <section class="journey-print-section"><h2>Remarks</h2><div class="journey-print-notes">${safeText(remarks || billNotes || "-")}</div></section>
            <div class="journey-print-signatures"><div>Patient / Guardian</div><div>Prepared By</div><div>Authorized Signatory</div></div>
          </main>
        </body>
      </html>`;
    printViaIframe(html, "__hospai_lab2_print_frame__");
  };

  const saveBillAndPrint = async () => {
    printLabBill();
    await saveBill();
  };

  const resetForm = () => {
    setSelectedRecord(null);
    setPatientUhid("");
    setPatientName("");
    setPatientAge("");
    setPatientGender("");
    setVisitId("");
    setDepartment("");
    setDoctorName("");
    setVisitType("");
    setVisitDateTime("");
    setReportDeliveryMode("");
    setReportDeliveryDate("");
    setRemarks("");
    setBillDate("");
    setDueDate("");
    setPaymentMode("");
    setTransactionId("");
    setTaxPercentage("");
    setDiscountPercentage("");
    setPaidAmount("");
    setPayingDueAmount("");
    setBillNotes("");
    setLabItems([]);
    setDiagnosticItems([]);
    setActiveTab(null);
    setNotice({ type: "success", message: "Form reset." });
  };

  const renderRows = (type: "lab" | "diagnostic", items: ServiceItem[]) => {
    if (items.length === 0) {
      return (
        <tr>
          <td colSpan={8} className="lab-empty-row">No services added yet. Use search/category and Add Test to create a row.</td>
        </tr>
      );
    }

    return items.map((item, index) => (
      <tr key={`${type}-${index}-${item.code}`}>
        <td>{index + 1}</td>
        <td>
          <Input value={item.code} onChange={(event) => updateItem(type, index, "code", event.target.value)} aria-label={`${type} code`} />
        </td>
        <td>
          <Input value={item.name} onChange={(event) => updateItem(type, index, "name", event.target.value)} aria-label={`${type} name`} />
        </td>
        <td>
          <Input value={item.category} onChange={(event) => updateItem(type, index, "category", event.target.value)} aria-label={`${type} category`} />
        </td>
        <td>
          <Input type="number" min={0} value={item.rate} onChange={(event) => updateItem(type, index, "rate", event.target.value)} aria-label={`${type} rate`} placeholder="Enter amount" />
        </td>
        <td>
          <Input type="number" min={1} value={item.quantity} onChange={(event) => updateItem(type, index, "quantity", event.target.value)} aria-label={`${type} quantity`} placeholder="Qty" />
        </td>
        <td className="lab-service-amount">{formatAmount(Number(item.rate || 0) * Number(item.quantity || 0))}</td>
        <td>
          <button className="lab-delete-btn" type="button" onClick={() => removeItem(type, index)} aria-label="Delete row">×</button>
        </td>
      </tr>
    ));
  };

  return (
    <section className="module-page lab-billing-page">
      <div className="lab-page-header compact-lab-header">
        <div className="lab-header-icon">📋</div>
        <div>
          <h2>Lab & Diagnostic Billing Process</h2>
          <p>Create and manage billing for laboratory tests and diagnostic procedures</p>
        </div>
      </div>

      <div className="lab-layout single-column-lab">
        <div className="lab-card lab-services-card provided-services-card">
          
          {/* 1. PATIENT & VISIT INFORMATION */}
          <h3 className="lab-section-header">1. Patient & Visit Information</h3>
          <div className="lab-patient-grid">
            <div className="lab-field">
              <label>UHID / Patient ID *</label>
              <Input 
                value={patientUhid} 
                onChange={(event) => { setPatientUhid(event.target.value); setPatientName(""); }} 
                onBlur={(event) => void fillBillingPatient(event.target.value)} 
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void fillBillingPatient((event.currentTarget as HTMLInputElement).value); } }} 
                placeholder="Enter UHID or last 4 digits" 
                aria-label="Patient UHID" 
              />
            </div>
            <div className="lab-field">
              <label>Visit Type *</label>
              <Select value={visitType} onChange={(event) => setVisitType(event.target.value)} aria-label="Visit Type">
                <option value="OPD">OPD</option>
                <option value="IPD">IPD</option>
                <option value="Emergency">Emergency</option>
              </Select>
            </div>
            <div className="lab-field">
              <label>Date / Time</label>
              <Input 
                type="datetime-local"
                value={visitDateTime}
                onChange={(event) => setVisitDateTime(event.target.value)}
                aria-label="Visit Date Time"
              />
            </div>

            <div className="lab-field">
              <label>Patient Name *</label>
              <Input 
                value={patientName} 
                onChange={(event) => setPatientName(event.target.value)} 
                placeholder="Auto-filled" 
                aria-label="Patient name" 
              />
            </div>
            <div className="lab-field">
              <label>Age</label>
              <Input 
                type="number"
                value={patientAge}
                onChange={(event) => setPatientAge(event.target.value)}
                placeholder="Auto-filled"
                aria-label="Age"
              />
            </div>
            <div className="lab-field">
              <label>Gender</label>
              <Select value={patientGender} onChange={(event) => setPatientGender(event.target.value)} aria-label="Gender">
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </Select>
            </div>
            <div className="lab-field">
              <label>Report Delivery Mode</label>
              <Select value={reportDeliveryMode} onChange={(event) => setReportDeliveryMode(event.target.value)} aria-label="Delivery Mode">
                {DELIVERY_MODES.map(mode => <option key={mode}>{mode}</option>)}
              </Select>
            </div>

            <div className="lab-field">
              <label>Department *</label>
              <Select
                value={department}
                onChange={(event) => {
                  const value = event.target.value;
                  setDepartment(value);
                  const doctors = doctorsForDepartment(value);
                  if (doctors.length === 1) setDoctorName(doctors[0]);
                  else setDoctorName("");
                }}
                aria-label="Department"
              >
                <option value="">Select Department</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </div>
            <div className="lab-field">
              <label>Doctor *</label>
              <Select
                value={doctorName}
                onChange={(event) => {
                  const value = event.target.value;
                  setDoctorName(value);
                  const schedule = getScheduleForDoctor(value);
                  if (schedule?.department) setDepartment(schedule.department || "");
                }}
                aria-label="Doctor name"
              >
                <option value="">Select Doctor</option>
                {(department ? doctorsForDepartment(department) : doctorSchedules.map((s) => String(s.doctor_name || "")).filter(Boolean))
                  .map((dn) => <option key={dn} value={dn}>{dn}</option>)}
              </Select>
            </div>
            <div className="lab-field">
              <label>Report Delivery Date</label>
              <Input 
                type="date"
                value={reportDeliveryDate}
                onChange={(event) => setReportDeliveryDate(event.target.value)}
                aria-label="Report Delivery Date"
              />
            </div>
            <div className="lab-field">
              <label>Remarks</label>
              <Input 
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                placeholder="Additional remarks (if any)"
                aria-label="Remarks"
              />
            </div>
          </div>

          {/* 2. SELECT SERVICES */}
          <h3 className="lab-section-header">2. Select Services</h3>
          <div className="lab-tabs">
            <button className={activeTab === "lab" ? "active" : ""} type="button" onClick={() => setActiveTab("lab")}>Lab Tests</button>
            <button className={activeTab === "diagnostic" ? "active diagnostic" : "diagnostic"} type="button" onClick={() => { setActiveTab("diagnostic"); }}>Diagnostic (Imaging)</button>
          </div>

          <div className="lab-service-toolbar">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search test by name or code..." aria-label="Lab service search" />
            <Select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Lab category">
              <option value="">Select Category</option>
              {(activeTab === "lab" ? LAB_CATEGORIES : DIAGNOSTIC_CATEGORIES).map((item) => <option key={item}>{item}</option>)}
            </Select>
            <Select value={subCategory} onChange={(event) => setSubCategory(event.target.value)} aria-label="Lab sub category">
              <option value="">Select Sub-Category</option>
              <option value="Routine">Routine</option>
              <option value="Emergency">Emergency</option>
              <option value="Special">Special</option>
            </Select>
            <Button type="button" onClick={addBlankItem}>+ Add Test</Button>
          </div>

          {activeTab === "lab" && (
            <div className="lab-table-section blue-section">
              <div className="lab-section-title">Lab Tests</div>
              <table className="lab-billing-table">
                <thead>
                  <tr><th>#</th><th>Test Code</th><th>Test Name</th><th>Category</th><th>Rate (₹)</th><th>Qty</th><th>Amount (₹)</th><th>Action</th></tr>
                </thead>
                <tbody>{renderRows("lab", labItems)}</tbody>
              </table>
              <div className="lab-total-row"><span>Total Lab Tests Amount</span><strong>₹ {formatAmount(labTotal)}</strong></div>
            </div>
          )}

          {activeTab === "diagnostic" && (
            <div className="lab-table-section purple-section">
              <div className="lab-section-title">Diagnostic Imaging</div>
              <table className="lab-billing-table">
                <thead>
                  <tr><th>#</th><th>Procedure Code</th><th>Procedure Name</th><th>Category</th><th>Rate (₹)</th><th>Qty</th><th>Amount (₹)</th><th>Action</th></tr>
                </thead>
                <tbody>{renderRows("diagnostic", diagnosticItems)}</tbody>
              </table>
              <div className="lab-total-row purple"><span>Total Diagnostic Amount</span><strong>₹ {formatAmount(diagnosticTotal)}</strong></div>
            </div>
          )}

          {/* 3. PAYMENT & BILLING INFORMATION */}
          <h3 id="payment-billing-section" className="lab-section-header">3. Payment & Billing Information</h3>
          <div className="lab-patient-grid">
            <div className="lab-field">
              <label>Bill Date</label>
              <Input 
                type="date"
                value={billDate}
                onChange={(event) => setBillDate(event.target.value)}
                aria-label="Bill Date"
              />
            </div>
            <div className="lab-field">
              <label>Due Date</label>
              <Input 
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                aria-label="Due Date"
              />
            </div>
            <div className="lab-field">
              <label>Payment Mode *</label>
              <Select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value)} aria-label="Payment Mode">
                {PAYMENT_MODES.map(mode => <option key={mode}>{mode}</option>)}
              </Select>
            </div>
            <div className="lab-field">
              <label>Total Lab Tests Amount (₹)</label>
              <Input 
                type="text"
                value={formatAmount(labTotal)}
                aria-label="Total Lab Tests Amount"
                disabled
              />
            </div>
            <div className="lab-field">
              <label>Total Diagnostic Amount (₹)</label>
              <Input 
                type="text"
                value={formatAmount(diagnosticTotal)}
                aria-label="Total Diagnostic Amount"
                disabled
              />
            </div>
            <div className="lab-field">
              <label>Paid Amount (₹) *</label>
              <Input 
                type="number"
                min={0}
                value={paidAmount}
                onChange={(event) => setPaidAmount(event.target.value)}
                placeholder="0.00"
                aria-label="Paid Amount"
                disabled={selectedRecord !== null}
              />
            </div>
            {selectedRecord && (
              <div className="lab-field">
                <label style={{ color: "#2563eb", fontWeight: "bold" }}>Paying Due Amount (₹)</label>
                <Input 
                  type="number"
                  min={0}
                  max={selectedRecord.due_amount}
                  value={payingDueAmount}
                  onChange={(event) => setPayingDueAmount(event.target.value)}
                  placeholder={`Max ${selectedRecord.due_amount}`}
                  aria-label="Paying Due Amount"
                  style={{ border: "2px solid #2563eb" }}
                />
              </div>
            )}

            <div className="lab-field">
              <label>Transaction / Reference No.</label>
              <Input 
                value={transactionId}
                onChange={(event) => setTransactionId(event.target.value)}
                placeholder="e.g., TXN123456789"
                aria-label="Transaction ID"
              />
            </div>
            <div className="lab-field">
              <label>Discount Type</label>
              <Select aria-label="Discount Type">
                <option value="">Percentage (%)</option>
                <option value="">Fixed Amount</option>
              </Select>
            </div>
            <div className="lab-field">
              <label>Percentage / Discount (%) *</label>
              <Input 
                type="number"
                min={0}
                value={discountPercentage}
                onChange={(event) => setDiscountPercentage(event.target.value)}
                placeholder="0"
                aria-label="Discount Percentage"
              />
            </div>
            <div className="lab-field">
              <label>Discount Amount (₹)</label>
              <Input 
                type="text"
                value={formatAmount(discountAmount)}
                disabled
                aria-label="Discount Amount"
              />
            </div>

            <div className="lab-field">
              <label>Tax (%)</label>
              <Input 
                type="number"
                min={0}
                value={taxPercentage}
                onChange={(event) => setTaxPercentage(event.target.value)}
                placeholder="5"
                aria-label="Tax Percentage"
              />
            </div>
            <div className="lab-field" style={{gridColumn: "span 3"}}>
              <label>Notes</label>
              <Input 
                value={billNotes}
                onChange={(event) => setBillNotes(event.target.value)}
                placeholder="Enter notes (if any)"
                aria-label="Bill Notes"
              />
            </div>
          </div>

          {/* 4. BILL SUMMARY */}
          <h3 className="lab-section-header">4. Bill Summary</h3>
          <div className="lab-bill-summary">
            <div className="summary-row">
              <span>Total Lab Tests Amount (₹)</span>
              <strong>{formatAmount(labTotal)}</strong>
            </div>
            <div className="summary-row">
              <span>Total Diagnostic Amount (₹)</span>
              <strong>{formatAmount(diagnosticTotal)}</strong>
            </div>
            <div className="summary-row">
              <span>Sub Total (₹)</span>
              <strong>{formatAmount(subtotal)}</strong>
            </div>
            <div className="summary-row">
              <span>Discount (₹)</span>
              <strong>-{formatAmount(discountAmount)}</strong>
            </div>
            <div className="summary-row">
              <span>Tax ({taxPercentage}%) (₹)</span>
              <strong>{formatAmount(taxAmount)}</strong>
            </div>
            <div className="summary-row summary-total">
              <span>Total Amount (₹)</span>
              <strong>{formatAmount(grandTotal)}</strong>
            </div>
            <div className="summary-row summary-paid">
              <span>Paid Amount (₹)</span>
              <strong>{formatAmount(Number(paidAmount || 0))}</strong>
            </div>
            <div className="summary-row summary-balance">
              <span>Balance Amount (₹)</span>
              <strong>{formatAmount(Math.max(balanceAmount, 0))}</strong>
            </div>
          </div>

          {/* ACTION BUTTONS */}
          <div className="lab-action-buttons">
            <Button className="btn-generate" type="button" onClick={() => void saveBill()} disabled={savingBill}>
              {savingBill ? "Generating..." : "📄 Generate Bill"}
            </Button>
            <Button className="btn-save-print" type="button" onClick={() => void saveBillAndPrint()} disabled={savingBill}>
              💾 Save & Print
            </Button>
            <Button className="btn-print" variant="secondary" type="button" onClick={printLabBill}>
              🖨️ Print Bill
            </Button>
            <Button className="btn-email" variant="secondary" type="button" onClick={() => setNotice({ type: "success", message: "Email feature coming soon." })}>
              ✉️ Send via Email
            </Button>
            <Button className="btn-reset" variant="ghost" type="button" onClick={resetForm}>
              ⟲ Reset
            </Button>
          </div>
        </div>

        {/* EXISTING RECORDS */}
        <div className="lab-card lab-services-card provided-services-card">
          <h3>Existing Lab and Diagnostic Records</h3>
          
          <div className="lab-service-toolbar" style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <Input 
              value={historySearchQuery} 
              onChange={(event) => setHistorySearchQuery(event.target.value)} 
              placeholder="Search by patient name or last 4 digit UHID..." 
              aria-label="Search records by name or UHID" 
              style={{ flex: 1 }}
            />
            <Button 
              type="button" 
              onClick={printSelectedInvoices} 
              disabled={selectedInvoiceIds.length === 0}
              style={{ minWidth: "150px" }}
            >
              🖨️ Print Selected ({selectedInvoiceIds.length})
            </Button>
          </div>

          <div className="lab-table-section blue-section" style={{maxHeight: "400px", overflowY: "auto"}}>
            <table className="lab-billing-table">
              <thead>
                <tr>
                  <th style={{ width: "40px", textAlign: "center" }}>
                    <input 
                      type="checkbox" 
                      checked={filteredRecords.length > 0 && filteredRecords.every(r => selectedInvoiceIds.includes(r.id))} 
                      onChange={(e) => {
                        if (e.target.checked) {
                          const allIds = filteredRecords.map(r => r.id);
                          setSelectedInvoiceIds(prev => Array.from(new Set([...prev, ...allIds])));
                        } else {
                          const allIds = filteredRecords.map(r => r.id);
                          setSelectedInvoiceIds(prev => prev.filter(id => !allIds.includes(id)));
                        }
                      }}
                      style={{ cursor: "pointer", width: "16px", height: "16px" }}
                      aria-label="Select all records"
                    />
                  </th>
                  <th>Invoice</th>
                  <th>UHID</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Test</th>
                  <th>Amount (₹)</th>
                  <th>Paid (₹)</th>
                  <th>Due (₹)</th>
                  <th>Status</th>
                  <th>Print</th>
                </tr>
              </thead>
              <tbody>
                {loadingRecords ? (
                  <tr><td colSpan={11} className="lab-empty-row">Loading records...</td></tr>
                ) : filteredRecords.length === 0 ? (
                  <tr><td colSpan={11} className="lab-empty-row">No lab or diagnostic records available.</td></tr>
                ) : (
                  filteredRecords.slice(0, 50).map((record) => (
                    <tr key={record.id}>
                      <td style={{ textAlign: "center" }}>
                        <input 
                          type="checkbox" 
                          checked={selectedInvoiceIds.includes(record.id)} 
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedInvoiceIds([...selectedInvoiceIds, record.id]);
                            } else {
                              setSelectedInvoiceIds(selectedInvoiceIds.filter(id => id !== record.id));
                            }
                          }}
                          style={{ cursor: "pointer", width: "16px", height: "16px" }}
                          aria-label="Select record"
                        />
                      </td>
                      <td>{record.invoice_no || `DIAG-${record.id}`}</td>
                      <td>{record.patient_id || "-"}</td>
                      <td>{record.patient_name || "-"}</td>
                      <td>{record.doctor_name || "-"}</td>
                      <td>{record.test_name}</td>
                      <td>{formatAmount(Number(record.amount || 0))}</td>
                      <td>{formatAmount(Number(record.paid_amount || 0))}</td>
                      <td 
                        style={{ cursor: record.due_amount > 0 ? "pointer" : "default", color: record.due_amount > 0 ? "#2563eb" : "inherit", textDecoration: record.due_amount > 0 ? "underline" : "none" }}
                        onClick={() => {
                          if (record.due_amount > 0) {
                            loadBillIntoSummary(record);
                          }
                        }}
                      >
                        {formatAmount(Number(record.due_amount || 0))}
                      </td>
                      <td><span className={`status-badge status-${record.status || "due"}`}>{record.status || "due"}</span></td>
                      <td>
                        <Button 
                          type="button" 
                          variant="secondary" 
                          size="sm" 
                          onClick={() => printRecordBill(record)} 
                          style={{ padding: "2px 8px", fontSize: "12px", border: "1px solid #ccc" }}
                        >
                          🖨️ Print
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
