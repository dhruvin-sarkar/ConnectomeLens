"""Check that the schema notes name the fields the pipeline relies on, with live example values."""

import re

from pipeline.common import RESULTS
from pipeline.inspect_schema import REQUIRED_FIELDS


def main() -> None:
    path = RESULTS / "schema_notes.md"
    assert path.exists(), f"{path} missing; run python -m pipeline.inspect_schema"
    text = path.read_text(encoding="utf-8")
    for role, prop in REQUIRED_FIELDS.items():
        match = re.search(rf"^- {re.escape(role)}: `{re.escape(prop)}` \(example: `(.+)`\)$", text, re.MULTILINE)
        assert match and match.group(1).strip() not in {"", "nan", "None"}, f"No example value for {role} ({prop})"
    print(f"OK: schema notes name {len(REQUIRED_FIELDS)} required fields with example values")


if __name__ == "__main__":
    main()
