// The handoff: everything the cleanup step needs, in one file.
//
// The app's output is raw material, not a finished transcript. Punctuation,
// paragraphing, proper nouns and — the one this cost the most to learn —
// speaker boundaries are all decided by meaning, which is not something the
// timings can be asked about: on a real interview 56 of 58 speaker changes had
// a gap of exactly zero, so there is no silence to anchor a boundary to.
//
// So rather than the app guessing, it writes down what it knows, what it does
// not, and hands over the whole thing. No API key, no network, no dependency:
// a file the user drops into a conversation.
//
// RULES is the user's own instruction page, kept verbatim rather than
// paraphrased — it is the source of truth for this step and lives in their
// notes, not in this repo.

// Type-only from exporters, so the registration there is the one direction
// between these two files and nothing imports in a circle at runtime.
import type { ExportInput } from './exporters';
import { speakerName } from './speakers';

const RULES = `## 角色

你是一名专业的口述访谈整理者。输入是带说话人标签（SPEAKER_00 / 01…）和时间戳的文字稿。把它整理成一份可读、可存档的访谈稿。

> ⚠️ **说话人是谁可信，话在哪儿断不可信。** 声纹聚类把两个人分得很准 —— 实测一场 54 分钟访谈，最长的十几段访谈人发言全部确实是提问。**但轮换边界上的几个词经常划错边**，甚至从词中间劈开：一句话的前半截标着 A，后半截标着 B。
>
> 所以：**句子被切开时，请按内容合回去**，把碎片归给它实际所属的那一方。
>
> 仍然适用：**不要把整段发言换人**。两人观点相近、或一方复述另一方的话时，整段按内容猜反而更容易错。要改的是**边界**，不是归属。

## 整理步骤

1. **修复被劈开的句子**：上游已经按词级标签切过一遍，但边界不准，一句话常被拆给两三个人（见上方警告）。先把这类碎片合并回完整的一轮发言，再往下走。
2. **去重复与幻听**：删掉停顿处的鬼打墙重复句，酌情精简口头语，保留讲述者语气，不过度改写。
3. **纠正专有名词**：依据术语表（若有）统一人名地名术语，修正明显听错的字词。
4. **加标点、分段**：补全标点，按语义分段。注意：**中文转录几乎一个标点都没有**（实测 11,439 字里只有 6 个），所以这一步不是「补全」而是「从头加」。
5. **保留时间轴**：每个话题段前标 〔mm:ss〕。
6. **按话题分小节**：每节起一个简短小标题。

## 输出格式

- 顶部：各说话人、录音日期、时长、一句整理说明。
- 正文：小节标题 +「**姓名：** 内容」对话形式，段前带时间戳。
- 默认产出 Word（.docx）+ Markdown。`;

/** 4:07, or 1:23:45 once it runs past an hour. Its own copy rather than the
 *  one in exporters: that one is private, and this file wants the same shape
 *  for a total length as for a segment's start. */
function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  const minutes = Math.floor((total % 3600) / 60);

  return total >= 3600
    ? `${Math.floor(total / 3600)}:${pad(minutes)}:${pad(total % 60)}`
    : `${minutes}:${pad(total % 60)}`;
}

/**
 * The rules, what this particular recording is, and the draft — one file to
 * hand over.
 *
 * The speaker table is the reason the names are worth typing before exporting:
 * with it the cleanup starts on the work instead of on four questions.
 */
export function toCleanup({ segments, names, audio }: ExportInput): string {
  const labels: string[] = [];
  for (const segment of segments) {
    if (segment.speaker && !labels.includes(segment.speaker)) labels.push(segment.speaker);
  }
  labels.sort();

  const roster = labels.length
    ? labels.map((label) => `- ${label} → ${speakerName(label, names)}`).join('\n')
    : '- 这次运行没有做说话人分离，稿子里没有标签。';

  const length = segments.length ? clock(segments[segments.length - 1]?.end ?? 0) : '0:00';

  const draft = segments
    .map((segment) => {
      const who = speakerName(segment.speaker, names);
      const head = who ? `〔${clock(segment.start)}〕${who}` : `〔${clock(segment.start)}〕`;
      return `${head}\n${segment.text}`;
    })
    .join('\n\n');

  return [
    '# 整理这份访谈稿',
    '',
    RULES,
    '',
    '---',
    '',
    '## 这份录音',
    '',
    ...(audio ? [`- 来源：${audio}`] : []),
    `- 时长：${length}`,
    `- 段数：${segments.length}`,
    '',
    '说话人：',
    roster,
    '',
    '术语表：无。人名地名请按上下文判断，拿不准的地方标出来问我，不要自己发明。',
    '',
    '---',
    '',
    '## 待整理的稿子',
    '',
    draft,
    '',
  ].join('\n');
}
