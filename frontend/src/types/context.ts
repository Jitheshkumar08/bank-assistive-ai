export interface Branch {
  id: string;
  code: string;
  name: string;
  city: string | null;
  address: string | null;
}

/** A validated branch, as returned by /context/resolve. */
export interface ResolvedContext {
  branch: Pick<Branch, 'id' | 'code' | 'name' | 'city'>;
}

/**
 * The raw payload encoded in a branch QR code.
 *
 * Snake_case because that is how it is printed on the code itself. The
 * client maps it to the API's camelCase request shape; the value is a
 * branch *code*, never a database id.
 */
export interface QrPayload {
  branch_id: string;
}

export function qrPayloadToRequest(payload: QrPayload): { branchCode: string } {
  return { branchCode: payload.branch_id };
}
