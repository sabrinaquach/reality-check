import { useEffect, useRef, useState } from "react";
import { avatarUrl, uploadAvatar, type Account } from "./auth.ts";

/**
 * The signed-in account, as one circle in the corner of the nav.
 *
 * The design has no state for a signed-in bar at all (node 2120:4169 is the
 * modal, and the nav behind it always reads "Sign in"), so this takes the
 * least room a nav can spend on it: the picture, and everything else -- which
 * account this is, changing the picture, signing out -- behind a press. The
 * address used to sit beside it, which said the same thing permanently and in
 * more space than a nav bar has to spare.
 */

/** What gets stored. Square, small, and re-encoded -- see squareJpeg. */
const SIZE = 256;

/**
 * Redraw whatever they picked as a centre-cropped square JPEG.
 *
 * Done here rather than on the server because it is where the picture already
 * is: a 4MB phone photo becomes about 30KB before it crosses the network, the
 * server needs no image library to make that true, and re-encoding through a
 * canvas means what gets uploaded is pixels this browser drew rather than the
 * original file and whatever else it was carrying.
 */
async function squareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read that image.");
    // Centre crop: faces are usually in the middle, and a squashed circle
    // would be worse than a tight one.
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      SIZE,
      SIZE,
    );
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not read that image."))),
        "image/jpeg",
        0.85,
      ),
    );
  } finally {
    bitmap.close();
  }
}

export function AccountMenu({
  account,
  onChanged,
  onSignOut,
}: {
  account: Account;
  onChanged: (account: Account) => void;
  onSignOut: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const src = avatarUrl(account);

  /**
   * A menu that can only be closed by choosing something is a trap, so a press
   * anywhere else or Escape closes it too -- the two ways anyone tries.
   */
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await uploadAvatar(await squareJpeg(file)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      // Let the same file be picked again after a failure.
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="account" ref={wrap}>
      <button
        type="button"
        className="avatar"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        /* The address is the label: with the text gone from the bar, this is
           the only thing that says whose account this is before it is opened. */
        aria-label={`Account: ${account.email}`}
        title={account.email}
      >
        {src ? (
          <img src={src} alt="" />
        ) : (
          /* Their initial, until there is a picture. Better than a generic
             silhouette at telling two accounts apart on a shared machine. */
          <span className="avatar-initial" aria-hidden="true">
            {account.email.trim().charAt(0).toUpperCase()}
          </span>
        )}
        {busy && <span className="avatar-busy" aria-hidden="true" />}
      </button>

      {open && (
        <div className="account-menu" role="menu">
          {/* Not an item: it is who you are, not something to press. */}
          <div className="account-who" title={account.email}>
            {account.email}
          </div>
          <button
            type="button"
            role="menuitem"
            className="account-item"
            onClick={() => {
              setOpen(false);
              input.current?.click();
            }}
          >
            {src ? "Change picture" : "Add picture"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="account-item"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}

      {/* Outside the menu, so it survives the menu closing before the picker
          opens -- the click that opens it comes from the item above. */}
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => void choose(e.target.files?.[0])}
        tabIndex={-1}
      />

      {error && (
        <span className="avatar-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
