#!/usr/bin/env python3
"""Repeatable demo verification; all subprocesses use argv and shell=False."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def trim_right(raw):
    """Only remove ASCII space/tab before each line ending or EOF."""
    return re.sub(rb"[ \t]+(?=\r\n|\r|\n|$)", b"", raw)


def location(raw, offset):
    prefix = raw[:offset]
    endings = list(re.finditer(rb"\r\n|\r|\n", prefix))
    start = endings[-1].end() if endings else 0
    return {"line": len(endings) + 1, "byte_column": offset - start + 1, "byte_offset": offset}


def first_difference(actual, expected, encoding="cp936"):
    a, b = trim_right(actual), trim_right(expected)
    pos = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
    if pos == len(a) == len(b):
        return None
    start, stop = max(0, pos - 35), pos + 70
    return {
        **location(b, pos),
        "actual_context": a[start:stop].decode(encoding, errors="backslashreplace"),
        "demo_context": b[start:stop].decode(encoding, errors="backslashreplace"),
        "actual_bytes": repr(a[start:stop]), "demo_bytes": repr(b[start:stop]),
        "actual_trimmed_length": len(a), "demo_trimmed_length": len(b),
    }


def run_process(argv, stdin, timeout, cwd=None):
    start = time.monotonic()
    try:
        cp = subprocess.run(argv, input=stdin, capture_output=True, timeout=timeout, cwd=cwd, shell=False)
        return {"argv": argv, "returncode": cp.returncode, "timeout": False,
                "duration_s": round(time.monotonic() - start, 6), "stdout": cp.stdout, "stderr": cp.stderr}
    except subprocess.TimeoutExpired as error:
        return {"argv": argv, "returncode": None, "timeout": True,
                "duration_s": round(time.monotonic() - start, 6),
                "stdout": error.stdout or b"", "stderr": error.stderr or b""}
    except OSError as error:
        return {"argv": argv, "returncode": None, "timeout": False,
                "duration_s": round(time.monotonic() - start, 6),
                "error": str(error), "stdout": b"", "stderr": b""}


def run_record(record, folder, stem, encoding):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    result = {k: v for k, v in record.items() if k not in ("stdout", "stderr")}
    for name in ("stdout", "stderr"):
        filename = f"{stem}.{name}.bin"
        (folder / filename).write_bytes(record[name])
        result[f"{name}_file"] = filename
        result[f"{name}_text"] = record[name].decode(encoding, errors="backslashreplace")
    return result


def resolve_compare(value):
    return value or shutil.which("txt_compare.exe") or shutil.which("txt_compare")


def compare_authority(tool, actual, demo, folder, encoding, timeout=5):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    actual_path, demo_path = folder / "actual.txt", folder / "demo.txt"
    actual_path.write_bytes(actual)
    demo_path.write_bytes(demo)
    run = run_process([str(tool), "--file1", str(actual_path.resolve()), "--file2", str(demo_path.resolve()), "--trim", "right"], b"", timeout)
    # Version 2.0.4 returns zero both for equal and different files.
    # Its Chinese verdict, rather than returncode alone, is authoritative.
    record = run_record(run, folder, "txt_compare", "cp936")
    verdict = run["stdout"].strip()
    record["equal"] = run["returncode"] == 0 and not run["timeout"] and verdict == "文件相同.".encode("cp936")
    record["verdict_recognized"] = verdict in ("文件相同.".encode("cp936"), "文件不同.".encode("cp936"))
    return record


def command(args, prefix):
    direct = getattr(args, prefix)
    file = getattr(args, prefix + "_argv_file")
    if file:
        value = read_json(file)
        if not isinstance(value, list) or not value or not all(isinstance(x, str) for x in value):
            raise ValueError(f"{prefix} argv file must contain a nonempty JSON string array")
        return value
    return [str(Path(direct).resolve())]


def fingerprint(argv):
    file = Path(argv[0])
    if file.is_file():
        return hashlib.sha256(file.read_bytes()).hexdigest()
    return None


def cached_demo(argv, stdin, timeout, folder, encoding, cwd):
    identity = json.dumps({"argv": argv, "exe_sha256": fingerprint(argv), "stdin_hex": stdin.hex(), "cwd": cwd}, sort_keys=True).encode()
    cache = Path(folder) / hashlib.sha256(identity).hexdigest()
    meta = cache / "run.json"
    if meta.is_file():
        record = read_json(meta)
        record["stdout"] = (cache / "stdout.bin").read_bytes()
        record["stderr"] = (cache / "stderr.bin").read_bytes()
        record["cache_hit"] = True
        return record
    record = run_process(argv, stdin, timeout, cwd)
    record["cache_hit"] = False
    if record["returncode"] == 0 and not record["timeout"]:
        cache.mkdir(parents=True, exist_ok=True)
        for field in ("stdout", "stderr"):
            (cache / f"{field}.bin").write_bytes(record[field])
        save_json(meta, {k: v for k, v in record.items() if k not in ("stdout", "stderr")})
    return record


def verify(args):
    tests = read_json(args.tests)
    actual_argv, demo_argv = command(args, "program"), command(args, "demo")
    out = Path(args.out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    tool = resolve_compare(args.txt_compare)
    if not tool:
        raise ValueError("txt_compare is required for authoritative verification; supply --txt-compare")
    summary = {"test_set": str(Path(args.tests).resolve()), "name": tests.get("name"),
               "program_argv": actual_argv, "demo_argv": demo_argv,
               "program_sha256": fingerprint(actual_argv), "demo_sha256": fingerprint(demo_argv),
               "encoding": args.encoding, "input_encoding": args.input_encoding,
               "txt_compare": tool, "comparison_arguments": ["--trim", "right"],
               "newline_policy": "strict: CRLF/LF/CR and final newline are preserved; no conversion",
               "cases": []}
    cache = args.demo_cache or str(Path(args.tests).resolve().parent / ".demo-cache")
    for index, case in enumerate(tests["cases"], 1):
        case_id = case.get("id", f"case-{index:03d}")
        safe_id = re.sub(r"[^A-Za-z0-9_.-]", "_", case_id)
        folder = out / f"{index:03d}-{safe_id}"
        folder.mkdir(parents=True, exist_ok=True)
        stdin = case.get("stdin", "").encode(args.input_encoding)
        (folder / "stdin.bin").write_bytes(stdin)
        timeout = float(case.get("timeout", args.timeout))
        demo = cached_demo(demo_argv, stdin, timeout, cache, args.encoding, args.demo_cwd)
        actual = run_process(actual_argv, stdin, timeout, args.program_cwd)
        record = {"id": case_id, "note": case.get("note", ""), "stdin": case.get("stdin", ""),
                  "demo": run_record(demo, folder, "demo", args.encoding),
                  "program": run_record(actual, folder, "program", args.encoding)}
        good_runs = all(x["returncode"] == 0 and not x["timeout"] for x in (demo, actual))
        record["raw_python_difference"] = first_difference(actual["stdout"], demo["stdout"], args.encoding)
        record["raw_authority"] = compare_authority(tool, actual["stdout"], demo["stdout"], folder / "raw-comparison", args.encoding)
        record["python_difference"] = record["raw_python_difference"]
        record["pass"] = good_runs and record["raw_authority"]["equal"] and record["python_difference"] is None
        save_json(folder / "record.json", record)
        summary["cases"].append(record)
        if not record["pass"]:
            print(f"FAIL {case_id}: {record['python_difference'] or 'process/authority failure'}")
    summary["total"] = len(summary["cases"])
    summary["passed"] = sum(x["pass"] for x in summary["cases"])
    summary["failed"] = summary["total"] - summary["passed"]
    save_json(out / "summary.json", summary)
    print(f"{summary['passed']}/{summary['total']} passed; {out / 'summary.json'}")
    return int(summary["failed"] != 0)


PROBES = [
    ("identical", b"ab\r\n", b"ab\r\n", True),
    ("right-spaces", b"ab \t\r\n", b"ab\r\n", True),
    ("right-space-at-eof", b"ab \t", b"ab", True),
    ("left-space", b" ab\r\n", b"ab\r\n", False),
    ("inner-space", b"a b\r\n", b"ab\r\n", False),
    ("line-endings", b"ab\n", b"ab\r\n", False),
    ("terminal-newline", b"ab", b"ab\r\n", False),
    ("extra-blank-line", b"ab\r\n\r\n", b"ab\r\n", False),
    ("blank-line-space", b"ab\r\n \t\r\n", b"ab\r\n\r\n", True),
    ("vertical-tab", b"ab\v\r\n", b"ab\r\n", False),
    ("form-feed", b"ab\f\r\n", b"ab\r\n", False),
    ("empty-v-newline", b"", b"\r\n", False),
]


def probe(args):
    tool = resolve_compare(args.txt_compare)
    if not tool:
        raise ValueError("txt_compare not found")
    folder = Path(args.out_dir).resolve()
    results = []
    for name, actual, demo, expected in PROBES:
        record = {"name": name, "python_expected_equal": expected,
                  "actual_repr": repr(actual), "demo_repr": repr(demo),
                  "authority": compare_authority(tool, actual, demo, folder / name, "cp936")}
        record["authority_equal"] = record["authority"]["equal"]
        record["python_matches_authority"] = record["authority_equal"] == expected
        results.append(record)
        print(f"{name}: equal={record['authority_equal']}; exit={record['authority']['returncode']}")
    save_json(folder / "probe.json", results)
    return int(not all(x["python_matches_authority"] for x in results))


def selftest():
    for name, actual, demo, equal in PROBES:
        assert (first_difference(actual, demo) is None) == equal, name
    assert first_difference(b"a\r\nb", b"a\r\nc")["line"] == 2
    assert first_difference(b"a\r\nb", b"a\r\nc")["byte_column"] == 1
    child = run_process([sys.executable, "-c", "import sys;sys.stdout.buffer.write(sys.stdin.buffer.read())"], b"a\x00b\r\n", 3)
    assert child["returncode"] == 0 and child["stdout"] == b"a\x00b\r\n"
    timeout = run_process([sys.executable, "-c", "import time;time.sleep(1)"], b"", 0.05)
    assert timeout["timeout"] and timeout["returncode"] is None
    code = run_process([sys.executable, "-c", "raise SystemExit(7)"], b"", 3)
    assert code["returncode"] == 7
    print("selftest: 12 comparison scenarios, difference positions, binary I/O, timeout and exit code passed")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("selftest")
    p = commands.add_parser("probe", help="Investigate the real txt_compare semantics")
    p.add_argument("--txt-compare")
    p.add_argument("--out-dir", required=True)
    p = commands.add_parser("run", help="Run all cases and compare with cached demo output")
    for prefix in ("program", "demo"):
        g = p.add_mutually_exclusive_group(required=True)
        g.add_argument("--" + prefix)
        g.add_argument("--" + prefix + "-argv-file", help="JSON argv array; supports ssh without a local shell")
        p.add_argument("--" + prefix + "-cwd")
    p.add_argument("--tests", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--demo-cache")
    p.add_argument("--encoding", default="cp936")
    p.add_argument("--input-encoding", default="cp936")
    p.add_argument("--timeout", default=3.0, type=float)
    p.add_argument("--txt-compare")
    args = parser.parse_args()
    try:
        return selftest() if args.action == "selftest" else probe(args) if args.action == "probe" else verify(args)
    except (ValueError, OSError, KeyError, UnicodeError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    sys.exit(main())
