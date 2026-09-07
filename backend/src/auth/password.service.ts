import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * The only place passwords are hashed or checked.
 *
 * Isolated behind a service so the algorithm can be changed without
 * touching authentication logic, and so tests can substitute a fast
 * implementation instead of paying argon2's deliberate cost.
 */
@Injectable()
export class PasswordService {
  /** Argon2id with library defaults, which follow OWASP guidance. */
  async hash(plain: string): Promise<string> {
    return hash(plain);
  }

  /**
   * Returns false rather than throwing when the stored value is not a
   * usable hash. Seeded accounts carry a deliberate placeholder, and a
   * malformed hash must read as "wrong password", never as a 500.
   */
  async verify(storedHash: string, plain: string): Promise<boolean> {
    try {
      return await verify(storedHash, plain);
    } catch {
      return false;
    }
  }
}
