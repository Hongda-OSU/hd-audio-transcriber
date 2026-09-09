#!/bin/bash
# =============================================================
#  音频转录 App · 后端环境安装脚本 (setup_backend.sh)
#  一条命令装好锁定版本的 whisperx 环境，永不再踩版本坑。
#  用法:  bash setup_backend.sh
# =============================================================
set -e

VENV="$HOME/.transcriber-env"     # 后端专用的独立环境

echo "=============================================="
echo "  音频转录 App · 后端环境安装"
echo "=============================================="

# ---- 1. 检查 / 安装 ffmpeg ----
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "▶ 未找到 ffmpeg，尝试用 Homebrew 安装..."
  if command -v brew >/dev/null 2>&1; then
    brew install ffmpeg
  else
    echo "✗ 没有 Homebrew。请先安装 Homebrew (https://brew.sh) 再重跑本脚本。"
    exit 1
  fi
else
  echo "✔ ffmpeg 已就绪"
fi

# ---- 2. 创建独立虚拟环境 ----
if [ ! -d "$VENV" ]; then
  echo "▶ 创建 Python 虚拟环境: $VENV"
  python3 -m venv "$VENV"
else
  echo "✔ 虚拟环境已存在: $VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install -U pip >/dev/null

# ---- 3. 按正确顺序安装锁定版本 ----
# 顺序很重要：先装旧版 torch（绕开新版的安全限制），再装 whisperx，
# 最后强制把 pyannote / speechbrain / numpy 降到互相兼容的版本。
echo "▶ 安装 PyTorch (锁定 2.5.1)..."
pip install "torch==2.5.1" "torchaudio==2.5.1"

echo "▶ 安装 whisperx..."
pip install whisperx

echo "▶ 强制安装兼容版本的 pyannote / speechbrain / numpy..."
pip install "pyannote.audio==3.1.1" "speechbrain==0.5.16" "numpy<2"

# ---- 4. 写一份版本快照，便于以后完整复现 ----
pip freeze > "$VENV/requirements.lock.txt"
echo "✔ 已写出版本快照: $VENV/requirements.lock.txt"

# ---- 5. 完成提示（token 改由 App 配置，这里不再索取）----
echo ""
echo "=============================================="
echo "✅ 后端环境安装完成: $VENV"
echo "=============================================="
echo ""
echo "还差一步（仅说话人分离需要，且只需一次）——接受模型条款:"
echo "  到以下两个页面各点一次 Agree:"
echo "     - https://huggingface.co/pyannote/speaker-diarization-3.1"
echo "     - https://huggingface.co/pyannote/segmentation-3.0"
echo "  HuggingFace token 不在这里填——在 App 的设置里配置即可。"
echo ""
echo "验证环境是否可用，可运行:"
echo "  source \"$VENV/bin/activate\" && python -c 'import whisperx, pyannote.audio; print(\"OK\")'"
