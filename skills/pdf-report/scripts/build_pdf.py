#!/usr/bin/env python3
"""Render HTML report to PDF via WeasyPrint.

Usage:
    python3 build_pdf.py --html /tmp/report.html [--title "Title"] [--out /path/dir]

Output filename: report-YYYY-MM-DD-HHMMSS.pdf

Output directory resolution order:
    1. --out if provided (must be an existing writable directory)
    2. VMware shared folder /mnt/hgfs/ai-report-mnt (only if real vmhgfs-fuse mount and writable)
    3. VMware shared folder /mnt/hgfs/AI-Reports (same checks)
    4. VirtualBox shared folder /media/sf_AI-Reports (same checks)
    5. ~/reports (always usable fallback)

The script never assumes a mount exists just because the path does. It verifies
the filesystem type and performs a write-then-delete probe.
"""

import argparse
import datetime
import os
import sys

# Shared folder candidates in priority order: (path, required mount type)
CANDIDATES = [
    ("/mnt/hgfs/ai-report-mnt", "vmhgfs-fuse"),
    ("/mnt/hgfs/AI-Reports", "vmhgfs-fuse"),
    ("/media/sf_AI-Reports", "vboxsf"),
]


def is_shared_mount(path, expected_type):
    """Return True if path is inside a mount of the expected filesystem type.

    VMware/VirtualBox mount the whole share at /mnt/hgfs (or /media/sf_<name>),
    while the shared folder itself is a subdirectory. So we match by walking up
    to the nearest mount point rather than requiring an exact path match.
    """
    if not os.path.isdir(path):
        return False
    path = os.path.abspath(path)
    try:
        mounts = []
        with open("/proc/mounts", "r", encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 3:
                    mounts.append((parts[1], parts[2]))
    except OSError:
        return False

    def matches(fstype):
        return fstype == expected_type or fstype == "fuse." + expected_type

    # Sort mount points longest-first so we match the most specific one.
    mounts.sort(key=lambda m: len(m[0]), reverse=True)
    for mount_point, fstype in mounts:
        if path == mount_point or path.startswith(mount_point.rstrip("/") + "/"):
            return matches(fstype)
    return False


def is_writable_dir(path):
    """Return True if path is a directory and a probe file can be written then removed."""
    if not os.path.isdir(path):
        return False
    probe = os.path.join(path, ".pdf_report_write_probe")
    try:
        with open(probe, "w", encoding="utf-8") as f:
            f.write("probe")
        os.remove(probe)
        return True
    except OSError:
        return False


def resolve_output_dir(forced=None):
    """Resolve the output directory. Returns (dir_path, source_label)."""
    if forced:
        if os.path.isdir(forced) and is_writable_dir(forced):
            return os.path.abspath(forced), "user-specified"
        print(
            f"[pdf-report] --out path not a writable directory: {forced}. "
            "Falling back to default.",
            file=sys.stderr,
        )

    for path, fstype in CANDIDATES:
        if is_shared_mount(path, fstype) and is_writable_dir(path):
            return os.path.abspath(path), f"shared-folder ({fstype})"

    fallback = os.path.expanduser("~/reports")
    os.makedirs(fallback, exist_ok=True)
    return fallback, "local (~/reports)"


def build_filename(now):
    return "report-" + now.strftime("%Y-%m-%d-%H%M%S") + ".pdf"


def main():
    parser = argparse.ArgumentParser(description="Render HTML to PDF via WeasyPrint")
    parser.add_argument("--html", required=True, help="Path to input HTML file")
    parser.add_argument("--title", default="", help="Report title (metadata only)")
    parser.add_argument("--out", default=None, help="Output directory override")
    args = parser.parse_args()

    html_path = os.path.abspath(args.html)
    if not os.path.isfile(html_path):
        print(f"[pdf-report] HTML file not found: {html_path}", file=sys.stderr)
        sys.exit(1)

    try:
        from weasyprint import HTML
    except ImportError:
        print(
            "[pdf-report] WeasyPrint not installed. Install with: "
            "apt install weasyprint  (or pip3 install weasyprint)",
            file=sys.stderr,
        )
        sys.exit(1)

    out_dir, label = resolve_output_dir(args.out)
    now = datetime.datetime.now()
    out_file = os.path.join(out_dir, build_filename(now))

    # Never overwrite an existing file (timestamp collision is extremely unlikely,
    # but guard anyway).
    if os.path.exists(out_file):
        suffix = 1
        base, ext = os.path.splitext(out_file)
        while os.path.exists(f"{base}-{suffix}{ext}"):
            suffix += 1
        out_file = f"{base}-{suffix}{ext}"

    try:
        HTML(filename=html_path).write_pdf(out_file)
    except Exception as exc:  # noqa: BLE001 - surface any render error clearly
        print(f"[pdf-report] WeasyPrint render failed: {exc}", file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(out_file) or os.path.getsize(out_file) == 0:
        print("[pdf-report] Output PDF is missing or empty.", file=sys.stderr)
        sys.exit(1)

    size_kb = os.path.getsize(out_file) / 1024.0
    print(f"[pdf-report] PDF created: {out_file}")
    print(f"[pdf-report] output dir : {out_dir} ({label})")
    print(f"[pdf-report] size       : {size_kb:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
