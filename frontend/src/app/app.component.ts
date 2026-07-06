import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CrackSafeService, CrackUpdate } from './crack-safe.service';

type Status = 'idle' | 'running' | 'done' | 'error';
type Theme = 'dark' | 'light';

interface DigitCell {
  display: string;
  state: 'found' | 'active' | 'unknown';
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  /** The maximum number of attempts the algorithm can ever need. */
  readonly maxAttempts = 92;
  /** Size of the full keyspace: 10 digits, base 10. */
  readonly totalKeyspace = 10_000_000_000;

  combination = signal('');
  status = signal<Status>('idle');
  attempts = signal(0);
  score = signal(0);
  timeTaken = signal(0);
  crackedSoFar = signal('??????????');
  currentGuess = signal('');
  errorMsg = signal('');
  log = signal<string[]>([]);

  /** UI pacing for the live stream, in milliseconds (speed slider). */
  stepDelayMs = signal(15);
  theme = signal<Theme>('dark');

  /** Static confetti pieces rendered on a successful crack. */
  readonly confettiPieces = Array.from({ length: 24 }, (_, i) => ({
    left: (i * 100) / 24 + (i % 3) * 2,
    delay: (i % 6) * 80,
    color: ['#22d3ee', '#a78bfa', '#86efac', '#fca5a5', '#fcd34d'][i % 5],
  }));

  /**
   * Authoritative compute time from the required POST /api/crack_safe/
   * endpoint. The streamed time includes UI pacing, so the comparison below
   * uses this un-throttled value instead.
   */
  officialTime = signal<number | null>(null);

  private submitted = '';

  /** Progress bar percentage; pinned to 100% only when finished. */
  progress = computed(() => {
    if (this.status() === 'done') return 100;
    return Math.min(98, Math.round((this.attempts() / this.maxAttempts) * 100));
  });

  statusLabel = computed(() => {
    switch (this.status()) {
      case 'running':
        return 'Running';
      case 'done':
        return 'Cracked';
      case 'error':
        return 'Error';
      default:
        return 'Idle';
    }
  });

  isValid = computed(() => /^\d{10}$/.test(this.combination().trim()));
  isRunning = computed(() => this.status() === 'running');

  logText = computed(() =>
    this.log().length ? this.log().join('\n') : 'Submit a combination to start.'
  );

  // --- Keyspace tracking -----------------------------------------------------

  /** How many positions are confirmed so far. */
  knownDigits = computed(
    () => this.crackedSoFar().split('').filter((c) => c !== '?').length
  );

  /** Combinations still consistent with what we know: 10^(10 - known). */
  remaining = computed(() => 10 ** (10 - this.knownDigits()));

  /** Combinations ruled out so far. */
  eliminated = computed(() => this.totalKeyspace - this.remaining());

  eliminatedPct = computed(
    () => (this.eliminated() / this.totalKeyspace) * 100
  );

  // --- Per-digit safe display ------------------------------------------------

  digitCells = computed<DigitCell[]>(() => {
    const cracked = this.crackedSoFar();
    const guess = this.currentGuess();
    const active = this.knownDigits(); // next position being probed
    const running = this.isRunning();

    return Array.from({ length: 10 }, (_, i): DigitCell => {
      const c = cracked[i];
      if (c && c !== '?') return { display: c, state: 'found' };
      if (running && i === active) {
        return { display: guess[i] ?? '?', state: 'active' };
      }
      return { display: '?', state: 'unknown' };
    });
  });

  // --- Brute-force comparison ------------------------------------------------

  /** How many fewer attempts this run needed vs the full keyspace. */
  speedup = computed(() =>
    this.attempts() ? this.totalKeyspace / this.attempts() : 0
  );

  /** Seconds a brute-force sweep would take at this run's per-attempt rate. */
  private bruteForceSeconds = computed(() => {
    const perAttempt = this.effectiveTime() / Math.max(this.attempts(), 1);
    return perAttempt * this.totalKeyspace;
  });

  smartTimeLabel = computed(() => this.formatDuration(this.effectiveTime()));
  bruteForceTimeLabel = computed(() =>
    this.formatDuration(this.bruteForceSeconds())
  );

