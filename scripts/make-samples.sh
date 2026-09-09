#!/bin/bash
# Regenerates samples/ — test audio and the transcript it should produce.
#
# samples/ is git-ignored, so this script is the only record of what those
# files are. Delete the folder and run this to get it back:
#     bash scripts/make-samples.sh
#
# Needs ffmpeg and macOS `say`.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="samples"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

# Two voices with clearly different timbre. Both names must include the
# parenthesised locale: `say -v Grandpa` resolves to the English voice, which
# produces a near-empty file for Chinese text and leaves a one-speaker
# recording that looks like a diarization failure.
VOICE_A="Tingting"
VOICE_B="Grandpa (Chinese (China mainland))"

say_line() {  # say_line <index> <voice> <text>
  local n; printf -v n "%02d" "$1"
  say -v "$2" -o "$TMP/$n.aiff" "$3"
  local d
  d=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$TMP/$n.aiff")
  # A voice that silently fails yields a near-empty clip. Catch it here rather
  # than in a transcript that appears to have one speaker.
  if [ "$(echo "$d > 0.5" | bc)" != "1" ]; then
    echo "✗ Line $n produced ${d}s of audio — is \"$2\" a real voice name?" >&2
    exit 1
  fi
  # 0.4s between turns: diarization needs somewhere to place the boundary.
  ffmpeg -v error -y -f lavfi -t 0.4 -i anullsrc=r=22050:cl=mono "$TMP/${n}_gap.aiff"
}

echo "▶ interview-tts.m4a — two speakers, twelve turns"

i=0
: > "$TMP/lines.txt"
add() {  # add <voice> <speaker label> <text>
  i=$((i + 1))
  say_line "$i" "$1" "$3"
  printf '%s\t%s\n' "$2" "$3" >> "$TMP/lines.txt"
}

add "$VOICE_A" "Interviewer" "您好，非常感谢您抽出时间接受我们的访谈。"
add "$VOICE_B" "Subject"     "客气了，能聊聊这些事情我也很高兴。"
add "$VOICE_A" "Interviewer" "我们先从头说起吧。您是哪一年开始做这一行的？"
add "$VOICE_B" "Subject"     "那是一九八七年的春天。当时我刚从学校出来，什么都不懂，跟着师傅从最基础的活儿学起。头三年基本上就是打下手，扫地、搬料、递工具。现在回头看，那三年反倒是最扎实的。"
add "$VOICE_A" "Interviewer" "三年打下手，中间有没有想过放弃？"
add "$VOICE_B" "Subject"     "想过。第二年冬天特别冷，车间里没有暖气，手上全是冻疮。有一天我跟师傅说我不干了。他没劝我，只说你先把今天这批活儿做完再走。结果做完天都黑了，我也就没走成。"
add "$VOICE_A" "Interviewer" "后来是什么时候觉得自己算是入门了？"
add "$VOICE_B" "Subject"     "大概是第五年吧。有一次师傅出差，来了个急件，全车间只有我敢接。做完之后师傅回来看了一眼，什么也没说，就点了点头。那一下我心里就踏实了。"
add "$VOICE_A" "Interviewer" "这个行业这些年变化大吗？"
add "$VOICE_B" "Subject"     "太大了。以前全靠手上功夫，现在很多都是机器做。年轻人学得快，但是有些东西机器替不了。你比如说料的脾气，得靠手去感觉。"
add "$VOICE_A" "Interviewer" "最后一个问题，如果现在有年轻人想入行，您会跟他说什么？"
add "$VOICE_B" "Subject"     "我会跟他说，别着急。这行没有捷径，你花多少时间它就给你多少回报。急着出成绩的人，往往做不长。"

: > "$TMP/concat.txt"
for n in $(seq -w 1 $i); do
  echo "file '$TMP/$n.aiff'" >> "$TMP/concat.txt"
  echo "file '$TMP/${n}_gap.aiff'" >> "$TMP/concat.txt"
done
ffmpeg -v error -y -f concat -safe 0 -i "$TMP/concat.txt" -c:a aac -b:a 128k "$OUT/interview-tts.m4a"

# The transcript this recording should produce, with the turn boundaries.
: > "$OUT/interview-tts-truth.txt"
t=0
for n in $(seq -w 1 $i); do
  d=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$TMP/$n.aiff")
  end=$(echo "$t + $d" | bc)
  line=$(sed -n "$((10#$n))p" "$TMP/lines.txt")
  printf '%6.1f–%6.1f  %s\n' "$t" "$end" "$line" >> "$OUT/interview-tts-truth.txt"
  t=$(echo "$end + 0.4" | bc)
done

echo "▶ format probes — one container each, a few seconds is enough"
ffmpeg -v error -y -f lavfi -i "sine=frequency=440:duration=4" -c:a libmp3lame "$OUT/probe.mp3"
ffmpeg -v error -y -f lavfi -i "sine=frequency=440:duration=4" "$OUT/probe.wav"
# 1:23:45 of silence: checks that durations over an hour render as h:mm:ss.
# Silence compresses to almost nothing, unlike the 42MB tone this replaces.
ffmpeg -v error -y -f lavfi -t 5025 -i anullsrc=r=16000:cl=mono -c:a aac -b:a 8k "$OUT/long-silence.m4a"

echo "▶ error cases"
echo "not audio" > "$OUT/not-audio.txt"
# A valid container with no audio stream — a different failure from a file
# ffmpeg cannot parse at all, and the app reports them differently.
ffmpeg -v error -y -f lavfi -i "testsrc=duration=3:size=320x240:rate=10" -an "$OUT/video-no-audio.mp4"

echo ""
echo "✅ samples/"
ls -lh "$OUT" | tail -n +2 | awk '{printf "   %-26s %8s\n", $9, $5}'
