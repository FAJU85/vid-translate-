"""A picture for sound alone: a song or a podcast becomes a video with a moving visualizer.

Everything is drawn by ffmpeg (no other tools, no models): a background (a colour gradient, or
the file's own cover art blurred), the sound drawn as it plays, and the styled subtitles (the
lyrics) burned on top, in one pass.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from ...shared.errors import PipelineError as MediaError
from .core import CancelFn, ProgressFn, _run_ffmpeg

# Frame sizes: vertical for Reels / TikTok / Shorts, square, and wide (YouTube).
FRAMES = {"vertical": (720, 1280), "square": (720, 720), "wide": (1280, 720)}
# wave: the sound's shape in white; neon: the same, glowing; bars: musical notes as coloured bars.
LOOKS = ("wave", "neon", "bars")
# Two-colour gradients, from the top to the bottom.
BACKDROPS = {
    "kavox": ("0x131C31", "0x0F5E68"),
    "night": ("0x05060A", "0x2A1B5C"),
    "sunset": ("0x4A1030", "0xC2410C"),
    "forest": ("0x06281E", "0x3F6212"),
}
COVER = "cover"  # the file's own picture (album art), blurred; a gradient when it has none
FPS = 25
BACKGROUND_FILE = "visual_bg.png"


def _has_cover(src: Path) -> bool:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=index", "-of", "csv=p=0", str(src)],
        capture_output=True, text=True, timeout=60,
    )
    return proc.returncode == 0 and bool(proc.stdout.strip())


def _background(src: Path, dest: Path, backdrop: str, w: int, h: int) -> None:
    """One still picture for the whole video (drawn once, not per frame)."""
    if backdrop == COVER and _has_cover(src):
        args = ["-i", str(src), "-map", "0:v:0", "-frames:v", "1", "-vf",
                f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=24:2,eq=brightness=-0.22:saturation=1.15"]
    else:
        c0, c1 = BACKDROPS.get(backdrop, BACKDROPS["kavox"])
        args = ["-f", "lavfi", "-i", f"gradients=s={w}x{h}:c0={c0}:c1={c1}:x0=0:y0=0:x1=0:y1={h}:nb_colors=2",
                "-frames:v", "1"]
    try:
        _run_ffmpeg([*args, str(dest)], dest.parent, 0, lambda: False, lambda _f: None)
    except MediaError:
        if backdrop == COVER:  # an unreadable cover: the default gradient instead
            _background(src, dest, "kavox", w, h)
        else:
            raise


def _visualizer(look: str, w: int, band: int) -> str:
    """Filter chain from the sound ([0:a]) to a moving picture of it on a see-through background.

    The sound is evened out first (quiet passages drawn as clearly as loud ones; only for the
    picture, never for what is heard). Each visualizer makes FPS frames a second itself: an `fps`
    filter after one filled the memory.
    """
    wave = f"showwaves=s={w}x{band}:mode=cline:rate={FPS}:scale=sqrt:draw=full"
    if look == "bars":  # one bar per musical note (constant-Q), black made see-through
        draw = f"showcqt=s={w}x{band}:bar_h={band}:sono_h=0:axis=0:r={FPS}:bar_v=40,format=rgba,colorkey=0x000000:0.1:0.1"
    elif look == "neon":  # a blurred copy under the line makes it glow
        draw = f"{wave}:colors=0x2DD4BF,format=rgba,split[line][halo];[halo]gblur=sigma=10:planes=15[glow];[glow][line]overlay,format=rgba"
    else:
        draw = f"{wave}:colors=0xFFFFFF,format=rgba"
    return f"[0:a]dynaudnorm=f=150:g=9,aformat=channel_layouts=stereo,{draw}[vis]"


def audio_video(src: Path, ass_name: str, dest: Path, duration: float, look: str, backdrop: str, frame: str,
                cancelled: CancelFn, progress: ProgressFn) -> None:
    """Make a video from sound alone: background, visualizer and the subtitles (an .ass file in
    dest's folder), with the original sound. `look`, `backdrop`, `frame`: LOOKS, BACKDROPS (or
    "cover"), FRAMES; anything unknown takes the first."""
    w, h = FRAMES.get(frame, FRAMES["vertical"])
    look = look if look in LOOKS else LOOKS[0]
    work = dest.parent
    bg = work / BACKGROUND_FILE
    band = round(h * (0.22 if h > w else 0.3)) // 2 * 2
    try:
        _background(src, bg, backdrop, w, h)
        graph = ";".join([
            _visualizer(look, w, band),
            # The background comes from inside the graph, one frame each time one is needed: as a
            # looped input it was read ahead of the visualizer without limit.
            f"movie={bg.name}:loop=0,setpts=N/({FPS}*TB)[bg]",
            f"[bg][vis]overlay=0:(H-h)/2:shortest=1,ass={ass_name}:shaping=complex,format=yuv420p[v]",
        ])
        _run_ffmpeg(
            ["-i", str(src), "-filter_complex", graph,
             "-map", "[v]", "-map", "0:a:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-r", str(FPS),
             "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(dest)],
            work, duration, cancelled, progress,
        )
    finally:
        bg.unlink(missing_ok=True)
