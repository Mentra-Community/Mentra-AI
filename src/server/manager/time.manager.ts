/**
 * Utility class for timezone-aware date and time formatting.
 */
export class Time {
  private timezone: string;

  constructor(timezone: string) {
    this.timezone = timezone;
  }

  /** Returns the current time formatted for the configured timezone (e.g. "2:30:00 PM"). */
  getLocalTime(): string {
    return new Date().toLocaleTimeString("en-US", { timeZone: this.timezone });
  }

  /** Returns the current date formatted for the configured timezone (e.g. "2/12/2026"). */
  getLocalDate(): string {
    return new Date().toLocaleDateString("en-US", { timeZone: this.timezone });
  }

  /** Returns the current date and time formatted for the configured timezone. */
  getLocalDateTime(): string {
    return new Date().toLocaleString("en-US", { timeZone: this.timezone });
  }

  /** Returns the IANA timezone string (e.g. "America/New_York"). */
  getTimezone(): string {
    return this.timezone;
  }
}
