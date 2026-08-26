import { useState } from "react";
import { icons } from "./icons.ts";

/**
 * Figma node 2120:4169 — "Log in or sign up".
 *
 * Built to the design, but there is no auth service behind it: no accounts, no
 * sessions, nothing to sign into. Rather than let it look functional and fail
 * silently, both actions are disabled and the modal says why. Everything the
 * app actually does works without an account.
 */
export function SignIn({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Log in or sign up">
      <div className="modal">
        <button type="button" className="close" onClick={onClose} aria-label="Close">
          <img src={icons.cross} alt="" />
        </button>

        <img className="mark" src={icons.mark} alt="" />

        <div className="modal-body">
          <h3 className="center">Log in or sign up</h3>

          <div className="auth-field">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter email"
              aria-label="Email"
              autoFocus
            />
          </div>

          <button className="action auth" disabled title="Accounts aren't built yet">
            Continue
          </button>

          <div className="or">OR</div>

          <button className="google-btn" disabled title="Accounts aren't built yet">
            <img src={icons.google} alt="" />
            Continue with Google
          </button>

          <p className="disclaimer">
            Accounts aren't built yet — there's nothing to sign in to. Checking and comparing
            listings works without one.
          </p>
        </div>
      </div>
    </div>
  );
}
