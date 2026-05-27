import ctypes
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import tkinter as tk
import urllib.error
import urllib.request
import wave
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from urllib.parse import urlparse

if os.name == "nt":
    from ctypes import wintypes

try:
    from tkinterdnd2 import DND_FILES, TkinterDnD

    HAS_DND = True
except ImportError:
    HAS_DND = False

SUPPORTED = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".opus", ".webm", ".mp4", ".aac"}
LANGUAGES = {
    "Auto detect": "auto",
    "Italian": "it",
    "English": "en",
    "French": "fr",
    "German": "de",
    "Spanish": "es",
    "Portuguese": "pt",
}
MODEL_REPO = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"
MODELS = {
    "Tiny Q5": {
        "filename": "ggml-tiny-q5_1.bin",
        "description": "Fastest and lightest. Best for older hardware.",
    },
    "Base Q5": {
        "filename": "ggml-base-q5_1.bin",
        "description": "Balanced choice for slower laptops.",
    },
    "Small Q5": {
        "filename": "ggml-small-q5_1.bin",
        "description": "Better quality with modest resource use.",
    },
    "Medium Q5": {
        "filename": "ggml-medium-q5_0.bin",
        "description": "Higher accuracy while staying quantized.",
    },
    "Turbo Q5": {
        "filename": "ggml-large-v3-turbo-q5_0.bin",
        "description": "Fast and accurate if you have some headroom.",
    },
    "Turbo Q8": {
        "filename": "ggml-large-v3-turbo-q8_0.bin",
        "description": "Sharper output, but heavier than Q5.",
    },
}

BG = "#000000"
CARD = "#000000"
TEXT = "#ffffff"
MUTED = "#cfcfcf"
BORDER = "#2a2a2a"
WHITE = "#ffffff"
WHITE_SOFT = "#d9d9d9"
GREEN = "#2bd66b"
GREEN_DARK = "#1ea954"
GREEN_SOFT = "#0d2014"
RED = "#ff6b6b"
RED_SOFT = "#2a0d0d"
if sys.platform == "darwin":
    UI_FONT = ".AppleSystemUIFont"
    MONO_FONT = "SF Mono"
elif os.name == "nt":
    UI_FONT = "Segoe UI"
    MONO_FONT = "Consolas"
else:
    UI_FONT = "Helvetica"
    MONO_FONT = "Menlo"

SCROLLBAR_WIDTH = 10
THUMB_MIN_HEIGHT = 30
YOUTUBE_URL_PATTERN = re.compile(
    r"^https?://(?:www\.|music\.)?(?:youtube\.com/(?:watch\?[^#]*?v=|playlist\?|shorts/)|youtu\.be/)[^\s]+$",
    re.IGNORECASE,
)
WHISPER_SEGMENT_PATTERN = re.compile(
    r"^\s*\[\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}\]\s+(.+?)\s*$"
)


def _is_frozen_app():
    return bool(getattr(sys, "frozen", False))


def _default_app_dir():
    if _is_frozen_app():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def _bundle_dir():
    if _is_frozen_app() and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS).resolve()
    return None


def _default_runtime_dir(app_dir):
    if _is_frozen_app() and os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            return Path(local_app_data) / "WhisperDrop"
        return Path.home() / "AppData" / "Local" / "WhisperDrop"
    return app_dir


def _resolve_app_dirs():
    app_dir = Path(os.environ.get("WHISPERDROP_APP_DIR", _default_app_dir())).expanduser().resolve()
    runtime_dir = Path(os.environ.get("WHISPERDROP_RUNTIME_DIR", _default_runtime_dir(app_dir))).expanduser().resolve()
    runtime_dir.mkdir(parents=True, exist_ok=True)
    return app_dir, runtime_dir


def _tool_roots(app_dir, runtime_dir):
    roots = []
    base_dirs = [runtime_dir, app_dir]
    bundle_dir = _bundle_dir()
    if bundle_dir:
        base_dirs.append(bundle_dir)

    for base_dir in base_dirs:
        roots.extend(
            [
                base_dir / ".tools" / "ffmpeg" / "bin",
                base_dir / ".tools" / "whisper.cpp" / "Release",
                base_dir / ".tools" / "whisper.cpp" / "build" / "bin" / "Release",
                base_dir / ".tools" / "whisper.cpp" / "build" / "bin",
            ]
        )

    unique_roots = []
    seen = set()
    for root in roots:
        normalized = str(root)
        if normalized not in seen:
            seen.add(normalized)
            unique_roots.append(root)
    return unique_roots


def _find_binary_in_roots(names, roots):
    if _is_frozen_app():
        for root in roots:
            for name in names:
                candidate = root / (f"{name}.exe" if os.name == "nt" else name)
                if candidate.exists():
                    return str(candidate)

    for name in names:
        resolved = shutil.which(name)
        if resolved:
            return resolved

    for root in roots:
        for name in names:
            candidate = root / (f"{name}.exe" if os.name == "nt" else name)
            if candidate.exists():
                return str(candidate)

    return None


def _has_yt_dlp_module():
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        return False
    return True


def _run_self_test():
    app_dir, runtime_dir = _resolve_app_dirs()
    checks = {
        "app_dir": str(app_dir),
        "runtime_dir": str(runtime_dir),
        "frozen": _is_frozen_app(),
        "python": sys.version.split()[0],
        "tkinter": False,
        "tkinterdnd2": False,
        "yt_dlp": False,
        "ffmpeg": None,
        "whisper_cpp": None,
    }

    try:
        import tkinter  # noqa: F401

        checks["tkinter"] = True
    except ImportError:
        pass

    checks["tkinterdnd2"] = HAS_DND
    checks["yt_dlp"] = _has_yt_dlp_module()
    roots = _tool_roots(app_dir, runtime_dir)
    checks["ffmpeg"] = _find_binary_in_roots(("ffmpeg",), roots)
    checks["whisper_cpp"] = _find_binary_in_roots(("whisper-cli", "whisper-cpp"), roots)

    print(json.dumps(checks, indent=2))
    required_ok = checks["tkinter"] and checks["yt_dlp"] and checks["ffmpeg"] and checks["whisper_cpp"]
    return 0 if required_ok else 1


