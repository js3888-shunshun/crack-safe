import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

/** A single progress update streamed from the backend. */
export interface CrackUpdate {
  status: 'running' | 'completed' | 'done' | 'error';
  attempts?: number;
  guess?: string;
  score?: number;
  cracked_so_far?: string;
  time_taken?: number;
  error?: string;
}

/** Final payload returned by the required POST /api/crack_safe/ endpoint. */
export interface CrackResult {
  attempts: number;
  time_taken: number;
}

@Injectable({ providedIn: 'root' })
export class CrackSafeService {
  private readonly base = '/api';

  /**
   * Calls the required endpoint POST /api/crack_safe/ and returns the final
   * result in one shot.
   */
  async crackSafe(actualCombination: string): Promise<CrackResult> {
    const res = await fetch(`${this.base}/crack_safe/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actual_combination: actualCombination }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data as CrackResult;
  }

  /**
   * Bonus: streams live progress from POST /api/crack_safe_stream/ so the UI
   * can update the attempt counter in real time. Emits one CrackUpdate per
   * backend attempt and completes when the safe is cracked.
   */
  crackSafeStream(actualCombination: string): Observable<CrackUpdate> {
    return new Observable<CrackUpdate>((subscriber) => {
      const controller = new AbortController();

      (async () => {
        try {
          const res = await fetch(`${this.base}/crack_safe_stream/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actual_combination: actualCombination }),
            signal: controller.signal,
          });

          if (!res.ok || !res.body) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Request failed');
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (!line.trim()) continue;
              subscriber.next(JSON.parse(line) as CrackUpdate);
            }
          }
          subscriber.complete();
        } catch (err) {
          if (!controller.signal.aborted) {
            subscriber.error(err);
          }
        }
      })();

      // Abort the fetch if the caller unsubscribes.
      return () => controller.abort();
    });
  }
}
