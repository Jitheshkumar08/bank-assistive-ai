import { Injectable } from '@nestjs/common'
import argon2 from 'argon2'

/** OWASP-recommended Argon2id parameters (19 MiB memory, 2 iterations, 1 lane). */
const options = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined

  hash(password: string) {
    return argon2.hash(password, options)
  }

  async verify(hash: string, password: string) {
    try {
      return await argon2.verify(hash, password)
    } catch {
      return false
    }
  }

  /** Spends the same work as a real verification so unknown emails can't be detected by timing. */
  async verifyAgainstDummy(password: string) {
    this.dummyHash ??= argon2.hash(`campusguide-dummy-${Date.now()}`, options)
    await this.verify(await this.dummyHash, password)
    return false
  }
}
