/**
 * FedEx Recipient ID — what the ship station types into FedEx Ship Manager so
 * the recipient fills itself in (idea-153, docs/fedex-customer-id-integration.md).
 *
 * The id itself is minted by the database (trigger on customer_addresses from
 * the customer's AS400 account + the address' ship-to suffix). This module only
 * decides what to SHOW for an order, and what to tell the operator to do in FSM.
 */

export interface FedexRecipientCustomer {
  as400_account: string | null;
  ship_to_varies: boolean;
}

export interface FedexRecipientAddress {
  id: string;
  label: string | null;
  street: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  fedex_recipient_id: string | null;
  contact_name: string | null;
  residential: boolean;
  fedex_synced_at: string | null;
}

export type FedexRecipientKind =
  /** FSM and Pickd agreed on this row (export or import): paste the id, done. */
  | 'in_fedex'
  /** Pickd has an id but has not seen it in FSM yet — either FSM already has it
   *  (the 951 numeric ids that predate Pickd) or it is genuinely new. */
  | 'unsynced'
  /** Channel account (consumer direct, Facebook, warranty…): ship-to changes every
   *  order, must NOT be saved in the FSM address book. */
  | 'one_off'
  /** No id: manual order without an AS400 account, or a not-yet-tagged address. */
  | 'no_id';

export interface FedexRecipientState {
  kind: FedexRecipientKind;
  id: string | null;
  address: FedexRecipientAddress | null;
}

export function resolveFedexRecipient(
  customer: FedexRecipientCustomer | null | undefined,
  address: FedexRecipientAddress | null | undefined
): FedexRecipientState {
  if (customer?.ship_to_varies) {
    return { kind: 'one_off', id: null, address: address ?? null };
  }
  const id = address?.fedex_recipient_id?.trim() || null;
  if (!id || !address) {
    return { kind: 'no_id', id: null, address: address ?? null };
  }
  return { kind: address.fedex_synced_at ? 'in_fedex' : 'unsynced', id, address };
}

/** Short badge text per state. */
export const FEDEX_RECIPIENT_BADGE: Record<FedexRecipientKind, string> = {
  in_fedex: 'In FedEx',
  unsynced: 'Check in FedEx',
  one_off: 'One-off recipient',
  no_id: 'No FedEx ID',
};

/** The one instruction the operator needs at the FSM screen for this state. */
export const FEDEX_RECIPIENT_HINT: Record<FedexRecipientKind, string> = {
  in_fedex: 'Paste it in Recipient ID — the address fills itself.',
  unsynced:
    'Paste it in Recipient ID. If FedEx does not fill the address, type it once and ' +
    'leave "Save in/Update my address book" ticked.',
  one_off: 'Type the address and untick "Save in/Update my address book".',
  no_id: 'Type the recipient by hand in FedEx.',
};