class TranscriberApp(TkinterDnD.Tk if HAS_DND else tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("WhisperDrop")
        self.configure(bg=BG)
        self.resizable(True, True)

        self.app_dir, self.runtime_dir = _resolve_app_dirs()
        self.model_dir = self.runtime_dir / ".models" / "whisper.cpp"
        self.download_dir = Path.home() / "Downloads" / "WhisperDrop"
        self.file_paths = []
        self.youtube_entries = []
        self.youtube_playlist_title = ""
        self._gpu_probe_results = {}
        self._window_icon = None
        self._set_window_icon()

        self._scroll_top = 0.0
        self._scroll_bottom = 1.0
        self._scroll_drag_start_y = None
        self._scroll_drag_start_top = None

        default_model = "Turbo Q5"
        self.file_var = tk.StringVar(value="No files selected")
        self.file_help_var = tk.StringVar(value="Choose one or more audio or video files to create text transcripts.")
        self.status_var = tk.StringVar(value="Ready")
        self.lang_var = tk.StringVar(value="Italian")
        self.model_var = tk.StringVar(value=default_model)
        self.model_help_var = tk.StringVar(value=MODELS[default_model]["description"])
        self.youtube_url_var = tk.StringVar(value="")
        self.youtube_help_var = tk.StringVar(
            value="Paste a YouTube playlist or video link, then load it into the queue."
        )

        self._configure_window_size()
        self._build_ui()
        self._fit_window_to_content()
        self.after(75, self._fit_window_to_content)
        self.after(250, self._fit_window_to_content)
        self._bind_shortcuts()

    def _run_command(self, cmd, timeout=None, cwd=None):
        kwargs = {
            "stdin": subprocess.DEVNULL,
            "capture_output": True,
            "text": True,
            "encoding": "utf-8",
            "errors": "replace",
            "timeout": timeout,
            "cwd": cwd,
        }
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

        try:
            return subprocess.run(cmd, **kwargs)
        except subprocess.TimeoutExpired as exc:
            stdout = exc.stdout or ""
            stderr = exc.stderr or ""
            if isinstance(stdout, bytes):
                stdout = stdout.decode("utf-8", errors="replace")
            if isinstance(stderr, bytes):
                stderr = stderr.decode("utf-8", errors="replace")

            result = subprocess.CompletedProcess(cmd, -9, stdout=stdout, stderr=stderr)
            result.timed_out = True
            return result

    def _run_command_stream(self, cmd, cwd=None, log_filter=None):
        kwargs = {
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "text": True,
            "encoding": "utf-8",
            "errors": "replace",
            "bufsize": 1,
            "cwd": cwd,
        }
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

        output_lines = []
        try:
            with subprocess.Popen(cmd, **kwargs) as process:
                if process.stdout:
                    for line in iter(process.stdout.readline, ""):
                        message = line.rstrip()
                        if not message:
                            continue
                        output_lines.append(message)
                        if log_filter:
                            message = log_filter(message)
                            if not message:
                                continue
                        self._ui(self._log, message)
                return_code = process.wait()
        except OSError as exc:
            return subprocess.CompletedProcess(cmd, 1, stdout="", stderr=str(exc))

        return subprocess.CompletedProcess(cmd, return_code, stdout="\n".join(output_lines), stderr="")

    def _transcript_log_line(self, message):
        match = WHISPER_SEGMENT_PATTERN.match(message)
        if not match:
            return None
        return match.group(1).strip()

    def _set_window_icon(self):
        icon_paths = [self.app_dir / "assets" / "app-icon" / "whisperdrop-icon.png"]
        bundle_dir = _bundle_dir()
        if bundle_dir:
            icon_paths.append(bundle_dir / "assets" / "app-icon" / "whisperdrop-icon.png")

        icon_path = next((path for path in icon_paths if path.exists()), None)
        if not icon_path:
            return

        try:
            self._window_icon = tk.PhotoImage(file=str(icon_path))
            self.iconphoto(True, self._window_icon)
        except tk.TclError:
            self._window_icon = None

    def _binary_dir(self, binary_path):
        return Path(binary_path).resolve().parent

    def _get_work_area(self):
        if os.name == "nt":
            rect = wintypes.RECT()
            if ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rect), 0):
                return rect.right - rect.left, rect.bottom - rect.top
        return self.winfo_screenwidth(), self.winfo_screenheight()

    def _configure_window_size(self):
        work_w, work_h = self._get_work_area()
        if os.name == "nt":
            target_w = min(1280, max(980, work_w - 120))
            target_h = min(900, max(760, work_h - 120))
        else:
            target_w = min(1280, max(960, work_w - 48))
            target_h = min(920, max(720, work_h - 36))
        min_w = min(960, max(820, work_w - 80))
        min_h = min(700, max(620, work_h - 80))
        self._base_min_width = min_w
        self._base_min_height = min_h
        pos_x = max(20, (work_w - target_w) // 2)
        pos_y = max(20, (work_h - target_h) // 2)

        self.geometry(f"{target_w}x{target_h}+{pos_x}+{pos_y}")
        self.minsize(min_w, min_h)

    def _fit_window_to_content(self):
        self.update_idletasks()

        work_w, work_h = self._get_work_area()
        current_w = self.winfo_width()
        current_h = self.winfo_height()
        required_w = self.winfo_reqwidth()
        required_h = self.winfo_reqheight()

        if os.name == "nt":
            target_w = min(work_w - 40, max(self._base_min_width, required_w + 24))
            target_h = min(work_h - 40, max(self._base_min_height, required_h + 48))
        else:
            target_w = min(work_w - 24, max(current_w, required_w))
            target_h = min(work_h - 24, max(current_h, required_h))
        pos_x = max(12, (work_w - target_w) // 2)
        pos_y = max(12, (work_h - target_h) // 2)

        self.geometry(f"{target_w}x{target_h}+{pos_x}+{pos_y}")
        self.minsize(self._base_min_width, self._base_min_height)

    def _build_ui(self):
        style = ttk.Style()
        style.theme_use("clam")
        style.configure(
            "App.TCombobox",
            fieldbackground=BG,
            background=BG,
            foreground=TEXT,
            bordercolor=BORDER,
            lightcolor=BORDER,
            darkcolor=BORDER,
            arrowcolor=TEXT,
            padding=8,
        )
        style.map(
            "App.TCombobox",
            fieldbackground=[("readonly", BG)],
            selectbackground=[("readonly", BG)],
            selectforeground=[("readonly", TEXT)],
        )
        style.configure(
            "App.Horizontal.TProgressbar",
            troughcolor="#111111",
            background=GREEN,
            lightcolor=GREEN,
            darkcolor=GREEN,
            bordercolor=BORDER,
        )

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)

        root = tk.Frame(self, bg=BG, padx=28, pady=24)
        root.grid(sticky="nsew")

        root.grid_columnconfigure(0, weight=1, uniform="col")
        root.grid_columnconfigure(1, weight=1, uniform="col")

        root.grid_rowconfigure(1, weight=0)
        root.grid_rowconfigure(2, weight=0)
        root.grid_rowconfigure(3, weight=1)

        # ── Header ───────────────────────────────────────────────────────────
        header = tk.Frame(root, bg=BG)
        header.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 18))
        header.grid_columnconfigure(0, weight=1)

        tk.Label(
            header,
            text="WhisperDrop",
            font=(UI_FONT, 24, "bold"),
            bg=BG,
            fg=TEXT,
        ).grid(row=0, column=0, sticky="w")
        tk.Label(
            header,
            text="whisper.cpp backend with quantized GGML models for lower-end hardware.",
            font=(UI_FONT, 13),
            bg=BG,
            fg=MUTED,
        ).grid(row=1, column=0, sticky="w", pady=(6, 0))
        tk.Frame(header, bg=GREEN, height=3, width=96).grid(row=2, column=0, sticky="w", pady=(14, 0))

        # ── File card ─────────────────────────────────────────────────────────
        file_card = tk.Frame(root, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        file_card.grid(row=1, column=0, sticky="ew", padx=(0, 10))
        file_card.grid_columnconfigure(0, weight=1)

        tk.Label(
            file_card,
            text="File",
            font=(UI_FONT, 15, "bold"),
            bg=CARD,
            fg=TEXT,
        ).grid(row=0, column=0, sticky="w", padx=18, pady=(16, 6))

        self.drop_zone = tk.Frame(
            file_card,
            bg=BG,
            highlightbackground=BORDER,
            highlightthickness=1,
            cursor="hand2",
            takefocus=True,
        )
        self.drop_zone.grid(row=1, column=0, sticky="ew", padx=18)
        self.drop_zone.grid_columnconfigure(0, weight=1)
        self.drop_zone.bind("<Button-1>", self._browse_file)
        self.drop_zone.bind("<Return>", self._browse_file)
        self.drop_zone.bind("<Enter>", lambda _e: self._set_drop_zone_hover(True))
        self.drop_zone.bind("<Leave>", lambda _e: self._set_drop_zone_hover(False))
        self.drop_zone.bind("<FocusIn>", lambda _e: self._set_drop_zone_hover(True))
        self.drop_zone.bind("<FocusOut>", lambda _e: self._set_drop_zone_hover(False))

        self.drop_title = tk.Label(
            self.drop_zone,
            text="Drop files here ➕",
            font=(UI_FONT, 20, "bold"),
            bg=BG,
            fg=TEXT,
        )
        self.drop_title.grid(row=0, column=0, sticky="n", pady=(28, 8))

        self.drop_subtitle = tk.Label(
            self.drop_zone,
            text="or click to browse your computer",
            font=(UI_FONT, 12),
            bg=BG,
            fg=MUTED,
        )
        self.drop_subtitle.grid(row=1, column=0, sticky="n", pady=(0, 26))
        self.drop_title.bind("<Button-1>", self._browse_file)
        self.drop_subtitle.bind("<Button-1>", self._browse_file)
        self.drop_title.bind("<Enter>", lambda _e: self._set_drop_zone_hover(True))
        self.drop_subtitle.bind("<Enter>", lambda _e: self._set_drop_zone_hover(True))
        self.drop_title.bind("<Leave>", lambda _e: self._set_drop_zone_hover(False))
        self.drop_subtitle.bind("<Leave>", lambda _e: self._set_drop_zone_hover(False))

        if HAS_DND:
            self.drop_zone.drop_target_register(DND_FILES)
            self.drop_zone.dnd_bind("<<Drop>>", self._on_drop)

        browse_row = tk.Frame(file_card, bg=CARD)
        browse_row.grid(row=2, column=0, sticky="ew", padx=18, pady=(14, 12))
        browse_row.grid_columnconfigure(0, weight=1)

        self.browse_btn_frame = tk.Frame(
            browse_row,
            bg=GREEN_SOFT,
            highlightbackground=GREEN,
            highlightthickness=1,
            cursor="hand2",
        )
        self.browse_btn_frame.grid(row=0, column=0)

        self.browse_btn = tk.Label(
            self.browse_btn_frame,
            text="Browse Files  📂",
            font=(UI_FONT, 13, "bold"),
            bg=GREEN_SOFT,
            fg=GREEN,
            padx=18,
            pady=14,
            cursor="hand2",
        )
        self.browse_btn.pack()

        self.browse_btn.bind("<Button-1>", self._browse_file)
        self.browse_btn_frame.bind("<Button-1>", self._browse_file)
        self.browse_btn.bind("<Enter>", lambda e: (self.browse_btn_frame.config(bg="#0f2e1a"), self.browse_btn.config(bg="#0f2e1a")))
        self.browse_btn.bind("<Leave>", lambda e: (self.browse_btn_frame.config(bg=GREEN_SOFT), self.browse_btn.config(bg=GREEN_SOFT)))

        file_info = tk.Frame(file_card, bg=CARD)
        file_info.grid(row=3, column=0, sticky="ew", padx=18, pady=(0, 18))
        file_info.grid_columnconfigure(0, weight=1)

        tk.Label(
            file_info,
            textvariable=self.file_var,
            font=(UI_FONT, 13, "bold"),
            bg=CARD,
            fg=TEXT,
            anchor="w",
            justify="left",
        ).grid(row=0, column=0, sticky="ew")
        self.file_help_label = tk.Label(
            file_info,
            textvariable=self.file_help_var,
            font=(UI_FONT, 11),
            bg=CARD,
            fg=MUTED,
            anchor="w",
            justify="left",
        )
        self.file_help_label.grid(row=1, column=0, sticky="ew", pady=(4, 0))

        youtube_section = tk.Frame(file_card, bg=CARD)
        youtube_section.grid(row=4, column=0, sticky="ew", padx=18, pady=(0, 18))
        youtube_section.grid_columnconfigure(0, weight=1)

        tk.Label(
            youtube_section,
            text="YouTube Playlist",
            font=(UI_FONT, 15, "bold"),
            bg=CARD,
            fg=TEXT,
        ).grid(row=0, column=0, sticky="w", pady=(0, 8))

        self.youtube_entry = tk.Entry(
            youtube_section,
            textvariable=self.youtube_url_var,
            font=(UI_FONT, 12),
            bg=BG,
            fg=TEXT,
            insertbackground=TEXT,
            relief="flat",
            highlightbackground=BORDER,
            highlightthickness=1,
        )
        self.youtube_entry.grid(row=1, column=0, sticky="ew", ipady=8)

        youtube_btn_row = tk.Frame(youtube_section, bg=CARD)
        youtube_btn_row.grid(row=2, column=0, sticky="ew", pady=(10, 0))

        self.youtube_btn_frame = tk.Frame(
            youtube_btn_row,
            bg=GREEN_SOFT,
            highlightbackground=GREEN,
            highlightthickness=1,
            cursor="hand2",
        )
        self.youtube_btn_frame.pack(side="left")

        self.youtube_btn = tk.Label(
            self.youtube_btn_frame,
            text="Load Playlist  ▶️",
            font=(UI_FONT, 13, "bold"),
            bg=GREEN_SOFT,
            fg=GREEN,
            padx=18,
            pady=12,
            cursor="hand2",
        )
        self.youtube_btn.pack()
        self.youtube_btn.bind("<Button-1>", lambda _e: self._load_youtube_playlist())
        self.youtube_btn_frame.bind("<Button-1>", lambda _e: self._load_youtube_playlist())
        self.youtube_btn.bind(
            "<Enter>",
            lambda _e: (self.youtube_btn_frame.config(bg="#0f2e1a"), self.youtube_btn.config(bg="#0f2e1a")),
        )
        self.youtube_btn.bind(
            "<Leave>",
            lambda _e: (self.youtube_btn_frame.config(bg=GREEN_SOFT), self.youtube_btn.config(bg=GREEN_SOFT)),
        )

        self.youtube_help_label = tk.Label(
            youtube_section,
            textvariable=self.youtube_help_var,
            font=(UI_FONT, 11),
            bg=CARD,
            fg=MUTED,
            anchor="w",
            justify="left",
            wraplength=420,
        )
        self.youtube_help_label.grid(row=3, column=0, sticky="ew", pady=(10, 0))

        # ── Options ───────────────────────────────────────────────────────────
        options = tk.Frame(root, bg=BG)
        options.grid(row=2, column=0, sticky="ew", padx=(0, 10), pady=(18, 18))
        options.grid_columnconfigure(0, weight=1)
        options.grid_columnconfigure(1, weight=1)
        options.grid_rowconfigure(0, weight=1)

        lang_card = tk.Frame(options, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        lang_card.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        tk.Label(
            lang_card,
            text="Language",
            font=(UI_FONT, 15, "bold"),
            bg=CARD,
            fg=TEXT,
        ).pack(anchor="w", padx=16, pady=(14, 6))
        self.lang_menu = ttk.Combobox(
            lang_card,
            textvariable=self.lang_var,
            values=list(LANGUAGES.keys()),
            state="readonly",
            style="App.TCombobox",
            font=(UI_FONT, 12),
        )
        self.lang_menu.pack(fill="x", padx=16, pady=(0, 14))

        model_card = tk.Frame(options, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        model_card.grid(row=0, column=1, sticky="ew", padx=(8, 0))
        tk.Label(
            model_card,
            text="Model",
            font=(UI_FONT, 15, "bold"),
            bg=CARD,
            fg=TEXT,
        ).pack(anchor="w", padx=16, pady=(14, 6))
        self.model_menu = ttk.Combobox(
            model_card,
            textvariable=self.model_var,
            values=list(MODELS.keys()),
            state="readonly",
            style="App.TCombobox",
            font=(UI_FONT, 12),
        )
        self.model_menu.pack(fill="x", padx=16, pady=(0, 8))
        self.model_menu.bind("<<ComboboxSelected>>", self._on_model_change)
        tk.Label(
            model_card,
            textvariable=self.model_help_var,
            font=(UI_FONT, 10),
            bg=CARD,
            fg=MUTED,
            wraplength=260,
            justify="left",
            anchor="w",
        ).pack(fill="x", padx=16, pady=(0, 14))

        # ── Action card ───────────────────────────────────────────────────────
        action_card = tk.Frame(root, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        action_card.grid(row=3, column=0, sticky="nsew", padx=(0, 10))
        action_card.grid_columnconfigure(0, weight=1)

        self.run_btn_frame = tk.Frame(
            action_card,
            bg=GREEN_SOFT,
            highlightbackground=GREEN,
            highlightthickness=1,
            cursor="hand2",
        )
        self.run_btn_frame.grid(row=0, column=0, sticky="ew", padx=18, pady=(18, 10))
        self.run_btn_frame.grid_columnconfigure(0, weight=1)

        self.run_btn = tk.Label(
            self.run_btn_frame,
            text="Start Transcription  ▶️",
            font=(UI_FONT, 13, "bold"),
            bg=GREEN_SOFT,
            fg=GREEN,
            padx=18,
            pady=14,
            cursor="hand2",
        )
        self.run_btn.pack(fill="x")

        self.run_btn.bind("<Button-1>", lambda e: self._run_transcription())
        self.run_btn_frame.bind("<Button-1>", lambda e: self._run_transcription())
        self.run_btn.bind("<Enter>", lambda e: (self.run_btn_frame.config(bg="#0f2e1a"), self.run_btn.config(bg="#0f2e1a")))
        self.run_btn.bind("<Leave>", lambda e: (self.run_btn_frame.config(bg=GREEN_SOFT), self.run_btn.config(bg=GREEN_SOFT)))

        self.progress = ttk.Progressbar(action_card, mode="indeterminate", style="App.Horizontal.TProgressbar")

        self.status_label = tk.Label(
            action_card,
            textvariable=self.status_var,
            font=(UI_FONT, 11),
            bg=BG,
            fg=TEXT,
            anchor="w",
            justify="left",
            padx=12,
            pady=10,
        )
        self.status_label.grid(row=2, column=0, sticky="ew", padx=18, pady=(0, 18))

        # ── Log card (right column, spans rows 1-3) ───────────────────────────
        log_card = tk.Frame(root, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        log_card.grid(row=1, column=1, rowspan=3, sticky="nsew", padx=(10, 0))
        log_card.grid_columnconfigure(0, weight=1)
        log_card.grid_rowconfigure(1, weight=1)

        tk.Label(
            log_card,
            text="Log",
            font=(UI_FONT, 15, "bold"),
            bg=CARD,
            fg=TEXT,
        ).grid(row=0, column=0, sticky="w", padx=18, pady=(16, 8))

        log_frame = tk.Frame(log_card, bg=BG)
        log_frame.grid(row=1, column=0, sticky="nsew", padx=18, pady=(0, 18))
        log_frame.grid_columnconfigure(0, weight=1)
        log_frame.grid_rowconfigure(0, weight=1)

        self.log = tk.Text(
            log_frame,
            wrap="word",
            bg=BG,
            fg=TEXT,
            insertbackground=TEXT,
            relief="flat",
            font=(MONO_FONT, 11),
            padx=12,
            pady=12,
            yscrollcommand=self._update_scrollbar,
        )
        self.log.grid(row=0, column=0, sticky="nsew")
        self.log.config(state="disabled")

        # Custom canvas scrollbar
        self._scroll_canvas = tk.Canvas(
            log_frame,
            width=SCROLLBAR_WIDTH + 1,
            bg=BG,
            highlightthickness=0,
            bd=0,
        )
        self._scroll_canvas.grid(row=0, column=1, sticky="ns", padx=(4, 0))

        self._scroll_thumb = self._scroll_canvas.create_rectangle(
            1, 0, SCROLLBAR_WIDTH - 1, THUMB_MIN_HEIGHT,
            fill=GREEN_SOFT,
            outline=GREEN,
            width=1,
        )

        self._scroll_canvas.bind("<ButtonPress-1>", self._scroll_click)
        self._scroll_canvas.bind("<B1-Motion>", self._scroll_drag)
        self._scroll_canvas.bind("<Enter>", lambda e: self._scroll_canvas.itemconfig(self._scroll_thumb, fill="#0f2e1a"))
        self._scroll_canvas.bind("<Leave>", lambda e: self._scroll_canvas.itemconfig(self._scroll_thumb, fill=GREEN_SOFT))

        self._set_drop_zone_hover(False)
        self._set_status("Ready", "neutral")
        self._log("Ready. whisper.cpp backend is active.")
        self._log("You can load local files or paste a YouTube playlist link.")

    def _update_scrollbar(self, top, bottom):
        self._scroll_top = float(top)
        self._scroll_bottom = float(bottom)
        self._scroll_canvas.update_idletasks()
        h = self._scroll_canvas.winfo_height()
        if h <= 0:
            return
        y0 = int(self._scroll_top * h)
        y1 = int(self._scroll_bottom * h)
        thumb_h = max(y1 - y0, THUMB_MIN_HEIGHT)
        # Clamp so thumb doesn't overflow
        if y0 + thumb_h > h:
            y0 = h - thumb_h
        self._scroll_canvas.coords(self._scroll_thumb, 0, y0, SCROLLBAR_WIDTH, y0 + thumb_h - 1)

    def _scroll_click(self, event):
        h = self._scroll_canvas.winfo_height()
        if h <= 0:
            return
        self._scroll_drag_start_y = event.y
        self._scroll_drag_start_top = self._scroll_top
        self.log.yview_moveto(event.y / h)

    def _scroll_drag(self, event):
        h = self._scroll_canvas.winfo_height()
        if h <= 0 or self._scroll_drag_start_y is None:
            return
        delta = (event.y - self._scroll_drag_start_y) / h
        self.log.yview_moveto(self._scroll_drag_start_top + delta)

    def _bind_shortcuts(self):
        self.bind("<Return>", self._on_enter_key)
        self.bind("<Control-o>", self._browse_file)
        self.bind("<Command-o>", self._browse_file)

    def _ui(self, callback, *args, **kwargs):
        self.after(0, lambda: callback(*args, **kwargs))

    def _set_drop_zone_hover(self, active):
        border = WHITE if active else BORDER
        self.drop_zone.configure(highlightbackground=border)

    def _set_status(self, message, tone="neutral"):
        colors = {
            "neutral": (TEXT, BG),
            "success": (GREEN, GREEN_SOFT),
            "error": (RED, RED_SOFT),
        }
        fg, bg = colors[tone]
        self.status_var.set(message)
        self.status_label.config(fg=fg, bg=bg)

    def _on_enter_key(self, event=None):
        if self.focus_get() in {self.lang_menu, self.model_menu}:
            return
        self._run_transcription()

    def _on_model_change(self, event=None):
        self.model_help_var.set(MODELS[self.model_var.get()]["description"])

    def _on_drop(self, event):
        entries = self.tk.splitlist(event.data)
        if not entries:
            return
        self._set_files(entries)

    def _browse_file(self, event=None):
        paths = filedialog.askopenfilenames(
            title="Select audio or video files",
            filetypes=[("Audio and video", "*.mp3 *.wav *.m4a *.ogg *.flac *.opus *.webm *.mp4 *.aac")],
        )
        if paths:
            self._set_files(paths)

    def _is_youtube_url(self, url):
        url = url.strip()
        if not url or not YOUTUBE_URL_PATTERN.match(url):
            return False
        host = urlparse(url).netloc.lower()
        return host.endswith("youtube.com") or host == "youtu.be"

    def _find_yt_dlp(self):
        venv_name = "yt-dlp.exe" if os.name == "nt" else "yt-dlp"
        venv_dir = "Scripts" if os.name == "nt" else "bin"
        venv_ytdlp = self.runtime_dir / ".venv" / venv_dir / venv_name
        if venv_ytdlp.exists():
            return str(venv_ytdlp)
        return self._find_binary(("yt-dlp",))

    def _clear_youtube_queue(self):
        self.youtube_entries = []
        self.youtube_playlist_title = ""

    def _clear_file_queue(self):
        self.file_paths = []
        self.file_var.set("No files selected")
        self.file_help_var.set("Choose one or more audio or video files to create text transcripts.")
        self.file_help_label.config(fg=MUTED)

    def _set_youtube_queue(self, playlist_title, entries):
        self._clear_file_queue()
        self.youtube_playlist_title = playlist_title
        self.youtube_entries = entries

        if len(entries) == 1:
            title = entries[0]["title"]
            self.file_var.set(title)
            self.file_help_var.set("YouTube video loaded. The transcript will be saved in Downloads/WhisperDrop.")
        else:
            preview_names = [entry["title"] for entry in entries[:3]]
            preview = ", ".join(preview_names)
            if len(entries) > 3:
                preview += f", +{len(entries) - 3} more"
            self.file_var.set(f"{len(entries)} YouTube videos loaded")
            self.file_help_var.set(f"Playlist: {playlist_title}. Queue: {preview}")

        self.file_help_label.config(fg=GREEN)
        self.youtube_help_var.set(f"Loaded {len(entries)} item(s) from: {playlist_title}")
        self.youtube_help_label.config(fg=GREEN)
        self._set_status(f"{len(entries)} YouTube item(s) loaded. Ready to transcribe.", "success")
        self._log(f"Loaded YouTube playlist: {playlist_title}")
        for entry in entries:
            self._log(f"  - {entry['index']:03d}. {entry['title']}")

    def _load_youtube_playlist(self):
        url = self.youtube_url_var.get().strip()
        if not self._is_youtube_url(url):
            messagebox.showerror("Invalid URL", "Paste a valid YouTube video or playlist link.")
            return

        self._set_youtube_busy(True)
        threading.Thread(target=self._fetch_youtube_playlist, args=(url,), daemon=True).start()

    def _fetch_youtube_playlist(self, url):
        try:
            entries, playlist_title = self._list_youtube_entries(url)
            if not entries:
                raise RuntimeError("No videos were found in that YouTube link.")
            self._ui(self._set_youtube_queue, playlist_title, entries)
        except Exception as exc:
            self._ui(self._log, f"YouTube error:\n{exc}")
            self._ui(self._set_status, "Could not load the YouTube playlist.", "error")
            self._ui(lambda err=str(exc): messagebox.showerror("YouTube error", err))
        finally:
            self._ui(self._set_youtube_busy, False)

    def _list_youtube_entries(self, url):
        self._ui(self._set_status, "Loading YouTube playlist...", "neutral")
        self._ui(self._log, f"Fetching playlist metadata: {url}")

        payload = self._list_youtube_entries_with_module(url)
        if payload is None:
            yt_dlp = self._find_yt_dlp()
            if not yt_dlp:
                raise RuntimeError("yt-dlp was not found. Run setup again to install it.")

            result = self._run_command(
                [
                    yt_dlp,
                    "--flat-playlist",
                    "--dump-single-json",
                    "--no-warnings",
                    "--no-color",
                    url,
                ]
            )
            if result.returncode != 0:
                error_output = result.stderr.strip() or result.stdout.strip() or "Unknown yt-dlp error."
                raise RuntimeError(error_output)

            try:
                payload = json.loads(result.stdout)
            except json.JSONDecodeError as exc:
                raise RuntimeError("yt-dlp returned invalid playlist metadata.") from exc

        raw_entries = payload.get("entries") or [payload]
        playlist_title = payload.get("title") or payload.get("playlist_title") or "YouTube playlist"

        entries = []
        for index, item in enumerate(raw_entries, start=1):
            if not item:
                continue

            video_id = item.get("id")
            title = item.get("title") or f"Video {index}"
            webpage_url = item.get("url") or item.get("webpage_url")
            if webpage_url and not webpage_url.startswith("http"):
                webpage_url = f"https://www.youtube.com/watch?v={webpage_url}"
            elif video_id and not webpage_url:
                webpage_url = f"https://www.youtube.com/watch?v={video_id}"

            if not webpage_url:
                continue

            entries.append(
                {
                    "index": index,
                    "id": video_id or f"item-{index}",
                    "title": title,
                    "url": webpage_url,
                }
            )

        return entries, playlist_title

    def _list_youtube_entries_with_module(self, url):
        try:
            import yt_dlp
        except ImportError:
            return None

        options = {
            "extract_flat": "in_playlist",
            "quiet": True,
            "no_warnings": True,
            "noplaylist": False,
        }
        try:
            with yt_dlp.YoutubeDL(options) as downloader:
                return downloader.extract_info(url, download=False)
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc

    def _sanitize_folder_name(self, value):
        cleaned = re.sub(r'[<>:"/\\|?*]+', "-", value).strip(" .")
        return cleaned or "youtube-playlist"

    def _download_youtube_audio(self, entry, playlist_dir):
        playlist_dir.mkdir(parents=True, exist_ok=True)
        output_template = str(playlist_dir / f"{entry['index']:03d} - %(title)s [%(id)s].%(ext)s")

        self._ui(self._log, f"Downloading audio: {entry['title']}")
        module_download = self._download_youtube_audio_with_module(entry, output_template)
        if module_download:
            return module_download

        yt_dlp = self._find_yt_dlp()
        if not yt_dlp:
            raise RuntimeError("yt-dlp was not found. Run setup again to install it.")

        result = self._run_command(
            [
                yt_dlp,
                "--no-playlist",
                "--no-warnings",
                "--no-color",
                "-f",
                "bestaudio/best",
                "-o",
                output_template,
                entry["url"],
            ]
        )
        if result.returncode != 0:
            error_output = result.stderr.strip() or result.stdout.strip() or "Unknown yt-dlp error."
            raise RuntimeError(error_output)

        matches = sorted(playlist_dir.glob(f"{entry['index']:03d} - * [{entry['id']}].*"))
        if not matches:
            matches = sorted(playlist_dir.glob(f"{entry['index']:03d} - *"))
        if not matches:
            raise RuntimeError("yt-dlp finished without creating the audio file.")

        return matches[0]

    def _download_youtube_audio_with_module(self, entry, output_template):
        try:
            import yt_dlp
        except ImportError:
            return None

        options = {
            "format": "bestaudio/best",
            "noplaylist": True,
            "no_warnings": True,
            "outtmpl": output_template,
            "quiet": True,
        }

        try:
            with yt_dlp.YoutubeDL(options) as downloader:
                info = downloader.extract_info(entry["url"], download=True)
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc

        downloads = info.get("requested_downloads") or []
        for item in downloads:
            filepath = item.get("filepath")
            if filepath and Path(filepath).exists():
                return Path(filepath)

        matches = sorted(Path(output_template).parent.glob(f"{entry['index']:03d} - * [{entry['id']}].*"))
        if not matches:
            matches = sorted(Path(output_template).parent.glob(f"{entry['index']:03d} - *"))
        return matches[0] if matches else None

    def _set_youtube_busy(self, busy):
        state = "disabled" if busy else "normal"
        self.youtube_entry.config(state=state)
        if busy:
            self.youtube_btn.config(text="Loading...  ⏳", fg=MUTED, cursor="")
            self.youtube_btn_frame.config(cursor="")
            self.youtube_btn.unbind("<Button-1>")
            self.youtube_btn_frame.unbind("<Button-1>")
        else:
            self.youtube_btn.config(text="Load Playlist  ▶️", fg=GREEN, cursor="hand2")
            self.youtube_btn_frame.config(cursor="hand2")
            self.youtube_btn.bind("<Button-1>", lambda _e: self._load_youtube_playlist())
            self.youtube_btn_frame.bind("<Button-1>", lambda _e: self._load_youtube_playlist())

    def _set_files(self, paths):
        valid_files = []
        invalid_files = []
        seen = set()

        for path in paths:
            file_path = Path(path)
            ext = file_path.suffix.lower()
            resolved = str(file_path)

            if resolved in seen:
                continue
            seen.add(resolved)

            if ext not in SUPPORTED or not file_path.is_file():
                invalid_files.append(file_path.name or resolved)
                continue

            valid_files.append(resolved)

        if not valid_files:
            messagebox.showerror("Unsupported files", f"Supported formats: {', '.join(sorted(SUPPORTED))}")
            return

        self._clear_youtube_queue()
        self.youtube_url_var.set("")
        self.youtube_help_var.set("Paste a YouTube playlist or video link, then load it into the queue.")
        self.youtube_help_label.config(fg=MUTED)

        self.file_paths = valid_files
        if len(valid_files) == 1:
            file_name = Path(valid_files[0]).name
            self.file_var.set(file_name)
            self.file_help_var.set("Ready to transcribe with whisper.cpp. The text file will be saved next to the original file.")
            self._set_status("1 file selected. Ready to transcribe.", "success")
        else:
            preview_names = [Path(path).name for path in valid_files[:3]]
            preview = ", ".join(preview_names)
            if len(valid_files) > 3:
                preview += f", +{len(valid_files) - 3} more"
            self.file_var.set(f"{len(valid_files)} files selected")
            self.file_help_var.set(f"Ready to transcribe {len(valid_files)} files. Queue: {preview}")
            self._set_status(f"{len(valid_files)} files selected. Ready to transcribe.", "success")

        self.file_help_label.config(fg=GREEN)
        self._log(f"Loaded {len(valid_files)} file(s).")
        for path in valid_files:
            self._log(f"  - {Path(path).name}")

        if invalid_files:
            self._log("Skipped unsupported entries:")
            for name in invalid_files:
                self._log(f"  - {name}")

    def _log(self, message):
        self.log.config(state="normal")
        self.log.insert("end", message + "\n")
        self.log.see("end")
        self.log.config(state="disabled")

    def _get_shell_path_entries(self):
        if sys.platform != "darwin":
            return []

        shell = os.environ.get("SHELL") or shutil.which("zsh") or shutil.which("bash")
        if not shell:
            return []

        try:
            result = subprocess.run(
                [shell, "-lc", 'printf %s "$PATH"'],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
        except OSError:
            return []

        if result.returncode != 0 or not result.stdout:
            return []

        return [entry for entry in result.stdout.split(os.pathsep) if entry]

    def _local_tool_roots(self):
        return _tool_roots(self.app_dir, self.runtime_dir)

    def _find_binary(self, names):
        local_roots = self._local_tool_roots() if os.name in {"nt", "posix"} else []
        if _is_frozen_app():
            return _find_binary_in_roots(names, local_roots)

        search_roots = []
        seen_roots = set()
        for raw_path in self._get_shell_path_entries() + os.environ.get("PATH", "").split(os.pathsep):
            if not raw_path:
                continue
            path_obj = Path(raw_path).expanduser()
            normalized = str(path_obj)
            if normalized in seen_roots or not path_obj.exists():
                continue
            seen_roots.add(normalized)
            search_roots.append(path_obj)

        for name in names:
            resolved = shutil.which(name)
            if resolved:
                return resolved

        for root in local_roots:
            for name in names:
                candidate = root / (f"{name}.exe" if os.name == "nt" else name)
                if candidate.exists():
                    return str(candidate)

        for prefix in search_roots:
            for name in names:
                candidate = prefix / (f"{name}.exe" if os.name == "nt" else name)
                if candidate.exists():
                    return str(candidate)

        return None

    def _ggml_search_dirs(self, binary_dir):
        search_dirs = [binary_dir]
        for relative in ("../libexec", "../lib", "libexec", "lib"):
            candidate = (binary_dir / relative).resolve()
            if candidate.exists() and candidate not in search_dirs:
                search_dirs.append(candidate)

        brew = shutil.which("brew")
        if brew:
            try:
                result = subprocess.run(
                    [brew, "--prefix", "ggml"],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    check=False,
                )
            except OSError:
                result = None

            if result and result.returncode == 0:
                prefix = Path(result.stdout.strip())
                for relative in ("libexec", "lib"):
                    candidate = prefix / relative
                    if candidate.exists() and candidate not in search_dirs:
                        search_dirs.append(candidate)

        return search_dirs

    def _has_metal_backend(self, binary_dir):
        metal_names = ("libggml-metal.so", "libggml-metal.dylib", "libggml-metal.0.dylib")
        for search_dir in self._ggml_search_dirs(binary_dir):
            for name in metal_names:
                if (search_dir / name).exists():
                    return True
        return False

    def _detect_whisper_backend(self, whisper_cpp):
        binary_dir = self._binary_dir(whisper_cpp)
        if os.name == "nt":
            if (binary_dir / "ggml-vulkan.dll").exists():
                return "vulkan"
            return "cpu"

        if sys.platform == "darwin" and self._has_metal_backend(binary_dir):
            return "metal"

        return "cpu"

    def _backend_label(self, backend):
        labels = {
            "vulkan": "Vulkan GPU",
            "metal": "Metal GPU",
            "cpu": "CPU",
            "cpu-fallback": "CPU fallback",
        }
        return labels.get(backend, "CPU")

    def _download_model(self, model_name, model_info):
        self.model_dir.mkdir(parents=True, exist_ok=True)
        model_path = self.model_dir / model_info["filename"]
        if model_path.exists() and model_path.stat().st_size > 0:
            self._ui(self._log, f"Using cached model: {model_info['filename']}")
            return model_path

        url = f"{MODEL_REPO}/{model_info['filename']}?download=true"
        temp_path = model_path.with_suffix(model_path.suffix + ".part")
        self._ui(self._set_status, f"Downloading {model_name}...", "neutral")
        self._ui(self._log, f"Downloading model: {model_info['filename']}")

        try:
            with urllib.request.urlopen(url) as response, temp_path.open("wb") as output_file:
                total_bytes = int(response.headers.get("Content-Length", "0"))
                downloaded = 0
                next_progress = 0.1

                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    output_file.write(chunk)
                    downloaded += len(chunk)

                    if total_bytes > 0:
                        progress = downloaded / total_bytes
                        if progress >= next_progress:
                            percent = min(100, int(progress * 100))
                            self._ui(self._log, f"Model download {percent}%")
                            next_progress += 0.1

            temp_path.replace(model_path)
            self._ui(self._log, f"Model ready: {model_path.name}")
            return model_path
        except (urllib.error.URLError, urllib.error.HTTPError) as exc:
            temp_path.unlink(missing_ok=True)
            raise RuntimeError(f"Could not download model '{model_name}'. Check your internet connection. ({exc})") from exc

    def _prepare_audio(self, source_path, temp_dir):
        ffmpeg = self._find_binary(("ffmpeg",))
        if not ffmpeg:
            raise RuntimeError("ffmpeg was not found. Run setup again to install it.")

        wav_path = Path(temp_dir) / "input.wav"
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(source_path),
            "-vn",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(wav_path),
        ]

        self._ui(self._set_status, "Preparing audio for whisper.cpp...", "neutral")
        self._ui(self._log, "Converting input to 16 kHz mono WAV...")
        result = self._run_command(cmd)
        if result.returncode != 0:
            error_output = result.stderr.strip() or result.stdout.strip() or "Unknown ffmpeg error."
            raise RuntimeError(f"Audio conversion failed.\n{error_output}")

        return wav_path

    def _resolve_output_paths(self, source_path):
        source_path = Path(source_path)
        txt_path = source_path.with_suffix(".txt")
        if not txt_path.exists():
            return source_path.with_suffix(""), txt_path

        counter = 2
        while True:
            alt_txt = source_path.with_name(f"{source_path.stem} ({counter}).txt")
            if not alt_txt.exists():
                self._ui(self._log, f"Existing transcript found. Saving as: {alt_txt.name}")
                return alt_txt.with_suffix(""), alt_txt
            counter += 1

    def _command_timed_out(self, result):
        return bool(getattr(result, "timed_out", False))

    def _command_error_output(self, *results):
        for result in results:
            if not result:
                continue
            output = (result.stderr or result.stdout or "").strip()
            if output:
                return output
        return "Unknown whisper.cpp error."

    def _gpu_probe_timeout_seconds(self):
        raw_timeout = os.environ.get("WHISPERDROP_GPU_PROBE_TIMEOUT", "90")
        try:
            timeout = int(raw_timeout)
        except ValueError:
            timeout = 90
        return max(15, timeout)

    def _write_probe_wav(self, wav_path):
        sample_rate = 16000
        sample_count = sample_rate // 4
        with wave.open(str(wav_path), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(b"\0\0" * sample_count)

    def _probe_gpu_backend(self, whisper_cpp, model_path, language, threads, backend):
        probe_key = (str(Path(whisper_cpp).resolve()), str(Path(model_path).resolve()), backend)
        if probe_key in self._gpu_probe_results:
            return self._gpu_probe_results[probe_key]

        backend_label = self._backend_label(backend)
        timeout = self._gpu_probe_timeout_seconds()
        self._ui(self._log, f"Checking {backend_label} backend before transcription...")

        with tempfile.TemporaryDirectory(prefix="whisperdrop-gpu-probe-") as probe_dir:
            probe_dir = Path(probe_dir)
            probe_audio = probe_dir / "probe.wav"
            probe_output = probe_dir / "probe"
            self._write_probe_wav(probe_audio)
            probe_cmd = [
                whisper_cpp,
                "--model",
                str(model_path),
                "--file",
                str(probe_audio),
                "--threads",
                str(max(1, min(threads, 4))),
                "--language",
                language,
                "--output-file",
                str(probe_output),
                "--output-txt",
            ]
            result = self._run_command(probe_cmd, timeout=timeout, cwd=self._binary_dir(whisper_cpp))

        if self._command_timed_out(result):
            self._ui(self._log, f"{backend_label} backend did not become ready within {timeout}s. Retrying on CPU...")
            self._gpu_probe_results[probe_key] = False
            return False

        if result.returncode != 0:
            error_output = self._command_error_output(result)
            first_line = error_output.splitlines()[0] if error_output else "Unknown whisper.cpp error."
            self._ui(self._log, f"{backend_label} backend failed probe. Retrying on CPU... ({first_line})")
            self._gpu_probe_results[probe_key] = False
            return False

        self._gpu_probe_results[probe_key] = True
        return True

    def _run_whisper_cpp(self, source_path, audio_path, model_name, model_path, language):
        whisper_cpp = self._find_binary(("whisper-cli", "whisper-cpp"))
        if not whisper_cpp:
            raise RuntimeError("whisper.cpp was not found. Run setup again to install it.")

        output_base, output_file = self._resolve_output_paths(source_path)
        threads = max(1, min(8, os.cpu_count() or 4))
        backend = self._detect_whisper_backend(whisper_cpp)
        if backend == "vulkan" and not self._probe_gpu_backend(whisper_cpp, model_path, language, threads, backend):
            backend = "cpu-fallback"

        cmd = [
            whisper_cpp,
            "--model",
            str(model_path),
            "--file",
            str(audio_path),
            "--threads",
            str(threads),
            "--language",
            language,
            "--output-file",
            str(output_base),
            "--output-txt",
            "--no-prints",
        ]

        self._ui(self._set_status, f"Transcribing with {model_name}...", "neutral")
        backend_label = self._backend_label(backend)
        self._ui(self._log, f"Starting whisper.cpp with {backend_label} backend.")
        run_cmd = cmd + ["--no-gpu"] if backend == "cpu-fallback" else cmd
        result = self._run_command_stream(run_cmd, cwd=self._binary_dir(whisper_cpp), log_filter=self._transcript_log_line)

        if result.returncode != 0:
            if backend in {"vulkan", "metal"}:
                self._ui(self._log, f"{backend_label} backend failed. Retrying on CPU...")
                cpu_cmd = cmd + ["--no-gpu"]
                cpu_result = self._run_command_stream(
                    cpu_cmd,
                    cwd=self._binary_dir(whisper_cpp),
                    log_filter=self._transcript_log_line,
                )
                if cpu_result.returncode == 0:
                    result = cpu_result
                    backend = "cpu-fallback"
                else:
                    error_output = self._command_error_output(cpu_result, result)
                    raise RuntimeError(error_output)
            else:
                error_output = self._command_error_output(result)
                raise RuntimeError(error_output)

        if not output_file.exists():
            matches = sorted(source_path.parent.glob(f"{source_path.stem}*.txt"))
            if matches:
                output_file = matches[0]
            else:
                raise RuntimeError("whisper.cpp finished without creating the transcript file.")

        if backend == "cpu-fallback":
            self._ui(self._log, "Transcription completed on CPU fallback.")
        elif backend in {"vulkan", "metal"}:
            self._ui(self._log, f"Transcription completed with {self._backend_label(backend)} backend.")

        return output_file

    def _open_output_dirs(self, output_dirs):
        unique_dirs = sorted({str(Path(path)) for path in output_dirs})
        if len(unique_dirs) != 1:
            if len(unique_dirs) > 1:
                self._ui(self._log, f"Transcripts saved across {len(unique_dirs)} folders.")
            return

        try:
            output_dir = unique_dirs[0]
            if os.name == "nt":
                os.startfile(output_dir)
            elif sys.platform == "darwin":
                subprocess.run(["open", output_dir], check=False)
            else:
                subprocess.run(["xdg-open", output_dir], check=False)
        except Exception:
            self._ui(self._log, "Transcript saved. Could not open the output folder automatically.")

    def _set_busy(self, busy):
        if busy:
            self.run_btn.config(text="Transcribing...  ⏳", fg=MUTED)
            self.run_btn_frame.config(cursor="")
            self.run_btn.config(cursor="")
            self.run_btn.unbind("<Button-1>")
            self.run_btn_frame.unbind("<Button-1>")
            self.youtube_entry.config(state="disabled")
            self.youtube_btn.config(text="Load Playlist  ▶️", fg=MUTED, cursor="")
            self.youtube_btn_frame.config(cursor="")
            self.youtube_btn.unbind("<Button-1>")
            self.youtube_btn_frame.unbind("<Button-1>")
            self.progress.grid(row=1, column=0, sticky="ew", padx=18, pady=(0, 10))
            self.progress.start(10)
            self._set_status("Transcription in progress...", "neutral")
        else:
            self.run_btn.config(text="Start Transcription  ▶️", fg=GREEN)
            self.run_btn_frame.config(cursor="hand2")
            self.run_btn.config(cursor="hand2")
            self.run_btn.bind("<Button-1>", lambda e: self._run_transcription())
            self.run_btn_frame.bind("<Button-1>", lambda e: self._run_transcription())
            self.youtube_entry.config(state="normal")
            self.youtube_btn.config(text="Load Playlist  ▶️", fg=GREEN, cursor="hand2")
            self.youtube_btn_frame.config(cursor="hand2")
            self.youtube_btn.bind("<Button-1>", lambda _e: self._load_youtube_playlist())
            self.youtube_btn_frame.bind("<Button-1>", lambda _e: self._load_youtube_playlist())
            self.progress.stop()
            self.progress.grid_forget()

    def _run_transcription(self):
        if not self.file_paths and not self.youtube_entries:
            messagebox.showwarning("No input", "Select local files or load a YouTube playlist first.")
            return

        self._set_busy(True)
        threading.Thread(target=self._transcribe, daemon=True).start()

    def _transcribe(self):
        try:
            language = LANGUAGES[self.lang_var.get()]
            model_name = self.model_var.get()
            model_info = MODELS[model_name]
            model_path = self._download_model(model_name, model_info)
            saved_outputs = []
            failed_files = []

            if self.youtube_entries:
                playlist_dir = self.download_dir / self._sanitize_folder_name(self.youtube_playlist_title)
                self._ui(self._log, f"Saving YouTube downloads and transcripts to: {playlist_dir}")
                total_items = len(self.youtube_entries)
                for index, entry in enumerate(self.youtube_entries, start=1):
                    self._ui(self._log, "")
                    self._ui(self._log, f"[{index}/{total_items}] YouTube: {entry['title']}")
                    try:
                        source_path = self._download_youtube_audio(entry, playlist_dir)
                        with tempfile.TemporaryDirectory(prefix="transcriber-") as temp_dir:
                            audio_path = self._prepare_audio(source_path, temp_dir)
                            output_file = self._run_whisper_cpp(source_path, audio_path, model_name, model_path, language)
                        saved_outputs.append(output_file)
                        self._ui(self._log, f"Saved: {output_file}")
                    except Exception as exc:
                        failed_files.append((Path(entry["title"]), str(exc)))
                        self._ui(self._log, f"Error while processing {entry['title']}:\n{exc}")
            else:
                selected_files = [Path(path) for path in self.file_paths]
                for index, source_path in enumerate(selected_files, start=1):
                    self._ui(self._log, "")
                    self._ui(self._log, f"[{index}/{len(selected_files)}] Processing: {source_path.name}")
                    try:
                        with tempfile.TemporaryDirectory(prefix="transcriber-") as temp_dir:
                            audio_path = self._prepare_audio(source_path, temp_dir)
                            output_file = self._run_whisper_cpp(source_path, audio_path, model_name, model_path, language)
                        saved_outputs.append(output_file)
                        self._ui(self._log, f"Saved: {output_file}")
                    except Exception as exc:
                        failed_files.append((source_path, str(exc)))
                        self._ui(self._log, f"Error while processing {source_path.name}:\n{exc}")

            if saved_outputs:
                self._open_output_dirs([output.parent for output in saved_outputs])

            if failed_files:
                self._ui(self._log, "")
                self._ui(self._log, "Some files could not be transcribed:")
                for source_path, error_text in failed_files:
                    summary = error_text.splitlines()[0] if error_text else "Unknown error."
                    self._ui(self._log, f"  - {source_path.name}: {summary}")

                if saved_outputs:
                    self._ui(
                        self._set_status,
                        f"Completed with errors. Saved {len(saved_outputs)} transcript(s), failed {len(failed_files)}.",
                        "error",
                    )
                else:
                    self._ui(self._set_status, "Transcription failed for all selected files. Check the log.", "error")
            else:
                self._ui(
                    self._set_status,
                    f"Done. Saved {len(saved_outputs)} transcript(s) next to the original file(s).",
                    "success",
                )
        except Exception as exc:
            self._ui(self._log, f"Error:\n{exc}")
            self._ui(self._set_status, "Transcription failed. Check the log.", "error")
        finally:
            self._ui(self._set_busy, False)


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        raise SystemExit(_run_self_test())

    app = TranscriberApp()
    app.lift()
    app.attributes("-topmost", True)
    app.after(200, lambda: app.attributes("-topmost", False))
    app.focus_force()
    app.mainloop()
