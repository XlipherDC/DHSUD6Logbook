import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { FileCheck2, LockKeyhole, LogIn } from "lucide-react";
import type { Identity } from "./data";
import { auth, demoMode, firebaseConfigured, publicDataMode } from "./firebase";

export default function AuthGate({ children }: { children: (identity: Identity) => React.ReactNode }) {
  const localMode = demoMode || publicDataMode;
  const [identity, setIdentity] = useState<Identity | null>(localMode ? {
    uid: publicDataMode ? "public-viewer" : "demo-user",
    email: publicDataMode ? "" : "demo@dhsud.gov.ph",
    displayName: publicDataMode ? "Public Viewer" : "Demo Administrator",
  } : null);
  const [ready, setReady] = useState(localMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (localMode || !auth) return;
    return onAuthStateChanged(auth, (account) => {
      setIdentity(account ? {
        uid: account.uid,
        email: account.email || "",
        displayName: account.displayName || account.email?.split("@")[0] || "User",
      } : null);
      setReady(true);
    });
  }, []);

  if (!firebaseConfigured && !localMode) return <SetupNeeded />;
  if (!ready) return <div className="auth-page"><div className="loader" /><p>Checking access…</p></div>;
  if (!identity) {
    const login = async (event: React.FormEvent) => {
      event.preventDefault();
      setError("");
      try {
        await signInWithEmailAndPassword(auth!, email, password);
      } catch {
        setError("Sign-in failed. Check your email, password, and account access.");
      }
    };
    return <div className="auth-page"><div className="auth-card">
      <div className="auth-mark"><FileCheck2 /></div>
      <span className="eyebrow">DHSUD Region VI</span>
      <h1>Issuance Tracker</h1>
      <p>Sign in with your authorized account to open the approved applications registry.</p>
      <form onSubmit={login}>
        <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <div className="login-error">{error}</div>}
        <button className="primary"><LogIn size={17} /> Sign in</button>
      </form>
      <div className="secure-note"><LockKeyhole size={14} /> Restricted to authorized personnel</div>
    </div></div>;
  }
  return <>{children(identity)}{!localMode && <button className="sign-out" onClick={() => signOut(auth!)}>Sign out</button>}</>;
}

function SetupNeeded() {
  return <div className="auth-page"><div className="auth-card setup-card">
    <div className="auth-mark"><FileCheck2 /></div>
    <h1>Configuration required</h1>
    <p>Add the six <code>VITE_FIREBASE_*</code> values described in the README, then rebuild. For a local read-only-style preview, set <code>VITE_DEMO_MODE=true</code>.</p>
  </div></div>;
}
