import { act } from "react";
import { createRoot } from "react-dom/client";
import OpQueuePage from "./OpQueuePage";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

describe("OpQueuePage", () => {
  test("renders OP queue dashboard and board columns", async () => {
    global.fetch = vi.fn((url: string) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/appointments")) {
        return jsonResponse({
          appointments: [
            {
              id: 1,
              patient_id: "PT-001",
              patient_name: "Asha Sharma",
              visit_type: "OP",
              appointment_date: "2026-06-10 09:30:00",
              status: "checked_in",
              token_no: 12,
              doctor_name: "Dr. Kumar",
              department: "General",
              age: "30",
              gender: "F",
            },
          ],
        });
      }
      if (requestUrl.includes("/api/registration/departments")) {
        return jsonResponse({ departments: [{ id: 1, department_name: "General" }] });
      }
      if (requestUrl.includes("/api/op/doctor-schedules")) {
        return jsonResponse({ schedules: [{ id: 1, doctor_name: "Dr. Kumar", department: "General" }] });
      }
      if (requestUrl.includes("/api/op/summary")) {
        return jsonResponse({
          date: "2026-06-10",
          total_appointments: 1,
          follow_ups: 0,
          active_queue: 1,
          no_shows: 0,
          reminders_sent: 0,
          available_doctors: 1,
        });
      }
      return jsonResponse({});
    }) as any;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<OpQueuePage setNotice={vi.fn()} />);
      await flush();
      await flush();
      await flush();
    });

    expect(container.textContent).toContain("OP Queue Dashboard");
    expect(container.textContent).toContain("Asha Sharma");
    expect(container.textContent).toContain("Available Doctors");
    expect(container.textContent).toContain("OP Queue Board");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
