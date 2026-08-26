import { useState } from "react";
import { AddressInput } from "./AddressInput.tsx";
import { icons } from "./icons.ts";

export function AddListing({
  busy,
  error,
  slotsFull,
  address,
  onAddressChange,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  slotsFull: boolean;
  address: string;
  onAddressChange: (v: string) => void;
  onSubmit: (address: string, rent: string, mode: "replace" | "append") => void;
}) {
  const [rent, setRent] = useState("");
  const ready = address.trim().length > 0 && !busy;

  return (
    <aside className="sidebar">
      <h3>Add a listing</h3>

      <div className="inputs">
        <AddressInput
          value={address}
          onChange={onAddressChange}
          placeholder="Search or paste the property address"
          icon={icons.searchSm}
          wrapperClass="input-row"
          ariaLabel="Property address"
          placement="up"
        />
        <div className="input-row">
          <img src={icons.dollar} alt="" />
          <input
            value={rent}
            onChange={(e) => setRent(e.target.value)}
            placeholder="Enter the listed rent (optional)"
            inputMode="numeric"
            aria-label="Listed rent"
          />
        </div>
      </div>

      <p className="note">We'll use this to calculate commute time and true monthly cost.</p>

      {error && <p className="form-error">{error}</p>}

      <button
        className="btn"
        disabled={!ready || slotsFull}
        onClick={() => onSubmit(address, rent, "append")}
      >
        {slotsFull ? "Both slots full" : "Add to comparison"}
      </button>
      <button className="btn" disabled={!ready} onClick={() => onSubmit(address, rent, "replace")}>
        {busy ? "Checking…" : "Check listing"}
      </button>
    </aside>
  );
}
