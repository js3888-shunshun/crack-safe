import pytest

from app.crack_safe import crack_safe, validate_combination


def test_crack_safe_sample():
    attempts, time_taken = crack_safe("0800666666")
    assert attempts == 49
    assert time_taken >= 0


@pytest.mark.parametrize("combination", ["0000000000", "9999999999", "1234567890", "9081726354"])
def test_crack_safe_valid_combinations(combination):
    attempts, time_taken = crack_safe(combination)
    assert 1 <= attempts <= 92
    assert time_taken >= 0


@pytest.mark.parametrize("bad_input", ["", "123", "12345678901", "abcdefghij", 1234567890])
def test_validate_combination_rejects_bad_input(bad_input):
    with pytest.raises(ValueError):
        validate_combination(bad_input)
