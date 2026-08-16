# -*- coding: utf-8 -*-
"""Remove neighbouring answers accidentally captured in answer crop images.

The printed answer book places every answer number in a small dark square.
That gives us a much stronger boundary signal than image dimensions: a normal
answer crop contains exactly one such marker. This repair is deliberately
conservative and only changes images with multiple high-confidence markers.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parent.parent
BANK_DIR = PROJECT_ROOT / "public" / "bank"


# Most faulty crops start at the requested answer and merely continue into the
# next one. These six crops instead start at an earlier answer; their target
# marker was verified against the printed number in the source scan.
TARGET_MARKER_INDEX = {
    "三年级_13_拓展篇_1": 1,
    "三年级_18_拓展篇_1": 1,
    "四年级_2_兴趣篇_7": 1,
    "四年级_20_兴趣篇_7": 1,
    "四年级_20_超越篇_2": 1,
    "五年级_19_兴趣篇_7": 2,
    "六年级_23_拓展篇_10": 3,
}


def find_number_markers(image: Image.Image) -> list[tuple[int, int, int, int]]:
    """Return high-confidence answer-number squares as (y, x, width, height)."""
    gray = np.array(image.convert("L"))
    binary = cv2.threshold(gray, 210, 255, cv2.THRESH_BINARY_INV)[1]
    markers = []
    for contour in cv2.findContours(
        binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )[0]:
        x, y, width, height = cv2.boundingRect(contour)
        fill_ratio = cv2.contourArea(contour) / max(1, width * height)
        if (
            x <= 140
            and 23 <= width <= 29
            and 23 <= height <= 29
            and fill_ratio >= 0.80
        ):
            markers.append((y, x, width, height))
    return sorted(markers)


def crop_path(bank_dir: Path, url: str | None) -> Path | None:
    if not url:
        return None
    return bank_dir / "crops" / Path(url.replace("\\", "/")).name


def repair(bank_dir: Path, check_only: bool = False) -> tuple[int, list[str]]:
    questions = json.loads((bank_dir / "questions.json").read_text(encoding="utf-8"))
    repaired = 0
    remaining = []

    for question in questions:
        path = crop_path(bank_dir, question.get("ans_slice_url"))
        if not path or not path.exists():
            continue

        with Image.open(path) as source:
            image = source.convert("RGB")
        markers = find_number_markers(image)
        if not markers:
            continue

        question_id = str(question.get("id", ""))
        target_index = (
            TARGET_MARKER_INDEX.get(question_id, 0) if len(markers) > 1 else 0
        )
        if target_index >= len(markers):
            remaining.append(question_id)
            continue

        target_y = markers[target_index][0]
        has_next_marker = target_index + 1 < len(markers)
        # Put the marker near the top while retaining a small clean margin.
        # The old extractor used 15px and frequently kept the bottom of a
        # previous line above the marker.
        top = max(0, target_y - 3)
        bottom = (
            min(
                image.height,
                max(top + 45, markers[target_index + 1][0] - 12),
            )
            if has_next_marker
            else image.height
        )

        if top == 0 and bottom == image.height:
            continue

        if check_only:
            remaining.append(question_id)
            continue

        image.crop((0, top, image.width, bottom)).save(path)
        repaired += 1

    return repaired, remaining


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("bank_dir", nargs="?", default=str(BANK_DIR))
    parser.add_argument(
        "--check",
        action="store_true",
        help="report multi-answer crops without modifying them",
    )
    args = parser.parse_args()
    bank_dir = Path(args.bank_dir).resolve()
    repaired, remaining = repair(bank_dir, check_only=args.check)
    if args.check:
        print(f"Multi-answer crops remaining: {len(remaining)}")
        for question_id in remaining:
            print(question_id)
        raise SystemExit(1 if remaining else 0)
    print(f"Repaired answer crop boundaries: {repaired}")
    if remaining:
        print("Skipped ambiguous crops:", ", ".join(remaining))


if __name__ == "__main__":
    main()
