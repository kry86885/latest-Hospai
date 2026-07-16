import { act } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import AddPatientPage from "./AddPatientPage";

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

describe("AddPatientPage", () => {
  test("renders patient registration and document upload sections", async () => {
    mockLocalStorage();
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/patients/next-id")) {
        return jsonResponse({ patient_id: "HSP1001" });
      }
      if (requestUrl.includes("/api/registration/departments")) {
        return jsonResponse({ departments: [{ id: 1, department_name: "General" }] });
      }
      if (requestUrl.includes("/api/op/doctor-schedules")) {
        return jsonResponse({ schedules: [{ doctor_name: "Dr. Rao", department: "General", consultation_fee: 200, review_fee: 150 }] });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AddPatientPage
          onCreate={vi.fn(async () => null)}
          selectedPatient={null}
          ocrLanguage="en"
          setNotice={vi.fn()}
        />
      );
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("Patient Registration");
    expect(container.textContent).toContain("Primary Mobile");
    expect(container.textContent).toContain("Register Patient");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  test("auto-fills appointment fields after searching an existing patient", async () => {
    mockLocalStorage();
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/patients/next-id")) {
        return jsonResponse({ patient_id: "HSP1002" });
      }
      if (requestUrl.includes("/api/patients?q=")) {
        return jsonResponse({ patients: [{ patient_id: "HSP1002", name: "Asha", middle_name: "", last_name: "Menon", phone: "9999999999", department: "General" }] });
      }
      if (requestUrl.includes("/api/registration/departments")) {
        return jsonResponse({ departments: [{ id: 1, department_name: "General" }] });
      }
      if (requestUrl.includes("/api/op/doctor-schedules")) {
        return jsonResponse({ schedules: [{ doctor_name: "Dr. Rao", department: "General", consultation_fee: 200, review_fee: 150 }] });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AddPatientPage
          onCreate={vi.fn(async () => null)}
          selectedPatient={null}
          ocrLanguage="en"
          setNotice={vi.fn()}
        />
      );
      await flush();
      await flush();
      await flush();
    });

    const searchInput = container.querySelector('input[placeholder*="Search by Patient ID"]') as HTMLInputElement | null;
    const searchButton = screen.getByRole("button", { name: /search patient/i });

    await act(async () => {
      if (searchInput) {
        fireEvent.change(searchInput, { target: { value: "HSP1002" } });
      }
      fireEvent.click(searchButton);
      await flush();
      await flush();
      await flush();
    });

    const patientNameInput = container.querySelector('input[placeholder="Walk-in or existing patient"]') as HTMLInputElement | null;
    const departmentSelect = Array.from(container.querySelectorAll('select')).find((select) => {
      return Array.from(select.options).some((opt) => opt.value === "General");
    }) as HTMLSelectElement | null;
    
    await waitFor(() => {
      expect(patientNameInput?.value).toBe("Asha Menon");
    });

    expect(container.textContent).toContain("Existing Patient");
    expect(departmentSelect?.value).toBe("General");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
