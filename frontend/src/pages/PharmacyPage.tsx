import { useEffect, useMemo, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import StatCard from "../components/StatCard";
import { Button, ConfirmDialog, Input, Select, Table, TableCell, TableHead, TableRow } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import { formatDate } from "../lib/format";
import { fullPatientName, lookupPatientByUhid, normalizeUhidLookup } from "../lib/patientLookup";
import type { Notice, PharmacySale } from "../types";
import { PRINT_BRAND_HEADER_DATA_URI, PRINT_BRAND_LOGO_DATA_URI } from "../lib/printBrand";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

type PharmacySummary = {
  low_stock_count: number;
  out_of_stock_count: number;
  damaged_stock_count: number;
  sales_total: number;
};

type InventoryItem = {
  id: number;
  medicine_name: string;
  batch_no?: string;
  quantity?: number;
  reorder_level?: number;
  unit_price?: number;
  expiry_date?: string;
  stock_condition?: string;
};

type InventoryForm = {
  id: string;
  medicine_name: string;
  batch_no: string;
  quantity: string;
  reorder_level: string;
  unit_price: string;
  expiry_date: string;
  stock_condition: "proper" | "damaged";
};

type SaleForm = {
  invoice_id: string;
  patient_id: string;
  prescription_ref: string;
  medicine_name: string;
  quantity: string;
  unit_price: string;
  payment_mode: "cash" | "card" | "upi" | "bank";
};

type CartItem = {
  medicine_name: string;
  quantity: number;
  unit_price: number;
  batch_no: string;
  expiry_date: string;
};

type Supplier = {
  id: number;
  supplier_name: string;
  contact_person?: string;
  phone?: string;
  status?: string;
};

type Purchase = {
  id: number;
  supplier_id?: number | null;
  medicine_name: string;
  quantity?: number;
  unit_cost?: number;
  total_cost?: number;
  status?: string;
  expected_date?: string | null;
  received_date?: string | null;
};

type SupplierForm = {
  id: string;
  supplier_name: string;
  contact_person: string;
  phone: string;
  status: "active" | "inactive";
};

type PurchaseForm = {
  id: string;
  supplier_id: string;
  medicine_name: string;
  quantity: string;
  unit_cost: string;
  status: "ordered" | "received" | "cancelled";
  expected_date: string;
  received_date: string;
};

type PharmacyFilters = {
  search: string;
  condition: string;
  low_stock_only: boolean;
};

const EMPTY_SUMMARY: PharmacySummary = {
  low_stock_count: 0,
  out_of_stock_count: 0,
  damaged_stock_count: 0,
  sales_total: 0,
};

const DEFAULT_INVENTORY_FORM: InventoryForm = {
  id: "",
  medicine_name: "",
  batch_no: "",
  quantity: "",
  reorder_level: "",
  unit_price: "",
  expiry_date: "",
  stock_condition: "proper",
};

const DEFAULT_SALE_FORM: SaleForm = {
  invoice_id: "",
  patient_id: "",
  prescription_ref: "",
  medicine_name: "",
  quantity: "",
  unit_price: "",
  payment_mode: "cash",
};

const DEFAULT_SUPPLIER_FORM: SupplierForm = {
  id: "",
  supplier_name: "",
  contact_person: "",
  phone: "",
  status: "active",
};

const DEFAULT_PURCHASE_FORM: PurchaseForm = {
  id: "",
  supplier_id: "",
  medicine_name: "",
  quantity: "",
  unit_cost: "",
  status: "ordered",
  expected_date: "",
  received_date: "",
};

const DEFAULT_PHARMACY_FILTERS: PharmacyFilters = {
  search: "",
  condition: "",
  low_stock_only: false,
};

function formatCurrency(amount?: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount || 0);
}

function formatPaymentMode(value?: string | null) {
  const normalized = String(value || "cash").trim().toLowerCase();
  if (normalized === "upi") return "UPI";
  if (normalized === "card") return "Card";
  if (normalized === "bank") return "Bank Transfer";
  return "Cash";
}

function tenDigitPhone(value: string) {
  return value.replace(/\D/g, "").slice(0, 10);
}

