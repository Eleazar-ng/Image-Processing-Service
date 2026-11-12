import { Injectable } from '@nestjs/common';
import { hashPassword, verifyPassword } from './password.js';

@Injectable()
export class PasswordService {
  // Verified against when the email is unknown, so a missing account takes
  // about as long to reject as a wrong password (no timing oracle).
  private readonly dummyHash = hashPassword('timing-equalization-password');

  hash(password: string): Promise<string> {
    return hashPassword(password);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verifyPassword(passwordHash, password);
  }

  async verifyAgainstDummy(password: string): Promise<void> {
    await verifyPassword(await this.dummyHash, password);
  }
}
