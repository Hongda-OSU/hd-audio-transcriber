# hd-audio-transcriber

自用的 macOS Electron App：音频 → 带说话人区分和时间轴的文字稿 → 编辑 → 导出。
**自用，不分发。**

## 沟通约定

- 面向用户的回复用**中文**；代码、标识符、命令、commit message 用英文。

## 需求来源

需求文档在 Notion，**不在仓库里**。做规划或拿不准范围时先 fetch：

- 主文档：https://app.notion.com/p/3cc60d3cf9f381ddbb55dbdcc0b9d87a
- 后端安装脚本：https://app.notion.com/p/3d160d3cf9f381829fcdcf8ca776a77d
- 智能整理指令：https://app.notion.com/p/3d160d3cf9f381098685f3786a7e6ee2

## 架构

Electron 主进程 spawn 本机 `~/.transcriber-env/bin/whisperx` 子进程，解析它写出的 json：

```bash
~/.transcriber-env/bin/whisperx "<file>" \
  --model <model> --language <lang> --diarize --no_align \
  --min_speakers <n> --max_speakers <n> --hf_token "<token>" \
  --compute_type int8 --output_dir "<tmpdir>" --output_format json
```

结果在 `<output_dir>/<basename>.json`：

```json
{ "segments": [{ "start": 0.0, "end": 3.2, "text": "……", "speaker": "SPEAKER_00" }],
  "language": "zh" }
```

`speaker` 字段仅在带 `--diarize` 时出现。进度靠逐行读 whisperx 的 **stderr** 日志粗估。

## 硬性约束

1. **依赖版本锁死，任何情况下不要升级或改动**：torch/torchaudio 2.5.1、pyannote.audio 3.1.1、speechbrain 0.5.16、numpy<2。这套组合是踩坑试出来的。
2. **不把 Python 运行时打包进 App**。只调用本机 `~/.transcriber-env`。
3. **环境缺失要友好提示**跑 `setup_backend.sh`，绝不允许崩溃。
4. **whisperx 跑在子进程里，不阻塞 UI**。
5. **`--language` / `--model` / `--min_speakers` / `--max_speakers` 一律来自界面选项，不写死。**
6. **HF token 存本机 `config.json`**，已在 `.gitignore` 中；不入库、不打印到日志、不外传。

## 非目标（不要做）

代码签名 / 公证、App Store 上架、自动更新、跨平台（只跑 macOS）、多用户 / 授权 / 合规、把 Python 打包进 App。

## 权威中间产物

whisperx 的 json 是唯一权威数据源。所有导出格式（txt / srt / vtt / docx）都由 `lib/exporters.js` 从 `segments` 生成，不要从其他中间态派生。

## 里程碑

M1 空壳+拖拽 → M2 接通 whisperx → M3 选项+进度条 → M4 改真名+导出 → M5 交给整理 → M6 打包 `.app`。
每个里程碑的验收标准见 README 与 Notion 主文档。

## 开发命令

```bash
npm install && npm start        # 起 App
bash setup_backend.sh           # 装/重装后端环境（换机器时）
source ~/.transcriber-env/bin/activate && python -c 'import whisperx, pyannote.audio; print("OK")'
```
