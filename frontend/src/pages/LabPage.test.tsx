import { act } from "react";
import { createRoot } from "react-dom/client";
import LabPage from "./LabPage";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

function mockLocalStorage() {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
  });
}

describe("LabPage", () => {
  test("renders lab billing, print, and existing diagnostic records", async () => {
    mockLocalStorage();
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/lab/diagnostics")) {
        return jsonResponse({
          diagnostics: [
            {
              id: 1,
              invoice_no: "LAB-1001",
              patient_id: "PAT-20260617-7001",
              test_name: "Blood Test",
              order_status: "sample_collected",
              sample_barcode: "SMP-1",
              doctor_name: "Dr. Prime",
              amount: 500,
              paid_amount: 100,
              due_amount: 400,
            },
          ],
        });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<LabPage setNotice={vi.fn()} />);
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Patient & Visit Information");
    expect(container.textContent).toContain("Generate Bill");
    expect(container.textContent).toContain("Print Bill");
    expect(container.textContent).toContain("Existing Lab and Diagnostic Records");
    expect(container.textContent).toContain("UHID");
    expect(container.textContent).toContain("PAT-20260617-7001");
    expect(container.textContent).toContain("Blood Test");
    expect(container.querySelector('input[aria-label="Patient UHID"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Patient name"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Paid Amount"]')).toBeTruthy();
    expect(container.querySelector('select[aria-label="Lab category"]')).toBeTruthy();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
