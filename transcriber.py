import os
import shutil
import subprocess
import sys
import tempfile
import threading
import tkinter as tk
import urllib.error
import urllib.request
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from tkinter.scrolledtext import ScrolledText

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
UI_FONT = ".AppleSystemUIFont" if os.name == "posix" and "darwin" in sys.platform else "Helvetica"
MONO_FONT = "SF Mono" if os.name == "posix" and "darwin" in sys.platform else "Menlo"


class TranscriberApp(TkinterDnD.Tk if HAS_DND else tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("WhisperDrop")
        self.geometry("820x900")
        self.minsize(720, 620)
        self.configure(bg=BG)

        self.app_dir = Path(__file__).resolve().parent
        self.model_dir = self.app_dir / ".models" / "whisper.cpp"
        self.file_path = None
        self.output_dir = None

        default_model = "Turbo Q5"
        self.file_var = tk.StringVar(value="No file selected")
        self.file_help_var = tk.StringVar(value="Choose an audio or video file to create a text transcript.")
        self.status_var = tk.StringVar(value="Ready")
        self.lang_var = tk.StringVar(value="Italian")
        self.model_var = tk.StringVar(value=default_model)
        self.model_help_var = tk.StringVar(value=MODELS[default_model]["description"])

        self._build_ui()
        self._bind_shortcuts()

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
        root.grid_columnconfigure(0, weight=1)
        root.grid_rowconfigure(4, weight=1)

        header = tk.Frame(root, bg=BG)
        header.grid(row=0, column=0, sticky="ew", pady=(0, 18))
        header.grid_columnconfigure(0, weight=1)

        tk.Label(
            header,
            text="WhisperDrop  🎙️",
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

        file_card = tk.Frame(root, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        file_card.grid(row=1, column=0, sticky="ew")
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
            text="Drop file here ➕",
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

        if HAS_DND:
            self.drop_zone.drop_target_register(DND_FILES)
            self.drop_zone.dnd_bind("<<Drop>>", self._on_drop)

        browse_row = tk.Frame(file_card, bg=CARD)
        browse_row.grid(row=2, column=0, sticky="ew", padx=18, pady=(14, 12))
        browse_row.grid_columnconfigure(0, weight=1)

        self.browse_btn = tk.Button(
            browse_row,
            text="Browse File  📂",
            command=self._browse_file,
            font=(UI_FONT, 13, "bold"),
            bg=WHITE,
            fg=BG,
            activebackground=WHITE_SOFT,
            activeforeground=BG,
            bd=0,
            padx=18,
            pady=14,
            cursor="hand2",
            disabledforeground="#555555",
        )
        self.browse_btn.grid(row=0, column=0)

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

        options = tk.Frame(root, bg=BG)
        options.grid(row=2, column=0, sticky="ew", pady=(18, 18))
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

        action_card = tk.Frame(root, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        action_card.grid(row=3, column=0, sticky="ew", pady=(0, 18))
        action_card.grid_columnconfigure(0, weight=1)

        self.run_btn = tk.Button(
            action_card,
            text="Start Transcription  ▶️",
            command=self._run_transcription,
            font=(UI_FONT, 13, "bold"),
            bg=GREEN,
            fg=BG,
            activebackground=GREEN_DARK,
            activeforeground=BG,
            bd=0,
            padx=18,
            pady=14,
            cursor="hand2",
            disabledforeground="#555555",
        )
        self.run_btn.grid(row=0, column=0, sticky="ew", padx=18, pady=(18, 10))

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

        log_card = tk.Frame(root, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        log_card.grid(row=4, column=0, sticky="nsew")
        log_card.grid_columnconfigure(0, weight=1)
        log_card.grid_rowconfigure(1, weight=1)

        tk.Label(
            log_card,
            text="Log",
            font=(UI_FONT, 15, "bold"),
            bg=CARD,
            fg=TEXT,
        ).grid(row=0, column=0, sticky="w", padx=18, pady=(16, 8))

        self.log = ScrolledText(
            log_card,
            height=10,
            wrap="word",
            bg=BG,
            fg=TEXT,
            insertbackground=TEXT,
            relief="flat",
            font=(MONO_FONT, 11),
            padx=12,
            pady=12,
        )
        self.log.grid(row=1, column=0, sticky="nsew", padx=18, pady=(0, 18))
        self.log.config(state="disabled")

        self._set_drop_zone_hover(False)
        self._set_status("Ready", "neutral")
        self._log("Ready. whisper.cpp backend is active.")

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
        path = event.data.strip().strip("{}")
        self._set_file(path)

    def _browse_file(self, event=None):
        path = filedialog.askopenfilename(
            title="Select audio or video file",
            filetypes=[("Audio and video", "*.mp3 *.wav *.m4a *.ogg *.flac *.opus *.webm *.mp4 *.aac")],
        )
        if path:
            self._set_file(path)

    def _set_file(self, path):
        file_path = Path(path)
        ext = file_path.suffix.lower()
        if ext not in SUPPORTED:
            messagebox.showerror("Unsupported file", f"Supported formats: {', '.join(sorted(SUPPORTED))}")
            return

        self.file_path = str(file_path)
        self.output_dir = str(file_path.parent)
        self.file_var.set(file_path.name)
        self.file_help_var.set("Ready to transcribe with whisper.cpp. The text file will be saved next to the original file.")
        self.file_help_label.config(fg=GREEN)
        self._set_status("File selected. Ready to transcribe.", "success")
        self._log(f"Loaded: {file_path.name}")

    def _log(self, message):
        self.log.config(state="normal")
        self.log.insert("end", message + "\n")
        self.log.see("end")
        self.log.config(state="disabled")

    def _find_binary(self, names):
        for name in names:
            resolved = shutil.which(name)
            if resolved:
                return resolved

        for prefix in (Path("/opt/homebrew/bin"), Path("/usr/local/bin")):
            for name in names:
                candidate = prefix / name
                if candidate.exists():
                    return str(candidate)

        return None

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
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            error_output = result.stderr.strip() or result.stdout.strip() or "Unknown ffmpeg error."
            raise RuntimeError(f"Audio conversion failed.\n{error_output}")

        return wav_path

    def _next_output_base(self):
        original_base = Path(self.output_dir) / Path(self.file_path).stem
        if not original_base.with_suffix(".txt").exists():
            return original_base

        counter = 2
        while True:
            candidate = original_base.with_name(f"{original_base.name} ({counter})")
            if not candidate.with_suffix(".txt").exists():
                self._ui(self._log, f"Existing transcript found. Saving as: {candidate.name}.txt")
                return candidate
            counter += 1

    def _run_whisper_cpp(self, audio_path, model_name, model_path, language):
        whisper_cpp = self._find_binary(("whisper-cli", "whisper-cpp"))
        if not whisper_cpp:
            raise RuntimeError("whisper.cpp was not found. Run setup again to install it.")

        output_base = self._next_output_base()
        threads = max(1, min(8, os.cpu_count() or 4))
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
        ]

        self._ui(self._set_status, f"Transcribing with {model_name}...", "neutral")
        self._ui(self._log, f"Starting whisper.cpp with model '{model_name}'.")
        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            error_output = result.stderr.strip() or result.stdout.strip() or "Unknown whisper.cpp error."
            raise RuntimeError(error_output)

        output_file = output_base.with_suffix(".txt")
        if not output_file.exists():
            raise RuntimeError("whisper.cpp finished without creating the transcript file.")

        cli_output = (result.stdout or result.stderr or "").strip()
        if cli_output:
            self._ui(self._log, cli_output)

        return output_file

    def _set_busy(self, busy):
        if busy:
            self.run_btn.config(state="disabled", text="Transcribing...  ⏳", bg=GREEN_DARK, fg=BG)
            self.progress.grid(row=1, column=0, sticky="ew", padx=18, pady=(0, 10))
            self.progress.start(10)
            self._set_status("Transcription in progress...", "neutral")
        else:
            self.progress.stop()
            self.progress.grid_forget()
            self.run_btn.config(state="normal", text="Start Transcription  ▶️", bg=GREEN, fg=BG)

    def _run_transcription(self):
        if not self.file_path:
            messagebox.showwarning("No file", "Please select a file first.")
            return

        self._set_busy(True)
        threading.Thread(target=self._transcribe, daemon=True).start()

    def _transcribe(self):
        try:
            language = LANGUAGES[self.lang_var.get()]
            model_name = self.model_var.get()
            model_info = MODELS[model_name]
            model_path = self._download_model(model_name, model_info)

            with tempfile.TemporaryDirectory(prefix="transcriber-") as temp_dir:
                audio_path = self._prepare_audio(self.file_path, temp_dir)
                output_file = self._run_whisper_cpp(audio_path, model_name, model_path, language)

            self._ui(self._log, f"Saved: {output_file}")
            self._ui(self._set_status, "Done. Transcript saved next to the original file.", "success")
            subprocess.run(["open", self.output_dir], check=False)
        except Exception as exc:
            self._ui(self._log, f"Error:\n{exc}")
            self._ui(self._set_status, "Transcription failed. Check the log.", "error")
        finally:
            self._ui(self._set_busy, False)


if __name__ == "__main__":
    app = TranscriberApp()
    app.lift()
    app.attributes("-topmost", True)
    app.after(200, lambda: app.attributes("-topmost", False))
    app.focus_force()
    app.mainloop()