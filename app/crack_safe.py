"""Core crack_safe logic.

The function uses a feedback tool that returns how many digits are correct in the
correct positions. It avoids brute force and finishes in at most 92 attempts for
any valid 10-digit combination.
"""

from __future__ import annotations

import time
from typing import Callable, Optional

ProgressCallback = Optional[Callable[[dict], None]]


def validate_combination(actual_combination: str) -> None:
    """Validate that the input is exactly a 10-digit string."""
    if not isinstance(actual_combination, str):
        raise ValueError("actual_combination must be a string")
    if len(actual_combination) != 10 or not actual_combination.isdigit():
        raise ValueError("actual_combination must be exactly 10 digits")


def crack_safe(actual_combination: str, progress_callback: ProgressCallback = None) -> tuple[int, float]:
    """Crack the 10-digit safe combination.

    Args:
        actual_combination: The real 10-digit combination.
        progress_callback: Optional function called after each attempt. Used by
            the streaming endpoint to update the frontend in real time.

    Returns:
        A tuple of (number_of_attempts, time_taken_seconds).
    """
    validate_combination(actual_combination)
    start_time = time.perf_counter()
    attempts = 0

    def sound_tool(guess: str) -> int:
        return sum(
            1 for actual_digit, guess_digit in zip(actual_combination, guess)
            if actual_digit == guess_digit
        )

    baseline = ["0"] * 10
    result = ["?"] * 10

    def record_attempt(guess: str, score: int, status: str = "running") -> None:
        if progress_callback:
            progress_callback({
                "status": status,
                "attempts": attempts,
                "guess": guess,
                "score": score,
                "cracked_so_far": "".join(result),
            })

    baseline_guess = "".join(baseline)
    base_score = sound_tool(baseline_guess)
    attempts += 1
    record_attempt(baseline_guess, base_score)

    for index in range(10):
        found = False

        for digit in "123456789":
            guess_digits = baseline.copy()
            guess_digits[index] = digit
            guess = "".join(guess_digits)

            score = sound_tool(guess)
            attempts += 1
            record_attempt(guess, score)

            if score == base_score + 1:
                result[index] = digit
                found = True
                break

            if score == base_score - 1:
                result[index] = "0"
                found = True
                break

        if not found:
            # If none of 1-9 improves or decreases the score, the digit must be 0.
            result[index] = "0"

    cracked_combination = "".join(result)
    final_score = sound_tool(cracked_combination)
    attempts += 1
    record_attempt(cracked_combination, final_score, "completed")

    if final_score != 10:
        raise RuntimeError("Failed to crack the safe")

    time_taken = time.perf_counter() - start_time
    return attempts, time_taken