export default function PharmacyPage({ setNotice }: Props) {
  const [summary, setSummary] = useState<PharmacySummary>(EMPTY_SUMMARY);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [sales, setSales] = useState<PharmacySale[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inventoryForm, setInventoryForm] = useState<InventoryForm>(DEFAULT_INVENTORY_FORM);
  const [saleForm, setSaleForm] = useState<SaleForm>(DEFAULT_SALE_FORM);
  const [saleCart, setSaleCart] = useState<CartItem[]>([]);
  const [salePatientName, setSalePatientName] = useState("");
  const [supplierForm, setSupplierForm] = useState<SupplierForm>(DEFAULT_SUPPLIER_FORM);
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm>(DEFAULT_PURCHASE_FORM);
  const [filters, setFilters] = useState<PharmacyFilters>(DEFAULT_PHARMACY_FILTERS);
  const [savingInventory, setSavingInventory] = useState(false);
  const [savingSale, setSavingSale] = useState(false);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [savingPurchase, setSavingPurchase] = useState(false);
  const [deletingItem, setDeletingItem] = useState<InventoryItem | null>(null);

  const visibleItems = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !search || item.medicine_name.toLowerCase().includes(search) || (item.batch_no || "").toLowerCase().includes(search);
      const condition = (item.stock_condition || "proper").toLowerCase();
      const matchesCondition = !filters.condition || condition === filters.condition;
      const quantity = Number(item.quantity || 0);
      const reorderLevel = Number(item.reorder_level || 0);
      const matchesLowStock = !filters.low_stock_only || quantity <= reorderLevel;
      return matchesSearch && matchesCondition && matchesLowStock;
    });
  }, [items, filters]);

  const visibleSales = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return sales.filter((sale) => {
      const matchesSearch =
        !search ||
        sale.medicine_name.toLowerCase().includes(search) ||
        String(sale.invoice_id || "").toLowerCase().includes(search);
      if (!matchesSearch) return false;
      if (!filters.low_stock_only) return true;
      const inventoryItem = items.find((item) => item.medicine_name === sale.medicine_name);
      const quantity = Number(inventoryItem?.quantity || 0);
      const reorderLevel = Number(inventoryItem?.reorder_level || 0);
      return quantity <= reorderLevel;
    });
  }, [sales, items, filters]);

  const loadPharmacy = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [summaryData, inventoryData, salesData, supplierData, purchaseData] = await Promise.all([
        apiFetch<PharmacySummary>("/api/pharmacy/summary"),
        apiFetch<{ items?: InventoryItem[] }>("/api/pharmacy/inventory"),
        apiFetch<{ sales?: PharmacySale[] }>("/api/pharmacy/sales"),
        apiFetch<{ suppliers?: Supplier[] }>("/api/pharmacy/suppliers"),
        apiFetch<{ purchases?: Purchase[] }>("/api/pharmacy/purchases"),
      ]);
      const fetchedItems = inventoryData.items || [];
      const fetchedSales = salesData.sales || [];
      const fetchedSuppliers = supplierData.suppliers || [];
      const fetchedPurchases = purchaseData.purchases || [];
      setSummary({ ...EMPTY_SUMMARY, ...summaryData });
      setItems(fetchedItems);
      setSales(fetchedSales);
      setSuppliers(fetchedSuppliers);
      setPurchases(fetchedPurchases);
      setSaleForm((current) => {
        if (current.medicine_name) return current;
        return {
          ...current,
          medicine_name: fetchedItems[0]?.medicine_name || "",
          unit_price: String(fetchedItems[0]?.unit_price ?? 0),
        };
      });
      setPurchaseForm((current) => {
        if (current.supplier_id || current.medicine_name) return current;
        return {
          ...current,
          supplier_id: fetchedSuppliers[0] ? String(fetchedSuppliers[0].id) : "",
          medicine_name: fetchedItems[0]?.medicine_name || "",
          unit_cost: String(fetchedItems[0]?.unit_price ?? 0),
        };
      });
    } catch (error) {
      const typedError = error as { message?: string; status?: number };
      setErrorMessage(typedError.message || "Unable to load pharmacy data.");
      reportError(setNotice, typedError, "Unable to load pharmacy data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPharmacy();
  }, []);

  const handleInventorySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const medicineName = inventoryForm.medicine_name.trim();
    if (!medicineName) {
      setNotice({ type: "error", message: "Medicine name is required." });
      return;
    }

    const payload = {
      id: inventoryForm.id ? Number(inventoryForm.id) : undefined,
      medicine_name: medicineName,
      batch_no: inventoryForm.batch_no.trim() || undefined,
      quantity: Number(inventoryForm.quantity) || 0,
      reorder_level: Number(inventoryForm.reorder_level) || 0,
      unit_price: Number(inventoryForm.unit_price) || 0,
      expiry_date: inventoryForm.expiry_date || undefined,
      stock_condition: inventoryForm.stock_condition || "proper",
    };

    setSavingInventory(true);
    try {
      await apiFetch("/api/pharmacy/inventory", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setInventoryForm({ ...DEFAULT_INVENTORY_FORM });
      setNotice({
        type: "success",
        message: inventoryForm.id ? `${medicineName} updated in pharmacy inventory.` : `${medicineName} added to pharmacy inventory.`,
      });
      await loadPharmacy();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save inventory item.");
    } finally {
      setSavingInventory(false);
    }
  };

  const handleAddMedicineToList = () => {
    const medicineName = saleForm.medicine_name.trim();
    if (!medicineName) {
      setNotice({ type: "error", message: "Select a medicine before adding." });
      return;
    }
    const qty = Number(saleForm.quantity);
    if (!qty || qty <= 0) {
      setNotice({ type: "error", message: "Quantity must be greater than zero." });
      return;
    }
    const price = Number(saleForm.unit_price);
    if (price < 0) {
      setNotice({ type: "error", message: "Unit price cannot be negative." });
      return;
    }

    const selectedItem = items.find((item) => item.medicine_name === medicineName);
    const batchNo = selectedItem?.batch_no || "-";
    const expiryDate = selectedItem?.expiry_date || "-";

    const existingIndex = saleCart.findIndex(item => item.medicine_name === medicineName);
    if (existingIndex > -1) {
      const updatedCart = [...saleCart];
      updatedCart[existingIndex].quantity += qty;
      updatedCart[existingIndex].unit_price = price;
      setSaleCart(updatedCart);
    } else {
      setSaleCart([
        ...saleCart,
        {
          medicine_name: medicineName,
          quantity: qty,
          unit_price: price,
          batch_no: batchNo,
          expiry_date: expiryDate
        }
      ]);
    }

    setNotice({ type: "success", message: `Added ${medicineName} to cart list.` });

    // Reset selector inputs
    setSaleForm(current => ({
      ...current,
      medicine_name: "",
      quantity: "",
      unit_price: ""
    }));
  };

  const handleSaleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    if (event) event.preventDefault();
    if (saleCart.length === 0) {
      setNotice({ type: "error", message: "Add at least one medicine to the cart before submitting." });
      return;
    }

    for (const item of saleCart) {
      if (item.quantity <= 0) {
        setNotice({ type: "error", message: `Quantity for ${item.medicine_name} must be greater than zero.` });
        return;
      }
      if (item.unit_price < 0) {
        setNotice({ type: "error", message: `Price for ${item.medicine_name} cannot be negative.` });
        return;
      }
    }

    const baseInvoiceId = saleForm.invoice_id.trim() || `PH-${Date.now()}`;
    setSavingSale(true);
    let successCount = 0;
    
    try {
      const createdSales: PharmacySale[] = [];
      for (const item of saleCart) {
        const payload = {
          invoice_id: baseInvoiceId,
          patient_id: saleForm.patient_id.trim() || undefined,
          prescription_ref: saleForm.prescription_ref.trim() || undefined,
          medicine_name: item.medicine_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          payment_mode: saleForm.payment_mode,
        };

        const res = await apiFetch<{ sale_id: number }>("/api/pharmacy/sales", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        
        createdSales.push({
          id: res.sale_id,
          invoice_id: baseInvoiceId,
          patient_id: saleForm.patient_id.trim() || undefined,
          prescription_ref: saleForm.prescription_ref.trim() || undefined,
          medicine_name: item.medicine_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          amount: item.quantity * item.unit_price,
          payment_mode: saleForm.payment_mode,
          sold_at: new Date().toISOString(),
        });
        successCount++;
      }

      setNotice({ 
        type: "success", 
        message: `Sale recorded with ${successCount} items (Invoice ID: ${baseInvoiceId}).` 
      });

      // Clear the cart and reset form
      setSaleCart([]);
      setSaleForm((current) => ({
        ...DEFAULT_SALE_FORM,
        medicine_name: items[0]?.medicine_name || "",
        unit_price: String(items[0]?.unit_price ?? 0)
      }));
      setSalePatientName("");
      await loadPharmacy();
      
      // Auto-trigger printing of this recorded bill!
      if (createdSales.length > 0) {
        let patientDetails = null;
        if (createdSales[0].patient_id) {
          patientDetails = await lookupPatientByUhid(createdSales[0].patient_id);
        }
        printPharmacyInvoice(createdSales[0], createdSales, patientDetails);
      }
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, `Failed to record all sales. Recorded ${successCount} items.`);
    } finally {
      setSavingSale(false);
    }
  };

  const printViaIframe = (html: string) => {
    const existing = document.getElementById("__hospai_print_frame__");
    if (existing) existing.remove();

    const iframe = document.createElement("iframe");
    iframe.id = "__hospai_print_frame__";
    iframe.setAttribute("style", "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;");
    document.body.appendChild(iframe);

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } finally {
          setTimeout(() => {
            try { iframe.remove(); URL.revokeObjectURL(url); } catch { /* ok */ }
          }, 3000);
        }
      }, 300);
    };

    iframe.src = url;
  };

  const printPharmacyInvoice = (sale: PharmacySale, invoiceSales: PharmacySale[], patientDetails: any) => {
    const safeText = (val: unknown) => {
      if (val === null || val === undefined) return "";
      return String(val)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    const patientName = patientDetails ? fullPatientName(patientDetails) || sale.patient_id || "-" : sale.patient_id || "-";
    const ageGender = patientDetails ? `${patientDetails.age || "-"} / ${patientDetails.gender || "-"}` : "-";
    const totalAmount = invoiceSales.reduce((sum, s) => sum + (s.amount || 0), 0);

    const paddedRowsHtml: string[] = [];
    const totalRowsNeeded = 8;

    for (let i = 0; i < totalRowsNeeded; i++) {
      const rowItem = invoiceSales[i];
      if (rowItem) {
        const matchedInv = items.find(inv => inv.medicine_name === rowItem.medicine_name);
        const batchNo = matchedInv?.batch_no || "-";
        const expiryDate = matchedInv?.expiry_date ? formatDate(matchedInv.expiry_date) : "-";
        paddedRowsHtml.push(`
          <tr>
            <td style="text-align: center; border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 6px;">${i + 1}</td>
            <td style="border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 6px;">${safeText(rowItem.medicine_name)}</td>
            <td style="text-align: center; border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 6px;">${safeText(batchNo)}</td>
            <td style="text-align: center; border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 6px;">${safeText(expiryDate)}</td>
            <td style="text-align: center; border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 6px;">${rowItem.quantity || 0}</td>
            <td style="text-align: right; border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 6px;">${(rowItem.unit_price || 0).toFixed(2)}</td>
            <td style="text-align: right; border-bottom: 1px solid #000; padding: 6px;">${(rowItem.amount || 0).toFixed(2)}</td>
          </tr>
        `);
      } else {
        paddedRowsHtml.push(`
          <tr>
            <td style="text-align: center; border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 6px; color: transparent;">${i + 1}</td>
            <td style="border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 6px;">&nbsp;</td>
            <td style="border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 6px;">&nbsp;</td>
            <td style="border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 6px;">&nbsp;</td>
            <td style="border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 6px;">&nbsp;</td>
            <td style="text-align: right; border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 6px; color: #aaa;">.00</td>
            <td style="text-align: right; border-bottom: 1px solid #000; padding: 6px; color: #aaa;">.00</td>
          </tr>
        `);
      }
    }

    const html = `<!doctype html>
<html>
<head>
  <title>Pharmacy Bill - ${safeText(sale.invoice_id || sale.id)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm;
    }
    * {
      box-sizing: border-box;
      font-family: Arial, Helvetica, sans-serif;
    }
    body {
      margin: 0;
      background: #fff;
      color: #000;
      font-size: 11px;
    }
    .bill-sheet {
      width: 100%;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .header-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
    }
    .header-left {
      width: 70%;
      vertical-align: top;
      text-align: left;
    }
    .header-right {
      width: 30%;
      vertical-align: top;
      text-align: right;
    }
    .brand-title {
      font-size: 15px;
      font-weight: bold;
      margin: 0 0 4px 0;
      text-transform: uppercase;
    }
    .brand-address {
      font-size: 10px;
      line-height: 1.4;
      color: #333;
      margin: 0;
    }
    .brand-logo {
      max-height: 75px;
      width: auto;
      object-fit: contain;
    }
    .info-grid {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 15px;
      border-top: 1px solid #000;
      border-bottom: 1px solid #000;
    }
    .info-cell {
      padding: 6px 4px;
      font-size: 10px;
      vertical-align: top;
    }
    .info-label {
      font-weight: bold;
      display: inline-block;
      width: 90px;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #000;
      margin-bottom: 10px;
    }
    .items-table th {
      border-right: 1px solid #000;
      border-bottom: 1px solid #000;
      padding: 6px;
      font-weight: bold;
      text-align: center;
      background-color: #f3f4f6;
      text-transform: uppercase;
      font-size: 9px;
    }
    .items-table th:last-child {
      border-right: none;
    }
    .total-row td {
      padding: 6px;
      font-weight: bold;
      border-bottom: 1px solid #000;
    }
    .payment-row td {
      padding: 6px;
      font-weight: bold;
    }
    .footer-section {
      width: 100%;
      border-top: 1px solid #000;
      padding-top: 10px;
      text-align: center;
      font-size: 10px;
      line-height: 1.4;
      margin-top: 20px;
    }
    .footer-brand {
      font-weight: bold;
      font-size: 11px;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
  </style>
</head>
<body>
  <div class="bill-sheet">
    <div>
      <!-- Header -->
      <table class="header-table">
        <tr>
          <td class="header-left">
            <h1 class="brand-title">M/s VERARA PHARMACY (RETAIL CUM WHOLESALE)</h1>
            <p class="brand-address">
              H.No.3-2-10/6, Chaitanya Nagar,<br />
              ManikondaJagir, Hyderabad, R.R.Dist.<br />
              Ph. 040-35884130, 9492194989
            </p>
          </td>
          <td class="header-right">
            <img class="brand-logo" src="${PRINT_BRAND_LOGO_DATA_URI}" alt="Logo" />
          </td>
        </tr>
      </table>

      <!-- Patient & Bill Info -->
      <table class="info-grid">
        <tr>
          <td class="info-cell" style="width: 50%;">
            <div><span class="info-label">Bill No</span>: ${safeText(sale.invoice_id || sale.id)}</div>
            <div style="margin-top: 4px;"><span class="info-label">Date</span>: ${safeText(formatDate(sale.sold_at))}</div>
            <div style="margin-top: 4px;"><span class="info-label">Patient Name</span>: ${safeText(patientName)}</div>
            <div style="margin-top: 4px;"><span class="info-label">Doctor Name</span>: ${safeText(sale.prescription_ref || "Dr. Verara Kumar, MBBS.MD.PGDHS")}</div>
            <div style="margin-top: 4px;"><span class="info-label">OP-Pharmacy</span></div>
          </td>
          <td class="info-cell" style="width: 50%;">
            <div><span class="info-label">Bill</span>: Retail Bill</div>
            <div style="margin-top: 4px;"><span class="info-label">Age/Gender</span>: ${safeText(ageGender)}</div>
            <div style="margin-top: 4px;"><span class="info-label">Store</span>: OP-Pharmacy</div>
            <div style="margin-top: 4px;"><span class="info-label">Bill Status</span>: PAID</div>
          </td>
        </tr>
      </table>

      <!-- Items Table -->
      <table class="items-table">
        <thead>
          <tr>
            <th style="width: 6%;">S.NO</th>
            <th style="width: 35%;">ITEM NAME</th>
            <th style="width: 15%;">BATCH NO</th>
            <th style="width: 12%;">EXPIRY</th>
            <th style="width: 10%;">QUANTITY</th>
            <th style="width: 10%;">MRP</th>
            <th style="width: 12%;">TOTAL AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          ${paddedRowsHtml.join("")}
          
          <!-- Total Row -->
          <tr class="total-row">
            <td style="border-right: 1px solid #000;">&nbsp;</td>
            <td style="border-right: 1px solid #000;">Total</td>
            <td style="border-right: 1px solid #000;">&nbsp;</td>
            <td style="border-right: 1px solid #000;">&nbsp;</td>
            <td style="border-right: 1px solid #000;">&nbsp;</td>
            <td style="text-align: right; border-right: 1px solid #000;">&nbsp;</td>
            <td style="text-align: right;">${totalAmount.toFixed(2)}</td>
          </tr>
          
          <!-- Payment Mode Row -->
          <tr class="payment-row">
            <td colspan="7">
              Payment Mode: ${safeText(formatPaymentMode(sale.payment_mode))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Footer -->
    <div class="footer-section">
      <div class="footer-brand">DR. VERARA LIFE MULTI SPECIALITY CLINICS & NURSING HOME</div>
      <div>H.No.3-2-10/6, Chaitanya Nagar, Manikonda Jagir, Hyderabad, R.R.Dist - 500089.</div>
      <div>Ph.040-35884130, 98497 05534, 9492194989 - call and register your appointment</div>
    </div>
  </div>
</body>
</html>`;

    printViaIframe(html);
  };

  const handlePrintInvoice = async (sale: PharmacySale) => {
    try {
      let patientDetails = null;
      if (sale.patient_id) {
        patientDetails = await lookupPatientByUhid(sale.patient_id);
      }
      
      const invoiceSales = sales.filter((s) => {
        if (sale.invoice_id) {
          return String(s.invoice_id) === String(sale.invoice_id);
        }
        return s.sold_at === sale.sold_at && s.patient_id === sale.patient_id;
      });

      printPharmacyInvoice(sale, invoiceSales, patientDetails);
    } catch (error) {
      setNotice({ type: "error", message: "Unable to load details for printing." });
    }
  };


  const handleSaleMedicineChange = (medicineName: string) => {
    const selected = items.find((item) => item.medicine_name === medicineName);
    setSaleForm((current) => ({
      ...current,
      medicine_name: medicineName,
      unit_price: String(selected?.unit_price ?? current.unit_price),
    }));
  };

  const fillSalePatient = async (value: string) => {
    const lookup = normalizeUhidLookup(value);
    if (!lookup) {
      setSalePatientName("");
      return;
    }
    try {
      const patient = await lookupPatientByUhid(lookup);
      if (!patient) {
        setSalePatientName("");
        setNotice({ type: "warning", message: "No patient found for that UHID / last 4 digits." });
        return;
      }
      setSaleForm((current) => ({ ...current, patient_id: patient.patient_id }));
      setSalePatientName(fullPatientName(patient) || patient.patient_id);
      setNotice({ type: "success", message: `Patient auto-filled: ${fullPatientName(patient) || patient.patient_id}.` });
    } catch {
      setSalePatientName("");
      setNotice({ type: "error", message: "Unable to auto-fill patient details." });
    }
  };

  const handleSupplierSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const supplierName = supplierForm.supplier_name.trim();
    if (!supplierName) {
      setNotice({ type: "error", message: "Supplier name is required." });
      return;
    }
    setSavingSupplier(true);
    try {
      const supplierId = Number(supplierForm.id);
      const path = supplierId ? `/api/pharmacy/suppliers/${supplierId}` : "/api/pharmacy/suppliers";
      await apiFetch(path, {
        method: supplierId ? "PUT" : "POST",
        body: JSON.stringify({
          supplier_name: supplierName,
          contact_person: supplierForm.contact_person.trim() || undefined,
          phone: supplierForm.phone.trim() || undefined,
          status: supplierForm.status || "active",
        }),
      });
      setSupplierForm({ ...DEFAULT_SUPPLIER_FORM });
      setNotice({ type: "success", message: supplierId ? "Supplier updated." : "Supplier added." });
      await loadPharmacy();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save supplier.");
    } finally {
      setSavingSupplier(false);
    }
  };

  const handlePurchaseSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const medicineName = purchaseForm.medicine_name.trim();
    const quantity = Number(purchaseForm.quantity) || 0;
    const unitCost = Number(purchaseForm.unit_cost) || 0;
    if (!medicineName || quantity <= 0 || unitCost < 0) {
      setNotice({ type: "error", message: "Medicine, quantity, and unit cost are required." });
      return;
    }
    setSavingPurchase(true);
    try {
      const purchaseId = Number(purchaseForm.id);
      const path = purchaseId ? `/api/pharmacy/purchases/${purchaseId}` : "/api/pharmacy/purchases";
      await apiFetch(path, {
        method: purchaseId ? "PUT" : "POST",
        body: JSON.stringify({
          supplier_id: purchaseForm.supplier_id ? Number(purchaseForm.supplier_id) : undefined,
          medicine_name: medicineName,
          quantity,
          unit_cost: unitCost,
          status: purchaseForm.status || "ordered",
          expected_date: purchaseForm.expected_date || undefined,
          received_date: purchaseForm.received_date || undefined,
        }),
      });
      setPurchaseForm((current) => ({
        ...DEFAULT_PURCHASE_FORM,
        supplier_id: current.supplier_id,
        medicine_name: current.medicine_name,
      }));
      setNotice({ type: "success", message: purchaseId ? "Purchase order updated." : "Purchase order created." });
      await loadPharmacy();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to save purchase order.");
    } finally {
      setSavingPurchase(false);
    }
  };

  const handleEditInventory = (item: InventoryItem) => {
    setInventoryForm({
      id: String(item.id),
      medicine_name: item.medicine_name,
      batch_no: item.batch_no || "",
      quantity: String(item.quantity ?? 0),
      reorder_level: String(item.reorder_level ?? 10),
      unit_price: String(item.unit_price ?? 0),
      expiry_date: item.expiry_date || "",
      stock_condition: item.stock_condition === "damaged" ? "damaged" : "proper",
    });
  };

  const handleEditSupplier = (supplier: Supplier) => {
    setSupplierForm({
      id: String(supplier.id),
      supplier_name: supplier.supplier_name,
      contact_person: supplier.contact_person || "",
      phone: supplier.phone || "",
      status: supplier.status === "inactive" ? "inactive" : "active",
    });
  };

  const handleDeleteSupplier = async (supplier: Supplier) => {
    if (!window.confirm(`Delete supplier ${supplier.supplier_name}?`)) return;
    try {
      await apiFetch(`/api/pharmacy/suppliers/${supplier.id}`, { method: "DELETE" });
      setNotice({ type: "success", message: "Supplier deleted." });
      await loadPharmacy();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to delete supplier.");
    }
  };

  const handleEditPurchase = (purchase: Purchase) => {
    setPurchaseForm({
      id: String(purchase.id),
      supplier_id: purchase.supplier_id ? String(purchase.supplier_id) : "",
      medicine_name: purchase.medicine_name,
      quantity: String(purchase.quantity ?? 1),
      unit_cost: String(purchase.unit_cost ?? 0),
      status: purchase.status === "received" ? "received" : purchase.status === "cancelled" ? "cancelled" : "ordered",
      expected_date: purchase.expected_date || "",
      received_date: purchase.received_date || "",
    });
  };

  const handleDeletePurchase = async (purchase: Purchase) => {
    if (!window.confirm(`Delete purchase order ${purchase.id}?`)) return;
    try {
      await apiFetch(`/api/pharmacy/purchases/${purchase.id}`, { method: "DELETE" });
      setNotice({ type: "success", message: "Purchase order deleted." });
      await loadPharmacy();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to delete purchase order.");
    }
  };

  const confirmDeleteInventory = async () => {
    if (!deletingItem) return;
    try {
      await apiFetch(`/api/pharmacy/inventory/${deletingItem.id}`, { method: "DELETE" });
      setNotice({ type: "success", message: `${deletingItem.medicine_name} removed from inventory.` });
      setDeletingItem(null);
      if (inventoryForm.id && Number(inventoryForm.id) === deletingItem.id) {
        setInventoryForm({ ...DEFAULT_INVENTORY_FORM });
      }
      await loadPharmacy();
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to delete inventory item.");
      setDeletingItem(null);
    }
  };

  return (
    <section className="module-page">
      <div className="stat-grid module-stat-grid">
        <StatCard label="Low Stock" value={summary.low_stock_count} />
        <StatCard label="Out of Stock" value={summary.out_of_stock_count} />
        <StatCard label="Damaged Items" value={summary.damaged_stock_count} />
        <StatCard label="Sales Total" value={formatCurrency(summary.sales_total)} />
      </div>

      <div className="panel">
        <div className="module-panel-head">
          <h3>Add Medicine to Inventory</h3>
        </div>
        <form className="module-form-grid" onSubmit={handleInventorySubmit}>
          <Input
            required
            value={inventoryForm.medicine_name}
            onChange={(event) => setInventoryForm((current) => ({ ...current, medicine_name: event.target.value }))}
            placeholder="Medicine name"
            aria-label="Medicine name"
          />
          <Input
            value={inventoryForm.batch_no}
            onChange={(event) => setInventoryForm((current) => ({ ...current, batch_no: event.target.value }))}
            placeholder="Batch number"
            aria-label="Batch number"
          />
          <Input
            type="number"
            min={0}
            value={inventoryForm.quantity}
            onChange={(event) => setInventoryForm((current) => ({ ...current, quantity: event.target.value }))}
            placeholder="Quantity"
            aria-label="Quantity"
          />
          <Input
            type="number"
            min={0}
            value={inventoryForm.reorder_level}
            onChange={(event) => setInventoryForm((current) => ({ ...current, reorder_level: event.target.value }))}
            placeholder="Reorder level"
            aria-label="Reorder level"
          />
          <Input
            type="number"
            min={0}
            value={inventoryForm.unit_price}
            onChange={(event) => setInventoryForm((current) => ({ ...current, unit_price: event.target.value }))}
            placeholder="Unit price"
            aria-label="Unit price"
          />
          <Input
            type="date"
            value={inventoryForm.expiry_date}
            onChange={(event) => setInventoryForm((current) => ({ ...current, expiry_date: event.target.value }))}
            aria-label="Expiry date"
          />
          <Select
            value={inventoryForm.stock_condition}
            onChange={(event) =>
              setInventoryForm((current) => ({ ...current, stock_condition: event.target.value as "proper" | "damaged" }))
            }
            aria-label="Stock condition"
          >
            <option value="proper">Proper</option>
            <option value="damaged">Damaged</option>
          </Select>
          <Button type="submit" disabled={savingInventory}>
            {savingInventory ? "Saving..." : inventoryForm.id ? "Update Medicine" : "Add Medicine"}
          </Button>
          {inventoryForm.id ? (
            <Button type="button" variant="ghost" onClick={() => setInventoryForm({ ...DEFAULT_INVENTORY_FORM })}>
              Cancel Edit
            </Button>
          ) : null}
        </form>
      </div>

      <div className="panel">
        <div className="module-panel-head">
          <h3>Record Pharmacy Sale</h3>
        </div>
        <form className="module-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1rem" }} onSubmit={(e) => e.preventDefault()}>
          <Input
            value={saleForm.invoice_id}
            onChange={(event) => setSaleForm((current) => ({ ...current, invoice_id: event.target.value }))}
            placeholder="Invoice ID (optional)"
            aria-label="Invoice ID"
          />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Input
              value={saleForm.patient_id}
              onChange={(event) => { setSaleForm((current) => ({ ...current, patient_id: event.target.value })); setSalePatientName(""); }}
              onBlur={(event) => void fillSalePatient(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void fillSalePatient((event.currentTarget as HTMLInputElement).value); } }}
              placeholder="UHID / last 4 digits"
              aria-label="Sale patient id"
            />
            {salePatientName ? <span style={{ fontSize: "12px", color: "var(--primary-color)", marginTop: "4px" }}>Patient: {salePatientName}</span> : null}
          </div>
          <Input
            value={saleForm.prescription_ref}
            onChange={(event) => setSaleForm((current) => ({ ...current, prescription_ref: event.target.value }))}
            placeholder="Prescription ref"
            aria-label="Prescription reference"
          />
          <Select
            value={saleForm.payment_mode}
            onChange={(event) => setSaleForm((current) => ({ ...current, payment_mode: event.target.value as SaleForm["payment_mode"] }))}
            aria-label="Pharmacy sale payment mode"
          >
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="upi">UPI</option>
            <option value="bank">Bank Transfer</option>
          </Select>
        </form>

        <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "1rem", marginTop: "1rem" }}>
          <h4 style={{ marginBottom: "0.5rem" }}>Select Tablet / Medicine</h4>
          <div className="module-form-grid module-sales-grid" style={{ alignItems: "center" }}>
            <Select
              value={saleForm.medicine_name}
              onChange={(event) => handleSaleMedicineChange(event.target.value)}
              aria-label="Medicine for sale"
            >
              <option value="">Select medicine</option>
              {items.map((item) => (
                <option key={`sale-${item.id}`} value={item.medicine_name}>
                  {item.medicine_name}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              min={1}
              value={saleForm.quantity}
              onChange={(event) => setSaleForm((current) => ({ ...current, quantity: event.target.value }))}
              placeholder="Quantity"
              aria-label="Sale quantity"
            />
            <Input
              type="number"
              min={0}
              value={saleForm.unit_price}
              onChange={(event) => setSaleForm((current) => ({ ...current, unit_price: event.target.value }))}
              placeholder="Unit price"
              aria-label="Sale unit price"
            />
            <Button type="button" onClick={handleAddMedicineToList} disabled={items.length === 0}>
              Add Tablet
            </Button>
          </div>
        </div>

        {/* Cart list section */}
        {saleCart.length > 0 ? (
          <div style={{ marginTop: "1.5rem", border: "1px solid var(--border-color)", borderRadius: "8px", padding: "1rem", backgroundColor: "var(--panel-bg)" }}>
            <h4 style={{ marginBottom: "1rem" }}>Added Medicines (Visible before confirming)</h4>
            <Table className="module-table" role="table" aria-label="Medicines to sale">
              <TableHead style={{ gridTemplateColumns: "0.5fr 1.5fr 1fr 1fr 1fr 1.1fr 1fr 1.2fr" }}>
                <TableCell>S.No</TableCell>
                <TableCell>Medicine</TableCell>
                <TableCell>Batch</TableCell>
                <TableCell>Expiry</TableCell>
                <TableCell>Quantity</TableCell>
                <TableCell>MRP (₹)</TableCell>
                <TableCell>Total (₹)</TableCell>
                <TableCell>Actions</TableCell>
              </TableHead>
              {saleCart.map((cartItem, idx) => {
                const itemTotal = cartItem.quantity * cartItem.unit_price;
                return (
                  <TableRow key={`cart-${idx}`} style={{ gridTemplateColumns: "0.5fr 1.5fr 1fr 1fr 1fr 1.1fr 1fr 1.2fr" }}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell style={{ fontWeight: "bold" }}>{cartItem.medicine_name}</TableCell>
                    <TableCell>{cartItem.batch_no}</TableCell>
                    <TableCell>{formatDate(cartItem.expiry_date)}</TableCell>
                    <TableCell style={{ display: "flex", alignItems: "center" }}>
                      <Input
                        type="number"
                        min={1}
                        value={cartItem.quantity}
                        onChange={(e) => {
                          const newQty = Number(e.target.value) || 0;
                          const updated = [...saleCart];
                          updated[idx].quantity = newQty;
                          setSaleCart(updated);
                        }}
                        style={{ width: "85px" }}
                        aria-label="Cart item quantity"
                      />
                    </TableCell>
                    <TableCell style={{ display: "flex", alignItems: "center" }}>
                      <Input
                        type="number"
                        min={0}
                        value={cartItem.unit_price}
                        onChange={(e) => {
                          const newPrice = Number(e.target.value) || 0;
                          const updated = [...saleCart];
                          updated[idx].unit_price = newPrice;
                          setSaleCart(updated);
                        }}
                        style={{ width: "100px" }}
                        aria-label="Cart item price"
                      />
                    </TableCell>
                    <TableCell>{formatCurrency(itemTotal)}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          const updated = saleCart.filter((_, i) => i !== idx);
                          setSaleCart(updated);
                        }}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </Table>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
              <span style={{ fontSize: "1.1rem", fontWeight: "bold" }}>
                Grand Total: {formatCurrency(saleCart.reduce((sum, item) => sum + item.quantity * item.unit_price, 0))}
              </span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSaleCart([])}
                >
                  Clear Cart
                </Button>
                <Button type="button" onClick={() => void handleSaleSubmit()} disabled={savingSale}>
                  {savingSale ? "Saving..." : "Add Medicine"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {items.length === 0 ? <p className="muted">Add inventory first before recording a sale.</p> : null}
      </div>

      <div className="split">
        <div className="panel">
          <div className="module-panel-head">
            <h3>Suppliers</h3>
          </div>
          <form className="module-form-grid" onSubmit={handleSupplierSubmit}>
            <Input
              required
              value={supplierForm.supplier_name}
              onChange={(event) => setSupplierForm((current) => ({ ...current, supplier_name: event.target.value }))}
              placeholder="Supplier name"
              aria-label="Supplier name"
            />
            <Input
              value={supplierForm.contact_person}
              onChange={(event) => setSupplierForm((current) => ({ ...current, contact_person: event.target.value }))}
              placeholder="Contact person"
              aria-label="Supplier contact person"
            />
            <Input
              value={supplierForm.phone}
              onChange={(event) => setSupplierForm((current) => ({ ...current, phone: tenDigitPhone(event.target.value) }))}
              maxLength={10}
              inputMode="numeric"
              pattern="[0-9]{10}"
              placeholder="Phone"
              aria-label="Supplier phone"
            />
            <Select
              value={supplierForm.status}
              onChange={(event) => setSupplierForm((current) => ({ ...current, status: event.target.value as "active" | "inactive" }))}
              aria-label="Supplier status"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
            <Button type="submit" disabled={savingSupplier}>
              {savingSupplier ? "Saving..." : supplierForm.id ? "Update Supplier" : "Add Supplier"}
            </Button>
          </form>
          {suppliers.slice(0, 6).map((supplier) => (
            <article className="module-mobile-card" key={`supplier-${supplier.id}`}>
              <h4>{supplier.supplier_name}</h4>
              <p><strong>Contact:</strong> {supplier.contact_person || "-"}</p>
              <p><strong>Phone:</strong> {supplier.phone || "-"}</p>
              <p><strong>Status:</strong> {supplier.status || "active"}</p>
              <div className="module-card-actions">
                <Button type="button" size="sm" onClick={() => handleEditSupplier(supplier)}>Edit</Button>
                <Button type="button" size="sm" variant="destructive" onClick={() => void handleDeleteSupplier(supplier)}>Delete</Button>
              </div>
            </article>
          ))}
        </div>

        <div className="panel">
          <div className="module-panel-head">
            <h3>Procurement</h3>
          </div>
          <form className="module-form-grid" onSubmit={handlePurchaseSubmit}>
            <Select
              value={purchaseForm.supplier_id}
              onChange={(event) => setPurchaseForm((current) => ({ ...current, supplier_id: event.target.value }))}
              aria-label="Purchase supplier"
            >
              <option value="">Select supplier</option>
              {suppliers.map((supplier) => (
                <option key={`purchase-supplier-${supplier.id}`} value={supplier.id}>
                  {supplier.supplier_name}
                </option>
              ))}
            </Select>
            <Input
              value={purchaseForm.medicine_name}
              onChange={(event) => setPurchaseForm((current) => ({ ...current, medicine_name: event.target.value }))}
              placeholder="Medicine name"
              aria-label="Purchase medicine"
            />
            <Input
              type="number"
              min={1}
              value={purchaseForm.quantity}
              onChange={(event) => setPurchaseForm((current) => ({ ...current, quantity: event.target.value }))}
              placeholder="Quantity"
              aria-label="Purchase quantity"
            />
            <Input
              type="number"
              min={0}
              value={purchaseForm.unit_cost}
              onChange={(event) => setPurchaseForm((current) => ({ ...current, unit_cost: event.target.value }))}
              placeholder="Unit cost"
              aria-label="Purchase unit cost"
            />
            <Select
              value={purchaseForm.status}
              onChange={(event) => setPurchaseForm((current) => ({ ...current, status: event.target.value as "ordered" | "received" | "cancelled" }))}
              aria-label="Purchase status"
            >
              <option value="ordered">Ordered</option>
              <option value="received">Received</option>
              <option value="cancelled">Cancelled</option>
            </Select>
            <Input
              type="date"
              value={purchaseForm.expected_date}
              onChange={(event) => setPurchaseForm((current) => ({ ...current, expected_date: event.target.value }))}
              aria-label="Expected delivery date"
            />
            <Input
              type="date"
              value={purchaseForm.received_date}
              onChange={(event) => setPurchaseForm((current) => ({ ...current, received_date: event.target.value }))}
              aria-label="Received date"
            />
            <Button type="submit" disabled={savingPurchase}>
              {savingPurchase ? "Saving..." : purchaseForm.id ? "Update Order" : "Create Order"}
            </Button>
          </form>
        </div>
      </div>

      <div className="panel">
        <div className="module-panel-head">
          <h3>Inventory Snapshot</h3>
        </div>

        <form className="module-form-grid module-filter-grid" onSubmit={(event) => event.preventDefault()}>
          <Input
            value={filters.search}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            placeholder="Search medicine or batch"
            aria-label="Pharmacy filter search"
          />
          <Select
            value={filters.condition}
            onChange={(event) => setFilters((current) => ({ ...current, condition: event.target.value }))}
            aria-label="Pharmacy filter condition"
          >
            <option value="">All Conditions</option>
            <option value="proper">Proper</option>
            <option value="damaged">Damaged</option>
          </Select>
          <Select
            value={filters.low_stock_only ? "yes" : "no"}
            onChange={(event) => setFilters((current) => ({ ...current, low_stock_only: event.target.value === "yes" }))}
            aria-label="Pharmacy filter low stock"
          >
            <option value="no">All Stock Levels</option>
            <option value="yes">Low Stock Only</option>
          </Select>
          <div className="module-inline-actions">
            <Button type="button" variant="ghost" onClick={() => setFilters({ ...DEFAULT_PHARMACY_FILTERS })}>Reset</Button>
          </div>
        </form>

        {loading ? <p className="muted">Loading pharmacy inventory...</p> : null}
        {errorMessage ? <p className="notice error">{errorMessage}</p> : null}
        {!loading && !errorMessage && visibleItems.length === 0 ? <p className="muted">No inventory records available for this filter.</p> : null}

        {!loading && !errorMessage && visibleItems.length > 0 ? (
          <>
            <Table className="module-table module-table-pharmacy" role="table" aria-label="Pharmacy inventory table">
              <TableHead>
                <TableCell>Medicine</TableCell>
                <TableCell>Batch</TableCell>
                <TableCell>Quantity</TableCell>
                <TableCell>Reorder</TableCell>
                <TableCell>Price</TableCell>
                <TableCell>Condition</TableCell>
                <TableCell>Actions</TableCell>
              </TableHead>
              {visibleItems.slice(0, 14).map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.medicine_name}</TableCell>
                  <TableCell>{item.batch_no || "-"}</TableCell>
                  <TableCell>{item.quantity ?? 0}</TableCell>
                  <TableCell>{item.reorder_level ?? 0}</TableCell>
                  <TableCell>{formatCurrency(item.unit_price)}</TableCell>
                  <TableCell>{item.stock_condition || "proper"}</TableCell>
                  <TableCell>
                    <div className="module-inline-actions">
                      <Button type="button" size="sm" onClick={() => handleEditInventory(item)}>Edit</Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => setDeletingItem(item)}>Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </Table>

            <div className="module-mobile-list" aria-label="Pharmacy inventory cards">
              {visibleItems.slice(0, 14).map((item) => (
                <article className="module-mobile-card" key={`mobile-${item.id}`}>
                  <h4>{item.medicine_name}</h4>
                  <p><strong>Batch:</strong> {item.batch_no || "-"}</p>
                  <p><strong>Quantity:</strong> {item.quantity ?? 0}</p>
                  <p><strong>Reorder Level:</strong> {item.reorder_level ?? 0}</p>
                  <p><strong>Unit Price:</strong> {formatCurrency(item.unit_price)}</p>
                  <p><strong>Condition:</strong> {item.stock_condition || "proper"}</p>
                  <div className="module-card-actions">
                    <Button type="button" size="sm" onClick={() => handleEditInventory(item)}>Edit</Button>
                    <Button type="button" size="sm" variant="destructive" onClick={() => setDeletingItem(item)}>Delete</Button>
                  </div>
                  <p className="muted"><strong>Expiry:</strong> {formatDate(item.expiry_date)}</p>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="panel">
        <div className="module-panel-head">
          <h3>Sales Report</h3>
        </div>
        {purchases.length > 0 ? (
          <div className="module-mobile-list" style={{ display: "grid" }} aria-label="Pharmacy purchase cards">
            {purchases.slice(0, 6).map((purchase) => (
              <article className="module-mobile-card" key={`purchase-${purchase.id}`}>
                <h4>{purchase.medicine_name}</h4>
                <p><strong>Supplier:</strong> {purchase.supplier_id ? suppliers.find((item) => item.id === purchase.supplier_id)?.supplier_name || `#${purchase.supplier_id}` : "-"}</p>
                <p><strong>Qty:</strong> {purchase.quantity ?? 0}</p>
                <p><strong>Status:</strong> {purchase.status || "ordered"}</p>
                <p><strong>Total:</strong> {formatCurrency(purchase.total_cost)}</p>
                <div className="module-card-actions">
                  <Button type="button" size="sm" onClick={() => handleEditPurchase(purchase)}>Edit</Button>
                  <Button type="button" size="sm" variant="destructive" onClick={() => void handleDeletePurchase(purchase)}>Delete</Button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
        {!loading && !errorMessage && visibleSales.length === 0 ? <p className="muted">No pharmacy sales recorded yet.</p> : null}
        {!loading && !errorMessage && visibleSales.length > 0 ? (
          <>
            <Table className="module-table" role="table" aria-label="Pharmacy sales report table">
              <TableHead style={{ gridTemplateColumns: "1.2fr 1.5fr 1fr 1fr 0.8fr 1fr 1fr 1fr" }}>
                <TableCell>Sold At</TableCell>
                <TableCell>Medicine</TableCell>
                <TableCell>Patient</TableCell>
                <TableCell>Rx Ref</TableCell>
                <TableCell>Quantity</TableCell>
                <TableCell>Amount</TableCell>
                <TableCell>Payment Mode</TableCell>
                <TableCell>Actions</TableCell>
              </TableHead>
              {visibleSales.slice(0, 14).map((sale) => (
                <TableRow key={sale.id} style={{ gridTemplateColumns: "1.2fr 1.5fr 1fr 1fr 0.8fr 1fr 1fr 1fr" }}>
                  <TableCell>{formatDate(sale.sold_at)}</TableCell>
                  <TableCell>{sale.medicine_name}</TableCell>
                  <TableCell>{sale.patient_id || "-"}</TableCell>
                  <TableCell>{sale.prescription_ref || "-"}</TableCell>
                  <TableCell>{sale.quantity ?? 0}</TableCell>
                  <TableCell>{formatCurrency(sale.amount)}</TableCell>
                  <TableCell>{formatPaymentMode(sale.payment_mode)}</TableCell>
                  <TableCell style={{ display: "flex", alignItems: "center" }}>
                    <Button type="button" size="sm" onClick={() => void handlePrintInvoice(sale)}>
                      Print Bill
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </Table>

            <div className="module-mobile-list" aria-label="Pharmacy sales report cards">
              {visibleSales.slice(0, 14).map((sale) => (
                <article className="module-mobile-card" key={`sale-mobile-${sale.id}`}>
                  <h4>{sale.medicine_name}</h4>
                  <p><strong>Patient:</strong> {sale.patient_id || "-"}</p>
                  <p><strong>Prescription:</strong> {sale.prescription_ref || "-"}</p>
                  <p><strong>Quantity:</strong> {sale.quantity ?? 0}</p>
                  <p><strong>Amount:</strong> {formatCurrency(sale.amount)}</p>
                  <p><strong>Payment:</strong> {formatPaymentMode(sale.payment_mode)}</p>
                  <div className="module-card-actions">
                    <Button type="button" size="sm" onClick={() => void handlePrintInvoice(sale)}>Print Bill</Button>
                  </div>
                  <p className="muted"><strong>Sold:</strong> {formatDate(sale.sold_at)}</p>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <ConfirmDialog
        open={Boolean(deletingItem)}
        title="Delete inventory item"
        description={deletingItem ? `This will permanently remove ${deletingItem.medicine_name} from inventory.` : ""}
        confirmLabel="Delete"
        loading={false}
        onClose={() => setDeletingItem(null)}
        onConfirm={() => void confirmDeleteInventory()}
      />
    </section>
  );
}
