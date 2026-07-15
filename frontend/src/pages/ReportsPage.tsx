import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import StatCard from "../components/StatCard";
import { Input, Label } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import type { Notice, ReportsOverview } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

function formatCurrency(amount?: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount || 0);
}

type DoctorPayout = {
  id: number;
  doctor_name: string;
  payout_month: string;
  amount: number;
  paid_amount: number;
  due_amount: number;
  status?: string | null;
  paid_date?: string | null;
};

type BillingReportSummary = ReportsOverview["billing_summary"];

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function ReportsPage({ setNotice }: Props) {
  const [overview, setOverview] = useState<ReportsOverview | null>(null);
  const [doctorPayouts, setDoctorPayouts] = useState<DoctorPayout[]>([]);
  const [selectedReportDate, setSelectedReportDate] = useState(() => toDateInputValue(new Date()));
  const [datedBillingSummary, setDatedBillingSummary] = useState<BillingReportSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [data, doctorData] = await Promise.all([
          apiFetch<ReportsOverview>("/api/reports/overview"),
          apiFetch<{ payouts?: DoctorPayout[] }>("/api/accounts/doctors").catch(() => ({ payouts: [] as DoctorPayout[] })),
        ]);
        setOverview(data);
        setDoctorPayouts(doctorData.payouts || []);
      } catch (error) {
        reportError(setNotice, error as { message?: string; status?: number }, "Unable to load reports overview.");
        setOverview(null);
        setDoctorPayouts([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [setNotice]);

  useEffect(() => {
    const loadDatedSummary = async () => {
      if (!selectedReportDate) {
        setDatedBillingSummary(null);
        return;
      }
      try {
        const data = await apiFetch<BillingReportSummary>(`/api/reports/revenue-summary?date=${encodeURIComponent(selectedReportDate)}`);
        setDatedBillingSummary(data);
      } catch (error) {
        reportError(setNotice, error as { message?: string; status?: number }, "Unable to load day-wise collections.");
        setDatedBillingSummary(null);
      }
    };
    void loadDatedSummary();
  }, [selectedReportDate, setNotice]);

  const activeBillingSummary = datedBillingSummary || overview?.billing_summary;
  const collectionsByModule = useMemo(() => activeBillingSummary?.collections_by_module || [], [activeBillingSummary]);
  const paymentMethodRows = useMemo(() => activeBillingSummary?.payment_mode_breakdown || [], [activeBillingSummary]);
  const doctorPayoutRows = useMemo(() => {
    const grouped = new Map<string, { doctor_name: string; amount: number; paid_amount: number; due_amount: number; latest_month: string; status: string }>();
    doctorPayouts.forEach((payout) => {
      const name = (payout.doctor_name || "Unassigned Doctor").trim();
      const current = grouped.get(name) || { doctor_name: name, amount: 0, paid_amount: 0, due_amount: 0, latest_month: "", status: "pending" };
      current.amount += Number(payout.amount || 0);
      current.paid_amount += Number(payout.paid_amount || 0);
      current.due_amount += Number(payout.due_amount || 0);
      if (String(payout.payout_month || "") > current.latest_month) current.latest_month = String(payout.payout_month || "");
      current.status = current.due_amount <= 0 && current.paid_amount > 0 ? "paid" : current.paid_amount > 0 ? "partial" : "pending";
      grouped.set(name, current);
    });
    return Array.from(grouped.values()).sort((a, b) => b.paid_amount - a.paid_amount || a.doctor_name.localeCompare(b.doctor_name));
  }, [doctorPayouts]);
  const maxModuleCollectionValue = Math.max(1, ...collectionsByModule.map((row) => Number(row.count || 0)));
  const maxPaymentMethodValue = Math.max(1, ...paymentMethodRows.map((row) => Number(row.count || 0)));

  return (
    <section className="module-page revenue-reports-page">
      <div className="module-panel-head revenue-reports-title">
        <div>
          <h3>Revenue Reports</h3>
        </div>
      </div>

      <div className="revenue-reports-subhead">
        <h3>Collections by Module</h3>
        <p className="muted">Monitor amount collected per billing module and payment method.</p>
      </div>

      <div className="panel revenue-report-calendar-card">
        <Label>
          Select Collection Date
          <Input
            type="date"
            value={selectedReportDate}
            onChange={(event) => setSelectedReportDate(event.target.value)}
            aria-label="Reports collection date"
          />
        </Label>
        <div>
          <span>Day-wise Collected</span>
          <strong>{formatCurrency(activeBillingSummary?.total_collected)}</strong>
        </div>
        <div>
          <span>Day-wise Due</span>
          <strong>{formatCurrency(activeBillingSummary?.total_due)}</strong>
        </div>
      </div>

      {loading ? <p className="muted">Loading reports...</p> : null}

      <div className="stat-grid module-stat-grid revenue-report-summary-grid">
        <StatCard label="Total Billed" value={formatCurrency(activeBillingSummary?.total_billed)} />
        <StatCard label="Collected" value={formatCurrency(activeBillingSummary?.total_collected)} />
        <StatCard label="Pending Due" value={formatCurrency(activeBillingSummary?.total_due)} />
        <StatCard label="Advances" value={formatCurrency(activeBillingSummary?.total_advance)} />
        <StatCard label="Refunds" value={formatCurrency(activeBillingSummary?.total_refunded)} />
      </div>

      <div className="panel revenue-module-chart-card">
        <div className="module-panel-head">
          <h3>Collections by Module</h3>
        </div>
        {collectionsByModule.length === 0 ? (
          <p className="muted">No collection records available.</p>
        ) : (
          <div className="revenue-module-bars">
            {collectionsByModule.map((row) => (
              <div key={row.label} className="revenue-module-bar-row">
                <span>{row.label}</span>
                <div className="revenue-module-bar-track">
                  <div className="revenue-module-bar-fill" style={{ width: `${Number(row.count || 0) <= 0 ? 0 : Math.max(4, (Number(row.count || 0) / maxModuleCollectionValue) * 100)}%` }} />
                </div>
                <strong>{formatCurrency(row.count)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel revenue-module-chart-card">
        <div className="module-panel-head">
          <h3>Collections by Payment Method</h3>
        </div>
        {paymentMethodRows.length === 0 ? (
          <p className="muted">No payment method records available.</p>
        ) : (
          <div className="revenue-module-bars">
            {paymentMethodRows.map((row) => (
              <div key={row.label} className="revenue-module-bar-row">
                <span>{row.label}</span>
                <div className="revenue-module-bar-track">
                  <div className="revenue-module-bar-fill payment-method-fill" style={{ width: `${Number(row.count || 0) <= 0 ? 0 : Math.max(4, (Number(row.count || 0) / maxPaymentMethodValue) * 100)}%` }} />
                </div>
                <strong>{formatCurrency(row.count)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel revenue-doctor-payout-card">
        <div className="module-panel-head">
          <h3>Doctors Payout</h3>
        </div>
        {doctorPayoutRows.length === 0 ? (
          <p className="muted">No doctor payout records available.</p>
        ) : (
          <div className="doctor-payout-report-list">
            {doctorPayoutRows.map((payout) => (
              <div key={payout.doctor_name} className="doctor-payout-report-row">
                <div>
                  <strong>{payout.doctor_name}</strong>
                  <span>{payout.latest_month || "No month"} · {payout.status}</span>
                </div>
                <div>
                  <span>Paid</span>
                  <strong>{formatCurrency(payout.paid_amount)}</strong>
                </div>
                <div>
                  <span>Due</span>
                  <strong>{formatCurrency(payout.due_amount)}</strong>
                </div>
                <div>
                  <span>Total</span>
                  <strong>{formatCurrency(payout.amount)}</strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
