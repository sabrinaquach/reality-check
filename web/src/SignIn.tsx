import { useState } from "react";
import { icons } from "./icons.ts";
import { GOOGLE_SIGN_IN, requestLink } from "./auth.ts";

/**
 * Figma node 2120:4169 — "Log in or sign up".
 *
 * One field and one button, exactly as the design draws it: there is no
 * password to ask for, because a link sent to the address proves the same
 * thing a password would have fallen back to proving anyway.
 *
 * Nothing signs in from inside this modal any more. Both ways through it are
 * navigations -- follow the link from the inbox, or go and come back from
 * Google -- so the modal's job ends at "we've sent it", and the session is
 * picked up by /api/me when the browser lands back on the app.
 */
export function SignIn({
  onClose,
  onRequested,
  googleReady,
  initialError,
}: {
  onClose: () => void;
  /** Told which address the link went to, so a waiting action can be matched to it. */
  onRequested: (email: string) => void;
  /** Whether the server has Google credentials. False means the button can't work. */
  googleReady: boolean;
  /** An error carried back from a link or the Google redirect, if that is how we got here. */
  initialError?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestLink(email);
      onRequested(email.trim().toLowerCase());
      setSent(email.trim());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Log in or sign up">
      {/* The design's modal is a 466 square, sized around the form. The
          confirmation is half that much content, so it centres within the
          square rather than sitting at the top of a large empty one. */}
      <div className={sent ? "modal centred" : "modal"}>
        <button type="button" className="close" onClick={onClose} aria-label="Close">
          <img src={icons.cross} alt="" />
        </button>

        <img className="mark" src={icons.mark} alt="" />

        {sent ? (
          /**
           * The whole modal, not a line under the form: the next step is in
           * another window entirely, and leaving the form up would invite
           * pressing Continue again to make something happen here.
           */
          <div className="modal-body">
            <h3 className="center">Check your email</h3>
            {/* The address carries the weight of its line: it is the one
                thing here worth checking against what they meant to type. */}
            <p className="sent-to">
              Link sent to <b>{sent}</b>
            </p>
            <p className="sent-note">It works once and expires in 15 minutes.</p>
            <button
              type="button"
              className="link-again"
              onClick={() => {
                setSent(null);
                setError(null);
              }}
            >
              Use a different address
            </button>
          </div>
        ) : (
          <form className="modal-body" onSubmit={submit}>
            <h3 className="center">Log in or sign up</h3>

            <div className="auth-field">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter email"
                aria-label="Email"
                autoComplete="email"
                required
                autoFocus
              />
            </div>

            {/* Live, because it appears after a press and the reader's
                attention is on the button they just pressed rather than here. */}
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}

            <button className="action auth" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Continue"}
            </button>

            <div className="or">OR</div>

            {/* A link, not a button: this leaves the app for Google and comes
                back to /api/auth/google/callback, so it is a navigation. */}
            <a
              className={googleReady ? "google-btn" : "google-btn disabled"}
              href={googleReady ? GOOGLE_SIGN_IN : undefined}
              aria-disabled={!googleReady}
              title={googleReady ? undefined : "Google sign-in isn't configured on this server"}
            >
              <img src={icons.google} alt="" />
              Continue with Google
            </a>

            <p className="disclaimer">
              Saving a listing needs an account — they stay on it, so they follow you between
              browsers. Checking and comparing works without one.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
