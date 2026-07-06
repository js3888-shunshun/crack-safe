import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CrackSafeService, CrackUpdate } from './crack-safe.service';

type Status = 'idle' | 'running' | 'done' | 'error';

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

  combination = signal('');
  status = signal<Status>('idle');
  attempts = signal(0);
  score = signal(0);
  timeTaken = signal(0);
  crackedSoFar = signal('??????????');
  errorMsg = signal('');
  log = signal<string[]>([]);

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

  logText = computed(() =>
    this.log().length ? this.log().join('\n') : 'Submit a combination to start.'
  );

  constructor(private readonly crackSafe: CrackSafeService) {}

  onInput(value: string): void {
    // Keep only digits, capped at 10, so the input always holds a clean value.
    this.combination.set(value.replace(/\D/g, '').slice(0, 10));
  }

  submit(): void {
    const value = this.combination().trim();
    if (!/^\d{10}$/.test(value)) {
      this.status.set('error');
      this.errorMsg.set('Please enter exactly 10 digits.');
      return;
    }

    this.reset('running');

    this.crackSafe.crackSafeStream(value).subscribe({
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
    this.crackedSoFar.set('??????????');
    this.errorMsg.set('');
    this.log.set([]);
  }

  private handleUpdate(update: CrackUpdate): void {
    if (update.status === 'done') {
      this.attempts.set(update.attempts ?? this.attempts());
      this.timeTaken.set(update.time_taken ?? 0);
      this.status.set('done');
      this.prepend(
        `✔ Cracked in ${update.attempts} attempts (${update.time_taken}s)`
      );
      return;
    }

    // Live counter updates: this is what freezes once the safe is cracked.
    this.attempts.set(update.attempts ?? 0);
    this.score.set(update.score ?? 0);
    this.crackedSoFar.set(update.cracked_so_far ?? '??????????');
    this.prepend(
      `Attempt ${update.attempts}: guess=${update.guess}, score=${update.score}, known=${update.cracked_so_far}`
    );
  }

  private prepend(line: string): void {
    this.log.update((lines) => [line, ...lines].slice(0, 200));
  }
}
