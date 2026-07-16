import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Input } from "./ui";
import BrandLogo from "./BrandLogo";

type Props = {
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  initialHospitalCode: string;
};

export default function AuthView({ onLogin, initialHospitalCode }: Props) {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand">
          <BrandLogo />
          <div>
            <p className="brand-title">HospAI</p>
            <p className="brand-subtitle">AI-Driven Healthcare Optimization</p>
          </div>
        </div>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to manage patients, OCR documents, and admissions.</p>

        <form className="auth-form" onSubmit={onLogin}>
          <label className="ui-label">
            Hospital Code
            <Input name="hospital_code" defaultValue={initialHospitalCode} placeholder="hosp-default" required />
          </label>
          <label className="ui-label">
            Username
            <Input name="username" placeholder="username" required />
          </label>
          <label className="ui-label">
            Password
            <div style={{ position: "relative" }}>
              <Input name="password" type={showPassword ? "text" : "password"} placeholder="••••••" required style={{ paddingRight: "44px" }} />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((value) => !value)}
                style={{
                  position: "absolute",
                  right: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  border: 0,
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: "18px",
                }}
              >
                {showPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12a19.9 19.9 0 0 1 5.06-7.06" />
                    <path d="M10.58 10.58A2 2 0 0 0 12 14a2 2 0 0 0 1.42-.58" />
                    <path d="M9.9 4.24A10.7 10.7 0 0 1 12 4c5 0 9.27 3.11 11 8a19.8 19.8 0 0 1-2.16 3.19" />
                    <line x1="2" y1="2" x2="22" y2="22" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </label>
          <Button type="submit" variant="primary">
            Login
          </Button>
        </form>
        <div className="hint">Only hospital admins can access Employee Management.</div>
      </div>
    </div>
  );
}
