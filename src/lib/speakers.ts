// Its own file so that exporters.ts and cleanup.ts can both use it without
// importing each other: exporters needs cleanup to register the format, and
// cleanup needs this to print a name.

/**
 * The name to print for a diarization label.
 *
 * Unlike the renderer's own label, an unlabelled segment gets an empty string
 * rather than "Unknown": a transcription run without diarization has no
 * speakers at all, and prefixing every line with "Unknown:" would be noise.
 */
export function speakerName(speaker: string | undefined, names: SpeakerNames = {}): string {
  if (!speaker) return '';

  const given = names[speaker]?.trim();
  if (given) return given;

  const match = /(\d+)$/.exec(speaker);
  return match?.[1] ? `Speaker ${Number(match[1]) + 1}` : speaker;
}
