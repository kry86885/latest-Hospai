import argparse
import csv
import hmac
import hashlib
import json
import sys
import base64
from datetime import datetime, date
from pathlib import Path

SECRET = "K@lpra#HospAI$Offl1ne!V4"
EPOCH = date(2024, 1, 1)
ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@$#%"
SPECIALS = "@$#%"
NEW_LICENSE_PREFIX = "HAI1-"
NINE_DIGIT_MAX_DAYS = 4095
NINE_CHAR_SIG_MOD = 1 << 20  # 1,048,576 fits date+minute+signature inside 8 base-40 chars plus 1 special check char
NINE_CHAR_BODY_LENGTH = 8


def base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def parse_expiry(value: str) -> datetime:
    raw = " ".join((value or "").strip().split())
    if not raw:
        raise ValueError("Expiry is required.")

    formats = [
        "%Y-%m-%d %I:%M:%S %p",
        "%Y-%m-%d %I:%M %p",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            pass

    try:
        parsed_date = datetime.strptime(raw, "%Y-%m-%d")
        return parsed_date.replace(hour=23, minute=59, second=0, microsecond=0)
    except ValueError as exc:
        raise ValueError(
            "Expiry must be YYYY-MM-DD, YYYY-MM-DD HH:MM:SS, or YYYY-MM-DD hh:mm AM/PM."
        ) from exc


def normalize_to_9_char_precision(value: datetime) -> datetime:
    """The 9-character offline code stores date + hour/minute + device signature.

    Seconds are normalized to 00 so the app blocks at the selected minute.
    For example, 05:30 PM expires at 05:30:00 PM.
    """
    return value.replace(second=0, microsecond=0)


def format_expiry(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %I:%M:%S %p")


def nine_char_signature(device_id: str, days: int, minute_of_day: int) -> int:
    digest = hmac.new(
        SECRET.encode("utf-8"),
        f"{device_id.strip().upper()}|{days}|{minute_of_day}|9CHAR-TIME".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return int.from_bytes(digest[:4], "big") & (NINE_CHAR_SIG_MOD - 1)


def nine_char_check_char(device_id: str, body: str) -> str:
    digest = hmac.new(
        SECRET.encode("utf-8"),
        f"{device_id.strip().upper()}|{body.upper()}|9CHAR-CHECK".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return SPECIALS[digest[0] % len(SPECIALS)]


def nine_char_time_code(device_id: str, expiry: datetime) -> str:
    normalized = normalize_to_9_char_precision(expiry)
    days = (normalized.date() - EPOCH).days
    if days < 0 or days > NINE_DIGIT_MAX_DAYS:
        raise SystemExit("Expiry must be between 2024-01-01 and 2035-03-19 for 9-character offline codes.")
    minute_of_day = normalized.hour * 60 + normalized.minute
    signature = nine_char_signature(device_id, days, minute_of_day)
    expiry_packed = days * 1440 + minute_of_day
    packed = expiry_packed * NINE_CHAR_SIG_MOD + signature
    max_value = len(ALPHABET) ** NINE_CHAR_BODY_LENGTH
    if packed >= max_value:
        raise SystemExit("Expiry is outside the supported 9-character license range.")
    body = to_activation_code_base(packed).upper().rjust(NINE_CHAR_BODY_LENGTH, "0")[-NINE_CHAR_BODY_LENGTH:]
    return body + nine_char_check_char(device_id, body)


def signed_time_license(device_id: str, hospital: str, expiry: datetime) -> str:
    payload = {
        "version": 3,
        "device_id": device_id.strip().upper(),
        "hospital": hospital.strip(),
        "expiry": format_expiry(expiry),
        "format": "signed-time",
    }
    payload_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    payload_part = base64url(payload_json)
    signature = base64url(hmac.new(SECRET.encode("utf-8"), payload_part.encode("ascii"), hashlib.sha256).digest())[:32]
    return f"{NEW_LICENSE_PREFIX}{payload_part}.{signature}"


def to_activation_code_base(number: int) -> str:
    if number < 0:
        raise ValueError("number must be positive")
    if number == 0:
        return "0"
    chars = []
    while number:
        number, rem = divmod(number, len(ALPHABET))
        chars.append(ALPHABET[rem])
    return "".join(reversed(chars))


def legacy_signature(device_id: str, days: int) -> int:
    digest = hmac.new(
        SECRET.encode("utf-8"),
        f"{device_id.upper()}|{days}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    raw = int.from_bytes(digest[:4], "big")
    return (raw >> 2) & ((1 << 30) - 1)


def legacy_check_char(device_id: str, days: int, body: str) -> str:
    digest = hmac.new(
        SECRET.encode("utf-8"),
        f"{device_id.upper()}|{days}|{body.upper()}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return SPECIALS[digest[0] % len(SPECIALS)]


def legacy_short_code(device_id: str, expiry: datetime) -> str:
    days = (expiry.date() - EPOCH).days
    if days < 0 or days > 4095:
        raise SystemExit("Expiry must be between 2024-01-01 and 2035-03-19 for old 9-character offline codes.")
    packed = (days << 30) | legacy_signature(device_id, days)
    body = to_activation_code_base(packed).upper().rjust(8, "0")[-8:]
    return body + legacy_check_char(device_id, days, body)


def append_client_record(device_id: str, hospital: str, expiry_display: str, code: str) -> Path:
    root = Path(__file__).resolve().parents[1]
    clients_dir = root / "clients"
    clients_dir.mkdir(parents=True, exist_ok=True)
    csv_path = clients_dir / "clients_registry.csv"
    file_exists = csv_path.exists()
    with csv_path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["generated_at", "hospital", "device_id", "expiry", "activation_code"],
        )
        if not file_exists:
            writer.writeheader()
        writer.writerow(
            {
                "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "hospital": hospital,
                "device_id": device_id,
                "expiry": expiry_display,
                "activation_code": code,
            }
        )
    return csv_path


def main():
    parser = argparse.ArgumentParser(description="Generate HospAI offline 9-character activation code")
    parser.add_argument("--device-id", required=True, help="Device ID shown by HospAI activation screen")
    parser.add_argument("--hospital", required=True, help="Hospital/customer name for registry records")
    parser.add_argument("--expiry", required=True, help="Expiry: YYYY-MM-DD, YYYY-MM-DD HH:MM:SS, or YYYY-MM-DD hh:mm AM/PM")
    parser.add_argument("--legacy-short-code", action="store_true", help="Generate the old 9-character date-only code")
    parser.add_argument("--signed-code", action="store_true", help="Generate the long signed code for internal testing only")
    parser.add_argument("--no-registry", action="store_true", help="Print code only; do not update clients_registry.csv")
    args = parser.parse_args()

    device_id = args.device_id.strip().upper()
    hospital = args.hospital.strip()
    try:
        expiry = parse_expiry(args.expiry)
    except ValueError as exc:
        raise SystemExit(str(exc))

    if args.legacy_short_code:
        code = legacy_short_code(device_id, expiry)
        effective_expiry = expiry.replace(hour=23, minute=59, second=59, microsecond=0)
        code_note = "Old 9-character date-only code. Use only for backward compatibility."
    elif args.signed_code:
        effective_expiry = expiry
        code = signed_time_license(device_id, hospital, effective_expiry)
        code_note = "Long signed code generated for internal testing only. Client delivery should use the default 9-character code."
    else:
        effective_expiry = normalize_to_9_char_precision(expiry)
        code = nine_char_time_code(device_id, effective_expiry)
        code_note = "9-character offline code. Uses A-Z, 0-9, and a mandatory special character (@, $, #, or %). Expiry is enforced at the exact selected minute."

    expiry_display = format_expiry(effective_expiry)
    print(f"Device ID: {device_id}")
    print(f"Hospital: {hospital}")
    print(f"Expiry: {expiry_display}")
    print(f"Activation Code: {code}")
    print(f"Code Length: {len(code)}")
    print("Allowed Characters: A-Z, 0-9, @, $, #, %")
    print(f"Note: {code_note}")

    if not args.no_registry:
        csv_path = append_client_record(device_id, hospital, expiry_display, code)
        print(f"Saved client record: {csv_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
