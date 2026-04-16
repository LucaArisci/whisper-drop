# whisper-drop

![WhisperDrop UI](<Screenshot 2026-04-16 095610.png>)

A minimal desktop app to transcribe audio files with drag & drop, powered by whisper.cpp and quantized GGML models.

![WhisperDrop screenshot](assets/screenshot.png)

---

## Features

- Drag & drop any audio or video file onto the window
- Supports `.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`, `.opus`, `.webm`, `.mp4`, `.aac`
- Quantized GGML models (Q5/Q8) for lower resource usage on CPU
- Models are downloaded automatically on first use and cached locally
- Two-column layout with live log panel
- Outputs a `.txt` file saved next to the original audio
- No technical knowledge required to use

---

## Requirements

- macOS or Windows
- Internet connection for the first setup and first use of each model

---

## Installation

### macOS

Clone the repo:

```bash
git clone https://github.com/your-username/whisper-drop.git
cd whisper-drop
chmod +x WhisperDrop.command
chmod +x WhisperDrop_installer.command
```

Then run the installer:

```bash
./scripts/setup.sh
```

Or double-click `WhisperDrop_installer.command` from Finder.

This will automatically install:
- [Homebrew](https://brew.sh)
- ffmpeg
- whisper.cpp (`whisper-cli`)
- Python 3.11
- tkinterdnd2 (in a local `.venv`)

> **Note:** Setup takes a few minutes the first time.

### Windows

Clone the repo:

```powershell
git clone https://github.com/your-username/whisper-drop.git
cd whisper-drop
```

Then run the installer:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

Or double-click `WhisperDrop_installer.bat`.

This will automatically:
- install Python 3.11 with `winget` if missing
- download a local `ffmpeg` build if it is not already available
- download the official `whisper.cpp` Windows binary inside `.tools/whisper.cpp`
- install `tkinterdnd2` in a local `.venv`

> **Note:** On Windows, the first setup can take a few minutes because the required binaries are downloaded locally on first run.

---

## Usage

Double-click `WhisperDrop.command` on macOS or `WhisperDrop.bat` on Windows to open the app.

> **On first launch**, the platform launcher will run setup automatically if it hasn't been done yet.

> **Gatekeeper warning (macOS):** macOS may block `.command` files downloaded from the internet. If you see a *"Not Opened"* warning, click **Done**, then run this once in Terminal:
>
> ```bash
> xattr -d com.apple.quarantine /path/to/WhisperDrop.command
> xattr -d com.apple.quarantine /path/to/scripts/setup.sh
> xattr -d com.apple.quarantine "/path/to/WhisperDrop_installer.command"
> ```

Once the app is open:

1. Drag & drop an audio file onto the window (or click to browse)
2. Select the language and model
3. Click **Start Transcription**
4. The `.txt` file is saved in the same folder as the original audio

---

## Models

Models are downloaded from [HuggingFace](https://huggingface.co/ggerganov/whisper.cpp) on first use and cached in `.models/whisper.cpp/` inside the app folder.

| Model | Size | Speed | Best for |
|-------|------|-------|----------|
| Tiny Q5 | ~32 MB | Fastest | Older or slower hardware |
| Base Q5 | ~57 MB | Fast | Balanced choice for most users |
| Small Q5 | ~190 MB | Medium | Better accuracy on complex audio |
| Medium Q5 | ~515 MB | Slow | High accuracy |
| Turbo Q5 | ~547 MB | Fast | Fast and accurate, recommended |
| Turbo Q8 | ~874 MB | Medium | Maximum accuracy while quantized |

**Turbo Q5** is the default and recommended for most use cases.

---

## Development

To run the app with hot reload while editing `transcriber.py`:

```bash
# Install watchdog once
.venv/bin/pip install watchdog

# Start the dev watcher
.venv/bin/python scripts/dev.py
```

On Windows, use the equivalent executables under `.venv\Scripts\`.

Every time you save `transcriber.py` the app will restart automatically.

---

## Project structure

```text
whisper-drop/
|-- scripts/
|   |-- setup.sh                   # macOS setup script
|   |-- setup.ps1                  # Windows setup script
|   `-- dev.py                     # Hot-reload dev launcher
|-- transcriber.py                 # Main app
|-- WhisperDrop.command            # macOS launcher
|-- WhisperDrop.bat                # Windows launcher
|-- WhisperDrop_installer.command  # macOS installer
|-- WhisperDrop_installer.bat      # Windows installer
|-- requirements.txt               # Python dependencies
|-- .gitignore
|-- LICENSE
|-- README.md
|-- .venv/                         # Local Python environment (created by setup)
|-- .tools/                        # Local Windows helper tools/builds (created by setup)
`-- .models/whisper.cpp/           # Cached GGML models (created on first use)
```

---

## License

MIT
