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

say_line() {  # say_line <file stem> <voice> <text>
  local n="$1"
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

# One recording: start, a run of add, then finish. The slug prefixes the clips
# so a second recording cannot collide with the first.
SLUG=""; N=0

start() {  # start <slug>
  SLUG="$1"; N=0
  : > "$TMP/$SLUG.lines"
  : > "$TMP/$SLUG.concat"
}

add() {  # add <voice> <speaker label> <text>
  N=$((N + 1))
  local n; printf -v n "%02d" "$N"
  say_line "$SLUG-$n" "$1" "$3"
  printf '%s\t%s\n' "$2" "$3" >> "$TMP/$SLUG.lines"
  printf "file '%s'\n" "$TMP/$SLUG-$n.aiff" "$TMP/$SLUG-${n}_gap.aiff" >> "$TMP/$SLUG.concat"
}

finish() {  # finish <output stem>
  ffmpeg -v error -y -f concat -safe 0 -i "$TMP/$SLUG.concat" -c:a aac -b:a 128k "$OUT/$1.m4a"

  # The transcript this recording should produce, with the turn boundaries.
  : > "$OUT/$1-truth.txt"
  local t=0 k n d end line
  for k in $(seq 1 $N); do
    printf -v n "%02d" "$k"
    d=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$TMP/$SLUG-$n.aiff")
    end=$(echo "$t + $d" | bc)
    line=$(sed -n "${k}p" "$TMP/$SLUG.lines")
    printf '%6.1f–%6.1f  %s\n' "$t" "$end" "$line" >> "$OUT/$1-truth.txt"
    t=$(echo "$end + 0.4" | bc)
  done
}

echo "▶ interview-tts.m4a — two speakers, twelve turns"
start a

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

finish interview-tts

# A second recording, so the queue has something to queue. Different voices as
# well as a different topic: two files that sound alike would make a demo of
# speaker separation prove nothing.
echo "▶ interview-tts-2.m4a — a shorter one, two other voices"
VOICE_C="Grandma (Chinese (China mainland))"
VOICE_D="Reed (Chinese (China mainland))"
start b

add "$VOICE_D" "Interviewer" "今天想请您聊聊那家照相馆。"
add "$VOICE_C" "Subject"     "好啊。那个店开了二十六年，去年才关的。"
add "$VOICE_D" "Interviewer" "当初怎么会想到开照相馆呢？"
add "$VOICE_C" "Subject"     "其实是接手的。原来的老板要搬走，问我要不要盘下来。我那时候在纺织厂上班，一个月工资不够养家，就咬牙接了。头两年天天泡在暗房里，手指头都被药水泡白了。"
add "$VOICE_D" "Interviewer" "生意最好的是哪几年？"
add "$VOICE_C" "Subject"     "九几年吧。那会儿结婚都要拍全家福，一到周末门口能排到街上。后来大家都有手机了，来的人就少了。不过老街坊还是会来，拍身份证照片，顺便坐下来说说话。"

finish interview-tts-2

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
