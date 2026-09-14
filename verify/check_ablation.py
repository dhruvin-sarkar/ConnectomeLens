"""Check the ablation report gives a concrete before/after route comparison."""

import json

from pipeline.ablation import ABLATION_PATH, PRIMARY
from pipeline.common import RESULTS


def main() -> None:
    report = (RESULTS / "ablation_report.md").read_text(encoding="utf-8")
    assert "structural" in report.lower() and "behavior" in report.lower(), "Report lacks the structural-only framing"

    result = json.loads(ABLATION_PATH.read_text(encoding="utf-8"))
    primary = next(r for r in result["pairs"] if (r["source"], r["target"]) == PRIMARY)
    before, after = primary["before"], primary["after"]
    assert before and isinstance(before["hops"], int) and result["removed"] in before["types"], "No baseline route"
    assert after is None or isinstance(after["hops"], int), "After-route lacks a hop count"
    assert after is None or result["removed"] not in after["types"], "Removed type still on the route"
    after_text = f"{after['hops']} hops" if after else "disconnected"
    print(f"OK: removed {result['removed']}; {PRIMARY[0]} -> {PRIMARY[1]} {before['hops']} hops -> {after_text} ({primary['outcome']})")


if __name__ == "__main__":
    main()