  /** Prefer the authoritative one-shot time; fall back to the streamed time. */
  private effectiveTime(): number {
    return this.officialTime() ?? this.timeTaken();
  }

  constructor(private readonly crackSafe: CrackSafeService) {}

  onInput(value: string): void {
    // Keep only digits, capped at 10, so the input always holds a clean value.
    this.combination.set(value.replace(/\D/g, '').slice(0, 10));
  }

  // --- Quick-fill helpers ----------------------------------------------------

  fillRandom(): void {
    let value = '';
    for (let i = 0; i < 10; i++) value += Math.floor(Math.random() * 10);
    this.combination.set(value);
  }

  fillWorstCase(): void {
    this.combination.set('9999999999');
  }

  fillBestCase(): void {
    this.combination.set('0000000000');
  }

  toggleTheme(): void {
    const next: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    document.documentElement.setAttribute('data-theme', next);
  }

  // --- Submit / streaming ----------------------------------------------------

  submit(): void {
    const value = this.combination().trim();
    if (!/^\d{10}$/.test(value)) {
      this.status.set('error');
      this.errorMsg.set('Please enter exactly 10 digits.');
      return;
    }

    this.submitted = value;
    this.reset('running');

    this.crackSafe
      .crackSafeStream(value, this.stepDelayMs() / 1000)
      .subscribe({
        next: (update) => this.handleUpdate(update),
        error: (err: Error) => {
          this.status.set('error');
          this.errorMsg.set(err.message || 'Something went wrong.');
        },
      });
  }

  private reset(status: Status): void {
    this.status.set(status);
    this.attempts.set(0);
    this.score.set(0);
    this.timeTaken.set(0);
    this.officialTime.set(null);
    this.crackedSoFar.set('??????????');
    this.currentGuess.set('');
    this.errorMsg.set('');
    this.log.set([]);
  }

  private handleUpdate(update: CrackUpdate): void {
    if (update.status === 'done') {
      this.attempts.set(update.attempts ?? this.attempts());
      this.timeTaken.set(update.time_taken ?? 0);
      this.crackedSoFar.set(this.submitted);
      this.status.set('done');
      this.prepend(
        `Cracked in ${update.attempts} attempts (${update.time_taken}s)`
      );
      // Call the required one-shot endpoint for the authoritative compute time.
      this.fetchAuthoritativeTime();
      return;
    }

    // Live counter updates: this is what freezes once the safe is cracked.
    this.attempts.set(update.attempts ?? 0);
    this.score.set(update.score ?? 0);
    this.crackedSoFar.set(update.cracked_so_far ?? '??????????');
    this.currentGuess.set(update.guess ?? '');
    this.prepend(
      `Attempt ${update.attempts}: guess=${update.guess}, score=${update.score}, known=${update.cracked_so_far}`
    );
  }

  private async fetchAuthoritativeTime(): Promise<void> {
    try {
      const result = await this.crackSafe.crackSafe(this.submitted);
      this.officialTime.set(result.time_taken);
    } catch {
      // Non-fatal: the comparison simply falls back to the streamed time.
    }
  }

  private prepend(line: string): void {
    this.log.update((lines) => [line, ...lines].slice(0, 200));
  }

  /** Human-readable duration across a very wide range (ns to years). */
  formatDuration(seconds: number): string {
    if (seconds <= 0) return '0 s';
    if (seconds < 1e-6) return `${(seconds * 1e9).toFixed(0)} ns`;
    if (seconds < 1e-3) return `${(seconds * 1e6).toFixed(1)} µs`;
    if (seconds < 1) return `${(seconds * 1e3).toFixed(2)} ms`;
    if (seconds < 60) return `${seconds.toFixed(2)} s`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
    if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)} hours`;
    if (seconds < 31_536_000) return `${(seconds / 86_400).toFixed(1)} days`;
    return `${(seconds / 31_536_000).toFixed(1)} years`;
  }

  /** Compact large-number formatting with thousands separators. */
  formatCount(value: number): string {
    return Math.round(value).toLocaleString('en-US');
  }
}
