"""Windows Job Objects — the platform's answer to rlimits and process groups.

The POSIX sandbox constrains a child by calling `setrlimit` between fork and
exec, and kills a runaway by signalling its process group. Windows has neither
primitive. Its equivalent is a Job Object: a kernel container you attach a
process to, carrying limits that apply to the process and everything it spawns,
and which can be terminated as a unit.

The mapping is close enough to be worth stating exactly:

    RLIMIT_AS / RLIMIT_DATA   ->  JOB_OBJECT_LIMIT_JOB_MEMORY
    RLIMIT_CPU                ->  JOB_OBJECT_LIMIT_JOB_TIME
    RLIMIT_NPROC              ->  JOB_OBJECT_LIMIT_ACTIVE_PROCESS
    setsid + killpg(SIGKILL)  ->  TerminateJobObject
    (no equivalent needed)    ->  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

That last flag is why this is more robust than the POSIX path in one respect: if
the parent dies without cleaning up, the kernel closes the job handle and takes
every process in it down, where an orphaned POSIX process group survives.

ctypes rather than pywin32, deliberately. A dependency that installs on one
platform complicates every install everywhere, and the four calls needed here are
a small enough surface to bind by hand.

Nothing in this module is imported on a non-Windows platform.
"""

from __future__ import annotations

import ctypes
from ctypes import wintypes

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

# JOBOBJECTINFOCLASS
_EXTENDED_LIMIT_INFORMATION = 9

# JOBOBJECT_BASIC_LIMIT_INFORMATION.LimitFlags
_LIMIT_JOB_TIME = 0x00000004
_LIMIT_ACTIVE_PROCESS = 0x00000008
_LIMIT_JOB_MEMORY = 0x00000200
_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x00000400
_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000

# A job time limit is expressed in 100-nanosecond ticks.
_TICKS_PER_SECOND = 10_000_000


class _IO_COUNTERS(ctypes.Structure):
    _fields_ = [
        ("ReadOperationCount", ctypes.c_ulonglong),
        ("WriteOperationCount", ctypes.c_ulonglong),
        ("OtherOperationCount", ctypes.c_ulonglong),
        ("ReadTransferCount", ctypes.c_ulonglong),
        ("WriteTransferCount", ctypes.c_ulonglong),
        ("OtherTransferCount", ctypes.c_ulonglong),
    ]


class _BASIC_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", wintypes.LARGE_INTEGER),
        ("PerJobUserTimeLimit", wintypes.LARGE_INTEGER),
        ("LimitFlags", wintypes.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wintypes.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", wintypes.DWORD),
        ("SchedulingClass", wintypes.DWORD),
    ]


class _EXTENDED_LIMIT_INFORMATION_STRUCT(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", _BASIC_LIMIT_INFORMATION),
        ("IoInfo", _IO_COUNTERS),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


kernel32.CreateJobObjectW.restype = wintypes.HANDLE
kernel32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
kernel32.SetInformationJobObject.restype = wintypes.BOOL
kernel32.SetInformationJobObject.argtypes = [
    wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD]
kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
kernel32.TerminateJobObject.restype = wintypes.BOOL
kernel32.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
kernel32.CloseHandle.restype = wintypes.BOOL
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]


class JobObjectError(OSError):
    """A Job Object call failed, so the limit it carried is not in force."""


def _check(ok: object, call: str) -> None:
    if not ok:
        code = ctypes.get_last_error()
        raise JobObjectError(
            f"{call} failed (Windows error {code}). The sandbox limit it carries "
            f"is not in force, so the analysis was not run.")


class Job:
    """A job carrying memory, CPU-time and process-count limits.

    Used as a context manager. On exit the handle is closed, and because the job
    is created with KILL_ON_JOB_CLOSE that also terminates anything still running
    inside it — the cleanup guarantee the POSIX path gets from killpg, except it
    holds even if this process dies unexpectedly.
    """

    def __init__(self, *, memory_mb: int, cpu_seconds: int,
                 active_process_limit: int = 64) -> None:
        self._handle = kernel32.CreateJobObjectW(None, None)
        _check(self._handle, "CreateJobObject")

        info = _EXTENDED_LIMIT_INFORMATION_STRUCT()
        basic = info.BasicLimitInformation
        basic.LimitFlags = (
            _LIMIT_JOB_MEMORY
            | _LIMIT_JOB_TIME
            | _LIMIT_ACTIVE_PROCESS
            | _LIMIT_KILL_ON_JOB_CLOSE
            # Without this a crashing child can raise a "program has stopped
            # working" dialog and sit there until the wall-clock timeout, turning
            # a fast failure into a two-minute one.
            | _LIMIT_DIE_ON_UNHANDLED_EXCEPTION
        )
        # Job-wide rather than per-process, matching RLIMIT_AS semantics: the
        # analysis and anything it spawns share one budget, so a child cannot
        # multiply the ceiling by forking.
        basic.PerJobUserTimeLimit = cpu_seconds * _TICKS_PER_SECOND
        basic.ActiveProcessLimit = active_process_limit
        info.BasicLimitInformation = basic
        info.JobMemoryLimit = memory_mb * 1024 * 1024

        try:
            _check(
                kernel32.SetInformationJobObject(
                    self._handle, _EXTENDED_LIMIT_INFORMATION,
                    ctypes.byref(info), ctypes.sizeof(info)),
                "SetInformationJobObject")
        except JobObjectError:
            kernel32.CloseHandle(self._handle)
            self._handle = None
            raise

    def assign(self, process_handle: int) -> None:
        """Attach a process, and everything it later spawns, to this job."""
        _check(
            kernel32.AssignProcessToJobObject(
                self._handle, wintypes.HANDLE(process_handle)),
            "AssignProcessToJobObject")

    def terminate(self, exit_code: int = 1) -> None:
        """Kill every process in the job. The equivalent of killpg(SIGKILL)."""
        if self._handle is not None:
            kernel32.TerminateJobObject(self._handle, exit_code)

    def close(self) -> None:
        if self._handle is not None:
            kernel32.CloseHandle(self._handle)
            self._handle = None

    def __enter__(self) -> Job:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


__all__ = ["Job", "JobObjectError"]
