/**
 * HospAI E2E Test Helpers
 * Shared utility functions for all Puppeteer-based E2E tests.
 * Required by all test suites in frontend/tests/e2e/
 */

"use strict";

const path = require("path");
const fs = require("fs");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:5173";
const API_BASE = process.env.E2E_API_BASE || "http://localhost:5001";
const E2E_USERNAME = process.env.E2E_USERNAME || "Dr. PRABHU";
const E2E_PASSWORD = process.env.E2E_PASSWORD || "Dr. PRABHU@123";

// ---------------------------------------------------------------------------
// Sample file for document upload tests
// ---------------------------------------------------------------------------

// Create a small in-memory sample PDF/PNG at a temp path for upload tests.
const SAMPLE_READMIT_DOC = (() => {
  const tmpDir = path.join(__dirname, "..", "artifacts", "_tmp");
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
  } catch (_) { /* no-op */ }
  const filePath = path.join(tmpDir, "sample_readmit_doc.txt");
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "E2E sample readmit document content.");
    }
  } catch (_) { /* no-op */ }
  return filePath;
})();

// ---------------------------------------------------------------------------
// Unique helpers
// ---------------------------------------------------------------------------

let _suffixCounter = 0;

function uniqueSuffix() {
  _suffixCounter += 1;
  return `${Date.now()}${String(_suffixCounter).padStart(3, "0")}`;
}

function uniquePhone() {
  return `555${String(Math.floor(Math.random() * 9000000) + 1000000)}`;
}

// ---------------------------------------------------------------------------
// Auth token management (shared across page visits)
// ---------------------------------------------------------------------------

let _cachedAuthToken = null;

