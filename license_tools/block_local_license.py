import argparse
import json
import os
from datetime import datetime
from pathlib import Path


def appdata_hospai_dir() -> Path:
    base = os.environ.get("APPDATA")
    if base:
        return Path(base) / "HospAI"
    return Path.home() / "AppData" / "Roaming" / "HospAI"


def main() -> None:
    parser = argparse.ArgumentParser(description="Block or unblock local HospAI access on this Windows user profile")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--block", action="store_true", help="Create/update local block.json")
    group.add_argument("--unblock", action="store_true", help="Remove local block.json")
    parser.add_argument("--reason", default="Blocked by admin", help="Reason stored in block.json when blocking")
    args = parser.parse_args()

    licenses_dir = appdata_hospai_dir() / "licenses"
    licenses_dir.mkdir(parents=True, exist_ok=True)
    block_path = licenses_dir / "block.json"

    if args.block:
        payload = {
            "blocked": True,
            "reason": args.reason or "Blocked by admin",
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        block_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"HospAI access blocked on this system: {block_path}")
        print(f"Reason: {payload['reason']}")
        return

    if block_path.exists():
        block_path.unlink()
        print(f"HospAI access unblocked on this system: {block_path}")
    else:
        print(f"No local block file found: {block_path}")


if __name__ == "__main__":
    main()
