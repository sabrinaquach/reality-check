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
  /**
   * Which way the suggestion list opens. Down, as an address field's list
   * normally does and as the reader expects to read it.
   *
   * It was up, so that it could not cover the two buttons under the field --
   * but a list only covers them while it is open, and it closes on the pick
   * that the reader came to make. Reading a list of addresses upwards, from
   * the field back towards the top of the panel, was the worse trade.
   */
  suggestions = "down",
  /**
   * What the comparison button says. Defaults to the general "Add to
   * comparison"; the phone's sheet names the slot it was opened from, because
   * there it is filling that one rather than whichever happens to be free.
   */
  addLabel = "Add to comparison",
}: {
  busy: boolean;
  error: string | null;
  slotsFull: boolean;
  address: string;
  onAddressChange: (v: string) => void;
  onSubmit: (address: string, rent: string, mode: "replace" | "append") => void;
  suggestions?: "up" | "down";
  addLabel?: string;
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
          placement={suggestions}
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
        {slotsFull ? "Both slots full" : addLabel}
      </button>
      <button className="btn" disabled={!ready} onClick={() => onSubmit(address, rent, "replace")}>
        {busy ? "Checking…" : "Check listing"}
      </button>
    </aside>
  );
}