async function _getAuthToken() {
  if (_cachedAuthToken) return _cachedAuthToken;

  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: E2E_USERNAME, password: E2E_PASSWORD }),
  });

  if (!response.ok) {
    throw new Error(`Login failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  _cachedAuthToken = data.token || data.access_token || null;
  return _cachedAuthToken;
}

// ---------------------------------------------------------------------------
// Page helpers (require global `page` from jest-puppeteer)
// ---------------------------------------------------------------------------

/**
 * Ensure the user is logged in. Navigates to the app, performs login if needed.
 */
async function ensureLoggedIn() {
  if (!global.page || global.page.isClosed()) {
    if (global.browser) global.page = await global.browser.newPage();
    else throw new Error("No browser/page available");
  }

  const currentUrl = page.url();
  // Navigate to app if not already there
  if (!currentUrl.startsWith(BASE_URL)) {
    await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 60000 });
  }

  // Check if already logged in
  const isLoggedIn = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.some((btn) => (btn.textContent || "").trim().toLowerCase().includes("log out") ||
                                  (btn.textContent || "").trim().toLowerCase().includes("logout"));
  });

  if (!isLoggedIn) {
    // Navigate to login if not already there
    const hasLoginForm = await page.evaluate(() => !!document.querySelector("input[type='password']"));
    if (!hasLoginForm) {
      await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 60000 });
    }

    await page.waitForSelector("input[type='password']", { timeout: 20000 });

    // Fill credentials
    const usernameInput = await page.$("input[type='text'], input[name='username'], input[placeholder*='Username'], input[placeholder*='username']");
    if (usernameInput) {
      await usernameInput.click({ clickCount: 3 });
      await usernameInput.type(E2E_USERNAME);
    }

    const passwordInput = await page.$("input[type='password']");
    if (passwordInput) {
      await passwordInput.click({ clickCount: 3 });
      await passwordInput.type(E2E_PASSWORD);
    }

    const loginButton = await page.$("button[type='submit'], button");
    if (loginButton) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
        loginButton.click(),
      ]);
    }

    // Wait for dashboard or sidebar to appear
    await page.waitForFunction(
      () => {
        const buttons = Array.from(document.querySelectorAll("button"));
        return buttons.some((btn) =>
          (btn.textContent || "").trim().toLowerCase().includes("log out") ||
          (btn.textContent || "").trim().toLowerCase().includes("dashboard") ||
          (btn.className || "").includes("sidebar")
        );
      },
      { timeout: 30000 }
    );
  }
}

/**
 * Navigate to a sidebar tab by its label text.
 */
async function navigateTo(label) {
  await page.waitForSelector(".sidebar-tab", { timeout: 20000 });
  const clicked = await page.evaluate((targetLabel) => {
    const buttons = Array.from(document.querySelectorAll(".sidebar-tab, button"));
    const match = buttons.find((btn) =>
      (btn.textContent || "").trim().toLowerCase() === targetLabel.toLowerCase() ||
      (btn.textContent || "").trim().toLowerCase().includes(targetLabel.toLowerCase())
    );
    if (match) {
      match.click();
      return true;
    }
    return false;
  }, label);

  if (!clicked) {
    throw new Error(`Could not find sidebar tab with label: "${label}"`);
  }

  await page.waitForTimeout(800);
}

/**
 * Wait until the given text is visible anywhere in the page.
 */
async function waitForText(text, timeout = 20000) {
  await page.waitForFunction(
    (target) => document.body.textContent.includes(target),
    { timeout },
    text
  );
}

/**
 * Click the first visible button or element containing the given text.
 */
async function clickByText(text) {
  const clicked = await page.evaluate((targetText) => {
    const candidates = [
      ...Array.from(document.querySelectorAll("button")),
      ...Array.from(document.querySelectorAll("a")),
      ...Array.from(document.querySelectorAll("[role='button']")),
    ];
    const match = candidates.find((el) =>
      (el.textContent || "").trim().includes(targetText) && !el.disabled
    );
    if (match) {
      match.click();
      return true;
    }
    return false;
  }, text);

  if (!clicked) {
    throw new Error(`Could not find clickable element with text: "${text}"`);
  }

  await page.waitForTimeout(400);
}

/**
 * Fill a form control identified by its label text.
 * Optionally scope to a parent selector.
 */
async function fillControlByLabel(labelText, value, scopeSelector = null) {
  const filled = await page.evaluate(
    (targetLabel, val, scope) => {
      const root = scope ? document.querySelector(scope) : document;
      if (!root) return false;
      const labels = Array.from(root.querySelectorAll("label"));
      const label = labels.find((lbl) =>
        (lbl.textContent || "").replace(/\s+/g, " ").trim().includes(targetLabel)
      );
      if (!label) return false;

      const id = label.getAttribute("for");
      const control = id
        ? document.getElementById(id)
        : label.querySelector("input, textarea, select");

      if (!control) return false;

      if (control.tagName === "SELECT") {
        const options = Array.from(control.options);
        const match = options.find((opt) =>
          (opt.value || "").toLowerCase().includes(val.toLowerCase()) ||
          (opt.text || "").toLowerCase().includes(val.toLowerCase())
        );
        if (match) control.value = match.value;
      } else {
        control.value = val;
      }

      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    labelText, value, scopeSelector
  );

  if (!filled) {
    // Try puppeteer type as fallback
    const input = await page.$(`input[placeholder*="${labelText}"], textarea[placeholder*="${labelText}"]`);
    if (input) {
      await input.click({ clickCount: 3 });
      await input.type(value);
    }
  }

  await page.waitForTimeout(200);
}

/**
 * Wait for a table row containing the given text to appear.
 */
async function waitForTableRowWithText(text, timeout = 20000) {
  await page.waitForFunction(
    (target) => {
      const rows = Array.from(document.querySelectorAll("tr, [class*='row'], [class*='table-row']"));
      return rows.some((row) => (row.textContent || "").includes(target));
    },
    { timeout },
    text
  );
}

/**
 * Expand a table row (click "View" type toggle) and wait for "expanded" indicator.
 */
async function ensureTableRowExpanded(rowText, expandLabel = "View", collapseLabel = "Hide") {
  const alreadyExpanded = await page.evaluate((collapse) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.some((btn) => (btn.textContent || "").trim() === collapse);
  }, collapseLabel);

  if (!alreadyExpanded) {
    const expanded = await page.evaluate(
      (target, expand) => {
        const rows = Array.from(document.querySelectorAll("tr, [class*='row'], [class*='table-row']"));
        const row = rows.find((r) => (r.textContent || "").includes(target));
        if (!row) return false;
        const btn = Array.from(row.querySelectorAll("button")).find((b) =>
          (b.textContent || "").trim().includes(expand)
        );
        if (btn) { btn.click(); return true; }
        return false;
      },
      rowText, expandLabel
    );

    if (!expanded) {
      throw new Error(`Could not find expand button for row with text: "${rowText}"`);
    }

    await page.waitForTimeout(600);
  }
}

/**
 * Click an action button inside a specific table row.
 */
async function clickTableRowAction(rowText, actionLabel) {
  const clicked = await page.evaluate(
    (target, action) => {
      const rows = Array.from(document.querySelectorAll("tr, [class*='row'], [class*='table-row']"));
      const row = rows.find((r) => (r.textContent || "").includes(target));
      if (!row) return false;
      const btn = Array.from(row.querySelectorAll("button, a")).find((el) =>
        (el.textContent || "").trim().includes(action)
      );
      if (btn) { btn.click(); return true; }
      return false;
    },
    rowText, actionLabel
  );

  if (!clicked) {
    throw new Error(`Could not find action "${actionLabel}" in row with text: "${rowText}"`);
  }

  await page.waitForTimeout(600);
}

// ---------------------------------------------------------------------------
// Patient helpers
// ---------------------------------------------------------------------------

/**
 * Register a patient via the UI and return the patient_id.
 */
async function registerPatient({ first, last, phone, age }) {
  await navigateTo("Patient Registration");
  await page.waitForSelector("#patient-registration-form, form", { timeout: 20000 });

  await fillControlByLabel("First Name", first);
  await fillControlByLabel("Last Name", last);
  await fillControlByLabel("Phone", phone);

  if (age) {
    await fillControlByLabel("Age", String(age));
  }

  // Submit form and capture patient_id from the response
  const responsePromise = page.waitForResponse(
    (res) =>
      res.url().includes("/api/patients") && res.request().method() === "POST",
    { timeout: 30000 }
  );

  const submitBtn = await page.$(
    "button[type='submit'], button.btn-primary, button[class*='submit'], button[class*='register']"
  );
  if (submitBtn) {
    await submitBtn.click();
  } else {
    await page.$eval("form", (f) => f.requestSubmit());
  }

  const response = await responsePromise;
  const data = await response.json().catch(() => ({}));
  const patientId = data.patient_id || data.id || null;

  if (!patientId) {
    throw new Error(`Patient registration failed: ${JSON.stringify(data)}`);
  }

  return patientId;
}

/**
 * Search for a patient in the Patients list page.
 */
async function searchPatient(query) {
  await navigateTo("Patients");
  await page.waitForSelector("input[placeholder*='Search'], input[type='search'], input[aria-label*='search' i]", { timeout: 20000 });

  const searchInput = await page.$(
    "input[placeholder*='Search'], input[type='search'], input[aria-label*='search' i]"
  );
  if (searchInput) {
    await searchInput.click({ clickCount: 3 });
    await searchInput.type(query);
  }

  await page.waitForTimeout(800);
}

/**
 * Search for a patient in the Re-visit / Follow-up page.
 */
async function searchReadmitPatient(query) {
  await navigateTo("Follow-up / Re-visit");
  await page.waitForSelector("input", { timeout: 20000 });

  const searchInput = await page.$(
    "input[placeholder*='Search'], input[placeholder*='Patient'], input[aria-label*='search' i], input[aria-label*='patient' i]"
  );
  if (searchInput) {
    await searchInput.click({ clickCount: 3 });
    await searchInput.type(query);
  }

  await page.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// Direct API helper (bypasses the browser, uses fetch from Node)
// ---------------------------------------------------------------------------

/**
 * Make a direct API call (not through the browser page).
 * Returns { status, data }.
 */
async function apiRequest(endpoint, { method = "GET", body = null, headers = {} } = {}) {
  const token = await _getAuthToken().catch(() => null);

  const reqHeaders = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };

  const options = {
    method,
    headers: reqHeaders,
  };

  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;

  try {
    const response = await fetch(url, options);
    let data = {};
    try {
      data = await response.json();
    } catch (_) { /* no-op */ }
    return { status: response.status, data };
  } catch (error) {
    return { status: 0, data: {}, error: String(error) };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Constants
  SAMPLE_READMIT_DOC,

  // Generators
  uniqueSuffix,
  uniquePhone,

  // Auth / navigation
  ensureLoggedIn,
  navigateTo,
  waitForText,
  clickByText,

  // Form helpers
  fillControlByLabel,

  // Table helpers
  waitForTableRowWithText,
  ensureTableRowExpanded,
  clickTableRowAction,

  // Patient helpers
  registerPatient,
  searchPatient,
  searchReadmitPatient,

  // API helper
  apiRequest,
};
